import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ChatChannel,
  ChatMessage,
  formatChatTime,
  imageFileToWebp360,
  blobToDataUrl,
  makeImageMessage,
  makeTextMessage,
  makeVoiceMessage
} from '../lib/chat'

interface ChatPanelProps {
  channel: ChatChannel
  messages: ChatMessage[]
  canPost: boolean
  author: string
  color: string
  onlineNames?: string[]
  onSend: (msg: ChatMessage) => void
  onTogglePin?: (id: string, pinned: boolean) => void
}

function renderTextWithMentions(text: string) {
  const parts = text.split(/(@[A-Za-z0-9_]{1,40})/g)
  return parts.map((part, i) => {
    if (part.startsWith('@') && part.length > 1) {
      return (
        <span key={i} className="font-medium text-brand">
          {part}
        </span>
      )
    }
    return <span key={i}>{part}</span>
  })
}

export default function ChatPanel({
  channel,
  messages,
  canPost,
  author,
  color,
  onlineNames = [],
  onSend,
  onTogglePin
}: ChatPanelProps) {
  const [text, setText] = useState('')
  const [recording, setRecording] = useState(false)
  const [recSeconds, setRecSeconds] = useState(0)
  const [uploading, setUploading] = useState(false)
  const [mentionOpen, setMentionOpen] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const recStartedAt = useRef(0)
  const recTimerRef = useRef<number | null>(null)

  const channelLabel = channel === 'general'
    ? 'General'
    : channel === 'editors'
    ? 'Editors'
    : channel.startsWith('dm:')
    ? `DM · ${channel.slice(3).split('|').join(' & ')}`
    : channel

  const pinned = useMemo(() => messages.filter((m) => m.pinned), [messages])
  const unpinned = useMemo(() => messages.filter((m) => !m.pinned), [messages])

  const mentionCandidates = useMemo(() => {
    const at = text.match(/@([A-Za-z0-9_]*)$/)
    if (!at) return []
    const prefix = at[1].toLowerCase()
    return onlineNames
      .filter((n) => n.toLowerCase().startsWith(prefix) && n !== author)
      .slice(0, 6)
  }, [text, onlineNames, author])

  useEffect(() => {
    setMentionOpen(mentionCandidates.length > 0)
  }, [mentionCandidates])

  useEffect(() => {
    const el = listRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [messages.length])

  useEffect(() => {
    return () => {
      if (recTimerRef.current) window.clearInterval(recTimerRef.current)
      mediaRecorderRef.current?.stream.getTracks().forEach((t) => t.stop())
    }
  }, [])

  const sendText = () => {
    const trimmed = text.trim()
    if (!trimmed || !canPost) return
    onSend(makeTextMessage(channel, trimmed, author, color))
    setText('')
    setMentionOpen(false)
  }

  const insertMention = (name: string) => {
    setText((prev) => prev.replace(/@([A-Za-z0-9_]*)$/, `@${name} `))
    setMentionOpen(false)
  }

  const onPickImage = async (file: File | null) => {
    if (!file || !canPost) return
    if (!file.type.startsWith('image/')) {
      window.alert('Please choose an image file.')
      return
    }
    setUploading(true)
    try {
      const dataUrl = await imageFileToWebp360(file)
      onSend(makeImageMessage(channel, dataUrl, author, color))
    } catch (e) {
      window.alert('Could not process image: ' + (e as Error).message)
    } finally {
      setUploading(false)
    }
  }

  const startRecording = async () => {
    if (!canPost || recording) return
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/webm')
        ? 'audio/webm'
        : ''
      const recorder = mime
        ? new MediaRecorder(stream, { mimeType: mime })
        : new MediaRecorder(stream)
      chunksRef.current = []
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data)
      }
      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop())
        if (recTimerRef.current) {
          window.clearInterval(recTimerRef.current)
          recTimerRef.current = null
        }
        const durationSec = Math.max(1, Math.round((Date.now() - recStartedAt.current) / 1000))
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' })
        try {
          const dataUrl = await blobToDataUrl(blob)
          onSend(makeVoiceMessage(channel, dataUrl, durationSec, author, color))
        } catch {
          window.alert('Could not save voice note.')
        }
        setRecording(false)
        setRecSeconds(0)
      }
      mediaRecorderRef.current = recorder
      recStartedAt.current = Date.now()
      setRecSeconds(0)
      recTimerRef.current = window.setInterval(() => {
        setRecSeconds(Math.round((Date.now() - recStartedAt.current) / 1000))
      }, 250)
      recorder.start()
      setRecording(true)
    } catch {
      window.alert('Microphone access is required for voice notes.')
    }
  }

  const stopRecording = () => {
    const rec = mediaRecorderRef.current
    if (rec && rec.state !== 'inactive') rec.stop()
  }

  const renderMessage = (m: ChatMessage) => (
    <div
      key={m.id}
      className={`flex gap-2.5 group rounded-lg px-1 -mx-1 ${
        m.pinned ? 'py-1' : ''
      }`}
      style={m.pinned ? { background: 'var(--accent-soft)' } : undefined}
    >
      <div
        className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-white"
        style={{ backgroundColor: m.color }}
        title={m.author}
      >
        {m.author.slice(0, 2).toUpperCase()}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-2">
          <span className="text-xs font-medium text-ink">{m.author}</span>
          <span className="text-[10px] text-ink-faint">{formatChatTime(m.ts)}</span>
          {m.pinned && (
            <span className="text-[9px] uppercase tracking-wide text-brand">Pinned</span>
          )}
          {onTogglePin && canPost && (
            <button
              type="button"
              className="text-[10px] text-ink-faint opacity-0 transition-opacity group-hover:opacity-100 hover:text-brand"
              onClick={() => onTogglePin(m.id, !m.pinned)}
            >
              {m.pinned ? 'Unpin' : 'Pin'}
            </button>
          )}
        </div>
        {m.type === 'text' && (
          <p className="mt-0.5 whitespace-pre-wrap break-words text-[13px] text-ink-muted">
            {renderTextWithMentions(m.text || '')}
          </p>
        )}
        {m.type === 'image' && m.dataUrl && (
          <div className="mt-1.5">
            <img
              src={m.dataUrl}
              alt={m.text || 'image'}
              className="max-w-[360px] w-full rounded-lg border"
              style={{ borderColor: 'var(--line)' }}
            />
            {m.text && (
              <p className="mt-1 whitespace-pre-wrap text-xs text-ink-soft">{m.text}</p>
            )}
          </div>
        )}
        {m.type === 'voice' && m.dataUrl && (
          <div className="mt-1.5 flex items-center gap-2">
            <audio controls src={m.dataUrl} className="h-8 max-w-full" />
            {m.durationSec != null && (
              <span className="text-[10px] text-ink-faint">{m.durationSec}s</span>
            )}
          </div>
        )}
      </div>
    </div>
  )

  return (
    <div className="flex h-full flex-col" style={{ background: 'var(--surface-editor)' }}>
      <div
        className="flex h-9 shrink-0 items-center gap-2 border-b px-3 text-[11px]"
        style={{ borderColor: 'var(--line)' }}
      >
        <span className="font-medium text-ink">{channelLabel} chat</span>
        <span className="text-ink-faint">·</span>
        <span className="text-ink-soft">
          {channel === 'general'
            ? 'Visible to everyone (editors + viewers)'
            : 'Editors only — hidden from read-only viewers'}
        </span>
      </div>

      <div ref={listRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3">
        {messages.length === 0 && (
          <p className="py-10 text-center text-xs text-ink-faint">No messages yet. Say hello!</p>
        )}
        {pinned.length > 0 && (
          <div className="mb-2 space-y-2 border-b pb-2" style={{ borderColor: 'var(--line)' }}>
            <div className="text-[10px] uppercase tracking-wide text-brand">Pinned</div>
            {pinned.map(renderMessage)}
          </div>
        )}
        {unpinned.map(renderMessage)}
      </div>

      {canPost ? (
        <div
          className="relative shrink-0 space-y-2 border-t p-2.5"
          style={{ borderColor: 'var(--line)', background: 'var(--surface-1)' }}
        >
          {mentionOpen && mentionCandidates.length > 0 && (
            <div
              className="absolute bottom-full left-2 z-10 mb-1 min-w-[140px] rounded-lg border py-1 shadow-dropdown"
              style={{ background: 'var(--surface-1)', borderColor: 'var(--line)' }}
            >
              {mentionCandidates.map((n) => (
                <button
                  key={n}
                  type="button"
                  className="block w-full px-3 py-1.5 text-left text-xs text-ink-muted hover:bg-[var(--surface-3)]"
                  onClick={() => insertMention(n)}
                >
                  @{n}
                </button>
              ))}
            </div>
          )}
          <div className="flex gap-2">
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  sendText()
                }
              }}
              rows={2}
              placeholder="Type a message…  @mention · Enter to send"
              className="flex-1 resize-none rounded-lg border px-3 py-2 text-[13px] outline-none transition-colors"
              style={{
                background: 'var(--surface-2)',
                borderColor: 'var(--line)',
                color: 'var(--ink)'
              }}
            />
            <button
              type="button"
              onClick={sendText}
              disabled={!text.trim()}
              className="self-end rounded-lg px-3 py-2 text-sm font-medium text-white transition-opacity disabled:opacity-40"
              style={{ background: 'var(--accent)' }}
              aria-label="Send message"
            >
              <i className="fa-solid fa-paper-plane text-[12px]" />
            </button>
          </div>
          <div className="flex items-center gap-1">
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0] || null
                e.target.value = ''
                void onPickImage(f)
              }}
            />
            <div className="tooltip-wrap">
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={uploading}
                className="icon-btn h-8 w-8"
                aria-label={uploading ? 'Converting image' : 'Attach image'}
              >
                <i className={`fa-solid ${uploading ? 'fa-spinner fa-spin' : 'fa-image'} text-[13px]`} />
              </button>
              <span className="tooltip">{uploading ? 'Converting…' : 'Image'}</span>
            </div>
            {!recording ? (
              <div className="tooltip-wrap">
                <button
                  type="button"
                  onClick={() => void startRecording()}
                  className="icon-btn h-8 w-8"
                  aria-label="Record voice note"
                >
                  <i className="fa-solid fa-microphone text-[13px]" />
                </button>
                <span className="tooltip">Voice note</span>
              </div>
            ) : (
              <button
                type="button"
                onClick={stopRecording}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[11px] font-medium"
                style={{ background: 'rgba(201,76,76,0.12)', color: 'var(--danger)' }}
                aria-label="Stop recording"
              >
                <i className="fa-solid fa-stop text-[11px]" />
                {recSeconds}s
              </button>
            )}
            <span className="ml-auto text-[10px] text-ink-faint">Images → 360px WebP</span>
          </div>
        </div>
      ) : (
        <div
          className="shrink-0 border-t px-3 py-2 text-[11px] text-ink-soft"
          style={{ borderColor: 'var(--line)' }}
        >
          You can read this channel but cannot post.
        </div>
      )}
    </div>
  )
}
