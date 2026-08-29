import { useEffect, useRef, useState } from 'react'
import type { ActivityEntry } from '../lib/api'
import type { VoiceChannel, VoicePeer } from '../hooks/useVoice'

interface IncomingCall {
  label: string
  channel: VoiceChannel
}

interface SidebarExtrasProps {
  activity: ActivityEntry[]
  voiceChannel: VoiceChannel | null
  voiceMuted: boolean
  voiceJoining: boolean
  voicePeers: VoicePeer[]
  voiceError: string | null
  localName: string
  localColor: string
  readonly: boolean
  connectionStatus: 'connecting' | 'connected' | 'disconnected'
  synced: boolean
  incomingCall?: IncomingCall | null
  onJoinVoice: (ch: VoiceChannel) => void
  onLeaveVoice: () => void
  /** Hide incoming banner + stop ringtone without joining */
  onDismissIncoming?: () => void
  onToggleMute: () => void
  onToggleScreen?: () => void
  screenSharing?: boolean
}

function relativeTime(ts: number): string {
  const sec = Math.floor((Date.now() - ts) / 1000)
  if (sec < 60) return `${sec}s`
  if (sec < 3600) return `${Math.floor(sec / 60)}m`
  if (sec < 86400) return `${Math.floor(sec / 3600)}h`
  return `${Math.floor(sec / 86400)}d`
}

const actionIcon: Record<string, string> = {
  join: 'fa-user-plus',
  rename: 'fa-i-cursor',
  delete: 'fa-trash',
  description: 'fa-pen',
  snapshot: 'fa-camera',
  restore: 'fa-rotate-left',
  create: 'fa-plus',
  'rotate-secrets': 'fa-key',
  visibility: 'fa-eye'
}


function ActivitySection({ activity }: { activity: ActivityEntry[] }) {
  const [collapsed, setCollapsed] = useState(false)
  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="panel-label mb-0">Room activity</div>
        <button
          type="button"
          className="icon-btn h-6 w-6"
          aria-label={collapsed ? 'Expand room activity' : 'Collapse room activity'}
          onClick={() => setCollapsed((v) => !v)}
        >
          <i className={`fa-solid ${collapsed ? 'fa-chevron-up' : 'fa-chevron-down'} text-[10px]`} />
        </button>
      </div>
      {!collapsed && (
        <ul className="max-h-36 space-y-1.5 overflow-y-auto">
          {activity.length === 0 && (
            <li className="text-[11px] text-ink-faint">No activity yet</li>
          )}
          {activity.slice(0, 12).map((a) => (
            <li key={a.id} className="flex items-start gap-2 text-[11px]">
              <i
                className={`fa-solid ${actionIcon[a.action] || 'fa-circle'} mt-0.5 text-[9px] text-ink-faint`}
              />
              <span className="min-w-0 flex-1 text-ink-soft">
                <span className="font-medium text-ink-muted">{a.displayName || 'anon'}</span>{' '}
                {a.action}
                {a.detail ? ` · ${a.detail.slice(0, 40)}` : ''}
              </span>
              <span className="shrink-0 text-ink-faint">{relativeTime(a.createdAt)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** Simple looping ringtone via Web Audio API (no asset file). */
function useRingtone(active: boolean) {
  const ctxRef = useRef<AudioContext | null>(null)
  const timerRef = useRef<number | null>(null)

  useEffect(() => {
    if (!active) {
      if (timerRef.current) {
        window.clearInterval(timerRef.current)
        timerRef.current = null
      }
      if (ctxRef.current) {
        void ctxRef.current.close().catch(() => {})
        ctxRef.current = null
      }
      return
    }

    let cancelled = false
    const ringOnce = () => {
      if (cancelled) return
      try {
        const ctx = ctxRef.current || new AudioContext()
        ctxRef.current = ctx
        const now = ctx.currentTime
        ;[0, 0.18].forEach((offset, i) => {
          const osc = ctx.createOscillator()
          const gain = ctx.createGain()
          osc.type = 'sine'
          osc.frequency.value = i === 0 ? 880 : 660
          gain.gain.setValueAtTime(0.0001, now + offset)
          gain.gain.exponentialRampToValueAtTime(0.12, now + offset + 0.02)
          gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.16)
          osc.connect(gain)
          gain.connect(ctx.destination)
          osc.start(now + offset)
          osc.stop(now + offset + 0.18)
        })
      } catch {
        /* autoplay / unsupported */
      }
    }

    ringOnce()
    timerRef.current = window.setInterval(ringOnce, 2200)
    return () => {
      cancelled = true
      if (timerRef.current) window.clearInterval(timerRef.current)
      timerRef.current = null
      if (ctxRef.current) {
        void ctxRef.current.close().catch(() => {})
        ctxRef.current = null
      }
    }
  }, [active])
}

export default function SidebarExtras({
  activity,
  voiceChannel,
  voiceMuted,
  voiceJoining,
  voicePeers,
  voiceError,
  localName,
  localColor,
  readonly,
  connectionStatus,
  synced,
  incomingCall = null,
  onJoinVoice,
  onLeaveVoice,
  onDismissIncoming,
  onToggleMute,
  onToggleScreen,
  screenSharing
}: SidebarExtrasProps) {
  useRingtone(!!incomingCall && !voiceChannel)

  return (
    <div className="flex flex-col gap-4 border-t px-3 py-3" style={{ borderColor: 'var(--line)' }}>
      <ActivitySection activity={activity} />

      {/* Incoming call banner */}
      {incomingCall && !voiceChannel && (
        <div
          className="rounded-xl border px-3 py-2.5"
          style={{
            borderColor: 'var(--accent)',
            background: 'var(--accent-soft)'
          }}
        >
          <div className="mb-1 text-[11px] font-semibold text-brand">Incoming call</div>
          <div className="mb-2 text-[12px] text-ink">
            From <span className="font-medium">{incomingCall.label}</span>
          </div>
          <div className="flex items-center justify-center gap-4">
            <div className="tooltip-wrap">
              <button
                type="button"
                disabled={voiceJoining}
                onClick={() => onJoinVoice(incomingCall.channel)}
                className="flex h-10 w-10 items-center justify-center rounded-full border-2 text-green-500 transition-colors hover:bg-green-500/15 disabled:opacity-40"
                style={{ borderColor: '#22c55e' }}
                aria-label="Accept call"
              >
                <i className="fa-solid fa-phone text-[14px]" />
              </button>
              <span className="tooltip">Accept call</span>
            </div>
            <div className="tooltip-wrap">
              <button
                type="button"
                onClick={() => {
                  onDismissIncoming?.()
                  // Also leave if somehow already partially connected
                  onLeaveVoice()
                }}
                className="flex h-10 w-10 items-center justify-center rounded-full border-2 text-red-500 transition-colors hover:bg-red-500/15"
                style={{ borderColor: '#ef4444' }}
                aria-label="Decline call"
              >
                <i className="fa-solid fa-xmark text-[16px]" />
              </button>
              <span className="tooltip">Decline / end</span>
            </div>
          </div>
        </div>
      )}

      {/* Voice call card */}
      <div
        className="rounded-xl border px-3 py-2.5"
        style={{ borderColor: 'var(--line)', background: 'var(--surface-card)' }}
      >
        <div className="flex items-center justify-between">
          <span className="panel-label">Voice call</span>
          {voiceChannel && (
            <span className="text-[10px] text-success">
              {voiceChannel.startsWith('dm:') ? '1:1' : voiceChannel}
              {voicePeers.length > 0 ? ` · ${voicePeers.length}` : ''}
            </span>
          )}
        </div>
        <div className="mt-2 flex items-center justify-center gap-2">
          {!voiceChannel ? (
            <>
              <button
                type="button"
                disabled={voiceJoining}
                onClick={() => onJoinVoice('general')}
                className="flex h-8 w-8 items-center justify-center rounded-full border text-ink-faint transition-colors hover:bg-[var(--surface-3)] hover:text-ink-soft disabled:opacity-40"
                style={{ borderColor: 'var(--line)' }}
                title="Join General"
              >
                <i className="fa-solid fa-microphone text-[12px]" />
              </button>
              {!readonly && (
                <button
                  type="button"
                  disabled={voiceJoining}
                  onClick={() => onJoinVoice('editors')}
                  className="flex h-8 w-8 items-center justify-center rounded-full border text-ink-faint transition-colors hover:bg-[var(--surface-3)] hover:text-ink-soft disabled:opacity-40"
                  style={{ borderColor: 'var(--line)' }}
                  title="Join Editors"
                >
                  <i className="fa-solid fa-headset text-[12px]" />
                </button>
              )}
              <button
                type="button"
                disabled
                className="flex h-8 w-8 cursor-default items-center justify-center rounded-full border text-ink-faint opacity-40"
                style={{ borderColor: 'var(--line)' }}
                title="End (no active call)"
              >
                <i className="fa-solid fa-square text-[10px]" />
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                aria-label={voiceMuted ? 'Unmute' : 'Mute'}
                onClick={onToggleMute}
                className={`flex h-8 w-8 items-center justify-center rounded-full border transition-colors ${
                  voiceMuted
                    ? 'border-amber-500/50 bg-amber-500/10 text-amber-400'
                    : 'border-[var(--line)] text-ink-soft hover:bg-[var(--surface-3)]'
                }`}
              >
                <i
                  className={`fa-solid ${voiceMuted ? 'fa-microphone-slash' : 'fa-microphone'} text-[12px]`}
                />
              </button>
              <button
                type="button"
                aria-label="End call"
                onClick={onLeaveVoice}
                className="flex h-8 w-8 items-center justify-center rounded-full border-2 text-red-500 transition-colors hover:bg-red-500/15"
                style={{ borderColor: '#ef4444' }}
              >
                <i className="fa-solid fa-xmark text-[14px]" />
              </button>
              {onToggleScreen && (
                <button
                  type="button"
                  aria-label={screenSharing ? 'Stop sharing' : 'Share screen'}
                  onClick={onToggleScreen}
                  className={`flex h-8 w-8 items-center justify-center rounded-full border transition-colors ${
                    screenSharing
                      ? 'border-brand bg-brand-dim text-brand'
                      : 'border-[var(--line)] text-ink-soft hover:bg-[var(--surface-3)]'
                  }`}
                >
                  <i className="fa-solid fa-display text-[11px]" />
                </button>
              )}
            </>
          )}
        </div>
        {voiceError && (
          <p className="mt-1 w-full truncate text-center text-[10px] text-danger" title={voiceError}>
            {voiceError}
          </p>
        )}
      </div>

      <div className="flex items-start gap-2 text-[11px]">
        <span
          className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${
            connectionStatus === 'connected'
              ? 'bg-success'
              : connectionStatus === 'connecting'
              ? 'bg-amber-400 animate-pulse'
              : 'bg-danger'
          }`}
        />
        <div>
          <div className="font-medium text-ink-muted">
            {connectionStatus === 'connected'
              ? 'Connected'
              : connectionStatus === 'connecting'
              ? 'Connecting…'
              : 'Disconnected'}
          </div>
          <div className="text-ink-faint">
            {connectionStatus === 'connected' && synced
              ? 'All changes are live'
              : connectionStatus === 'connected'
              ? 'Syncing…'
              : 'Reconnecting…'}
          </div>
        </div>
      </div>
    </div>
  )
}
