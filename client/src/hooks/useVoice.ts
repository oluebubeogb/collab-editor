import { useCallback, useEffect, useRef, useState } from 'react'
import * as Y from 'yjs'
import type { WebsocketProvider } from 'y-websocket'

export type VoiceChannel = string // 'general' | 'editors' | 'dm:...'

export interface VoicePeer {
  clientId: number
  name: string
  color: string
  muted: boolean
  connected: boolean
}

interface SignalMessage {
  id: string
  from: number
  to: number
  type: 'offer' | 'answer' | 'ice' | 'bye'
  sdp?: RTCSessionDescriptionInit
  candidate?: RTCIceCandidateInit
  channel: VoiceChannel
  ts: number
}

interface AwarenessVoice {
  channel: VoiceChannel | null
  muted: boolean
  screen?: boolean
}

const ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' }
]

function signalKey() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

/**
 * Mesh WebRTC voice for a room channel.
 * Signaling rides on a Yjs map; presence uses Awareness `voice` field.
 */
export function useVoice(opts: {
  doc: Y.Doc | null
  provider: WebsocketProvider | null
  enabled: boolean
  /** Block editors channel when true */
  readonly: boolean
  localName: string
  localColor: string
}) {
  const { doc, provider, enabled, readonly, localName, localColor } = opts

  const [channel, setChannel] = useState<VoiceChannel | null>(null)
  const [muted, setMuted] = useState(false)
  const [peers, setPeers] = useState<VoicePeer[]>([])
  const [error, setError] = useState<string | null>(null)
  const [joining, setJoining] = useState(false)
  const [screenSharing, setScreenSharing] = useState(false)
  const screenTrackRef = useRef<MediaStreamTrack | null>(null)

  const channelRef = useRef<VoiceChannel | null>(null)
  const mutedRef = useRef(false)
  const localStreamRef = useRef<MediaStream | null>(null)
  const pcsRef = useRef<Map<number, RTCPeerConnection>>(new Map())
  const makingOfferRef = useRef<Set<number>>(new Set())
  const remoteAudioRef = useRef<Map<number, HTMLAudioElement>>(new Map())
  const processedSignalsRef = useRef<Set<string>>(new Set())

  channelRef.current = channel
  mutedRef.current = muted

  const publishAwareness = useCallback(
    (ch: VoiceChannel | null, isMuted: boolean) => {
      if (!provider) return
      const voice: AwarenessVoice = { channel: ch, muted: isMuted }
      provider.awareness.setLocalStateField('voice', voice)
    },
    [provider]
  )

  const postSignal = useCallback(
    (msg: Omit<SignalMessage, 'id' | 'ts'>) => {
      if (!doc) return
      const map = doc.getMap<SignalMessage>('webrtcSignals')
      const id = signalKey()
      map.set(id, { ...msg, id, ts: Date.now() })
      // GC old signals (keep map small)
      const cutoff = Date.now() - 60_000
      map.forEach((v, k) => {
        if (v && v.ts < cutoff) map.delete(k)
      })
    },
    [doc]
  )

  const cleanupPeer = useCallback((peerId: number) => {
    const pc = pcsRef.current.get(peerId)
    if (pc) {
      pc.onicecandidate = null
      pc.ontrack = null
      pc.onconnectionstatechange = null
      pc.close()
      pcsRef.current.delete(peerId)
    }
    const audio = remoteAudioRef.current.get(peerId)
    if (audio) {
      audio.srcObject = null
      audio.remove()
      remoteAudioRef.current.delete(peerId)
    }
    makingOfferRef.current.delete(peerId)
    setPeers((prev) => prev.filter((p) => p.clientId !== peerId))
  }, [])

  const cleanupAll = useCallback(() => {
    Array.from(pcsRef.current.keys()).forEach(cleanupPeer)
    localStreamRef.current?.getTracks().forEach((t) => t.stop())
    localStreamRef.current = null
    processedSignalsRef.current.clear()
  }, [cleanupPeer])

  const ensureRemoteAudio = (peerId: number, stream: MediaStream) => {
    let audio = remoteAudioRef.current.get(peerId)
    if (!audio) {
      audio = document.createElement('audio')
      audio.autoplay = true
      audio.setAttribute('playsinline', 'true')
      audio.style.display = 'none'
      document.body.appendChild(audio)
      remoteAudioRef.current.set(peerId, audio)
    }
    audio.srcObject = stream
    void audio.play().catch(() => {
      // autoplay policies — user already gestured by joining call
    })
  }

  const getOrCreatePc = useCallback(
    (peerId: number, ch: VoiceChannel) => {
      let pc = pcsRef.current.get(peerId)
      if (pc) return pc

      pc = new RTCPeerConnection({ iceServers: ICE_SERVERS })
      pcsRef.current.set(peerId, pc)

      const local = localStreamRef.current
      if (local) {
        local.getTracks().forEach((track) => {
          pc!.addTrack(track, local)
        })
      }

      pc.onicecandidate = (ev) => {
        if (!ev.candidate || !provider) return
        postSignal({
          from: provider.awareness.clientID,
          to: peerId,
          type: 'ice',
          candidate: ev.candidate.toJSON(),
          channel: ch
        })
      }

      pc.ontrack = (ev) => {
        const stream = ev.streams[0]
        if (stream) ensureRemoteAudio(peerId, stream)
      }

      pc.onconnectionstatechange = () => {
        const state = pc!.connectionState
        setPeers((prev) =>
          prev.map((p) =>
            p.clientId === peerId
              ? { ...p, connected: state === 'connected' || state === 'completed' }
              : p
          )
        )
        if (state === 'failed' || state === 'closed' || state === 'disconnected') {
          // soft: keep UI; hard close on closed
          if (state === 'closed') cleanupPeer(peerId)
        }
      }

      return pc
    },
    [cleanupPeer, postSignal, provider]
  )

  const politeShouldOffer = (localId: number, remoteId: number) => localId < remoteId

  const connectToPeer = useCallback(
    async (peerId: number, ch: VoiceChannel, name: string, color: string, peerMuted: boolean) => {
      if (!provider || peerId === provider.awareness.clientID) return
      if (pcsRef.current.has(peerId)) return

      setPeers((prev) => {
        if (prev.some((p) => p.clientId === peerId)) return prev
        return [...prev, { clientId: peerId, name, color, muted: peerMuted, connected: false }]
      })

      const localId = provider.awareness.clientID
      if (!politeShouldOffer(localId, peerId)) {
        // remote will offer; just ensure PC exists to receive
        getOrCreatePc(peerId, ch)
        return
      }

      if (makingOfferRef.current.has(peerId)) return
      makingOfferRef.current.add(peerId)

      try {
        const pc = getOrCreatePc(peerId, ch)
        const offer = await pc.createOffer()
        await pc.setLocalDescription(offer)
        postSignal({
          from: localId,
          to: peerId,
          type: 'offer',
          sdp: pc.localDescription
            ? { type: pc.localDescription.type, sdp: pc.localDescription.sdp }
            : offer,
          channel: ch
        })
      } catch (e) {
        console.warn('offer failed', e)
        makingOfferRef.current.delete(peerId)
      }
    },
    [getOrCreatePc, postSignal, provider]
  )

  // Handle incoming signals
  useEffect(() => {
    if (!doc || !provider || !enabled) return
    const map = doc.getMap<SignalMessage>('webrtcSignals')
    const localId = provider.awareness.clientID

    const handle = async (msg: SignalMessage) => {
      if (!msg || msg.to !== localId) return
      if (processedSignalsRef.current.has(msg.id)) return
      processedSignalsRef.current.add(msg.id)

      const ch = channelRef.current
      if (!ch || msg.channel !== ch) return

      if (msg.type === 'bye') {
        cleanupPeer(msg.from)
        map.delete(msg.id)
        return
      }

      const pc = getOrCreatePc(msg.from, ch)

      try {
        if (msg.type === 'offer' && msg.sdp) {
          await pc.setRemoteDescription(msg.sdp)
          const answer = await pc.createAnswer()
          await pc.setLocalDescription(answer)
          postSignal({
            from: localId,
            to: msg.from,
            type: 'answer',
            sdp: pc.localDescription
            ? { type: pc.localDescription.type, sdp: pc.localDescription.sdp }
            : answer,
            channel: ch
          })
        } else if (msg.type === 'answer' && msg.sdp) {
          if (pc.signalingState !== 'have-local-offer') {
            // ignore late/dupe
          } else {
            await pc.setRemoteDescription(msg.sdp)
          }
          makingOfferRef.current.delete(msg.from)
        } else if (msg.type === 'ice' && msg.candidate) {
          try {
            await pc.addIceCandidate(msg.candidate)
          } catch {
            // candidate before remote description — ignore
          }
        }
      } catch (e) {
        console.warn('signal handle error', e)
      }

      // remove consumed signal
      map.delete(msg.id)
    }

    const onChange = () => {
      map.forEach((v) => {
        if (v) void handle(v)
      })
    }
    map.observe(onChange)
    onChange()
    return () => map.unobserve(onChange)
  }, [doc, provider, enabled, cleanupPeer, getOrCreatePc, postSignal])

  // Watch awareness for peers entering/leaving the same channel
  useEffect(() => {
    if (!provider || !enabled) return

    const syncPeersFromAwareness = () => {
      const ch = channelRef.current
      if (!ch) return
      const localId = provider.awareness.clientID
      const states = Array.from(provider.awareness.getStates().entries())

      for (const [id, state] of states) {
        if (id === localId) continue
        const voice = state.voice as AwarenessVoice | undefined
        const user = state.user as { name: string; color: string } | undefined
        if (voice?.channel === ch && user) {
          void connectToPeer(id, ch, user.name, user.color, !!voice.muted)
          setPeers((prev) =>
            prev.map((p) => (p.clientId === id ? { ...p, muted: !!voice.muted, name: user.name, color: user.color } : p))
          )
        } else {
          // left this channel
          if (pcsRef.current.has(id)) {
            cleanupPeer(id)
          }
        }
      }

      // drop peers no longer in awareness
      const live = new Set(states.map(([id]) => id))
      Array.from(pcsRef.current.keys()).forEach((id) => {
        if (!live.has(id)) cleanupPeer(id)
      })
    }

    provider.awareness.on('change', syncPeersFromAwareness)
    syncPeersFromAwareness()
    return () => provider.awareness.off('change', syncPeersFromAwareness)
  }, [provider, enabled, connectToPeer, cleanupPeer])

  const join = useCallback(
    async (ch: VoiceChannel) => {
      if (!provider || !enabled) return
      if (ch === 'editors' && readonly) {
        setError('Editors call is only for people with edit access.')
        return
      }
      setJoining(true)
      setError(null)
      try {
        // Leave previous channel first
        if (channelRef.current) {
          const prev = channelRef.current
          const localId = provider.awareness.clientID
          Array.from(pcsRef.current.keys()).forEach((peerId) => {
            postSignal({ from: localId, to: peerId, type: 'bye', channel: prev })
            cleanupPeer(peerId)
          })
          localStreamRef.current?.getTracks().forEach((t) => t.stop())
          localStreamRef.current = null
        }

        const stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true },
          video: false
        })
        stream.getAudioTracks().forEach((t) => {
          t.enabled = !mutedRef.current
        })
        localStreamRef.current = stream

        setChannel(ch)
        channelRef.current = ch
        publishAwareness(ch, mutedRef.current)

        // Connect to anyone already in channel
        const localId = provider.awareness.clientID
        provider.awareness.getStates().forEach((state, id) => {
          if (id === localId) return
          const voice = state.voice as AwarenessVoice | undefined
          const user = state.user as { name: string; color: string } | undefined
          if (voice?.channel === ch && user) {
            void connectToPeer(id, ch, user.name, user.color, !!voice.muted)
          }
        })
      } catch (e) {
        setError('Microphone permission is required for voice calls.')
        console.warn(e)
      } finally {
        setJoining(false)
      }
    },
    [provider, enabled, readonly, publishAwareness, connectToPeer, cleanupPeer, postSignal]
  )

  const leave = useCallback(() => {
    if (!provider) return
    const ch = channelRef.current
    const localId = provider.awareness.clientID
    if (ch) {
      Array.from(pcsRef.current.keys()).forEach((peerId) => {
        postSignal({ from: localId, to: peerId, type: 'bye', channel: ch })
      })
    }
    cleanupAll()
    setChannel(null)
    channelRef.current = null
    setPeers([])
    publishAwareness(null, false)
    setMuted(false)
    mutedRef.current = false
    setError(null)
  }, [provider, cleanupAll, postSignal, publishAwareness])

  const toggleMute = useCallback(() => {
    const next = !mutedRef.current
    mutedRef.current = next
    setMuted(next)
    localStreamRef.current?.getAudioTracks().forEach((t) => {
      t.enabled = !next
    })
    publishAwareness(channelRef.current, next)
  }, [publishAwareness])

  // Cleanup on unmount / disable
  useEffect(() => {
    if (!enabled) {
      leave()
    }
    return () => {
      leave()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled])

  // Keep awareness user fields (name already set elsewhere)
  useEffect(() => {
    if (!provider) return
    // re-assert voice state if channel active
    if (channelRef.current) {
      publishAwareness(channelRef.current, mutedRef.current)
    }
  }, [provider, localName, localColor, publishAwareness])


  const stopScreenShare = useCallback(() => {
    const track = screenTrackRef.current
    if (track) {
      track.stop()
      screenTrackRef.current = null
    }
    // Remove from peer connections
    pcsRef.current.forEach((pc) => {
      pc.getSenders().forEach((s) => {
        if (s.track && s.track.kind === 'video') {
          try { pc.removeTrack(s) } catch { /* ignore */ }
        }
      })
    })
    setScreenSharing(false)
    if (provider && channelRef.current) {
      provider.awareness.setLocalStateField('voice', {
        channel: channelRef.current,
        muted: mutedRef.current,
        screen: false
      })
    }
  }, [provider])

  const startScreenShare = useCallback(async () => {
    if (!channelRef.current) return
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false })
      const track = stream.getVideoTracks()[0]
      if (!track) return
      screenTrackRef.current = track
      track.onended = () => stopScreenShare()
      pcsRef.current.forEach((pc) => {
        try {
          pc.addTrack(track, stream)
        } catch {
          /* ignore */
        }
      })
      setScreenSharing(true)
      if (provider) {
        provider.awareness.setLocalStateField('voice', {
          channel: channelRef.current,
          muted: mutedRef.current,
          screen: true
        })
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Screen share failed')
    }
  }, [provider, stopScreenShare])

  const toggleScreenShare = useCallback(() => {
    if (screenSharing) stopScreenShare()
    else void startScreenShare()
  }, [screenSharing, startScreenShare, stopScreenShare])

  return {
    channel,
    muted,
    peers,
    error,
    joining,
    screenSharing,
    join,
    leave,
    toggleMute,
    toggleScreenShare,
    inCall: channel !== null
  }
}
