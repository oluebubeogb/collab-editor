import { useEffect, useRef, useState } from 'react'
import BrandLogo from './BrandLogo'
import type { RemoteUserState } from '../hooks/useYjs'

interface TopBarProps {
  roomId: string
  roomDescription: string
  locked?: boolean
  isPublic?: boolean
  readonly?: boolean
  users: RemoteUserState[]
  status: 'connecting' | 'connected' | 'disconnected'
  followingClientId?: number | null
  localClientId?: number
  onFollow?: (id: number | null) => void
  onSearch: () => void
  onShare: () => void
  profileName?: string
  profileColor?: string
  onProfileClick?: () => void
  onSaveMeta?: (description: string, isPublic: boolean) => void
  onUnlockEditor?: () => void
}

export default function TopBar({
  roomId,
  roomDescription,
  locked = false,
  isPublic = false,
  readonly = false,
  users,
  status,
  followingClientId,
  localClientId,
  onFollow,
  onSearch,
  onShare,
  profileName,
  profileColor,
  onProfileClick,
  onSaveMeta,
  onUnlockEditor
}: TopBarProps) {
  const online = users.length
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(roomDescription)
  const [draftPublic, setDraftPublic] = useState(isPublic)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!editing) {
      setDraft(roomDescription)
      setDraftPublic(isPublic)
    }
  }, [roomDescription, isPublic, editing])

  useEffect(() => {
    if (editing) inputRef.current?.focus()
  }, [editing])

  const commit = () => {
    const next = draft.trim().slice(0, 50)
    onSaveMeta?.(next, draftPublic)
    setEditing(false)
  }

  const cancel = () => {
    setDraft(roomDescription)
    setDraftPublic(isPublic)
    setEditing(false)
  }

  return (
    <header
      className="flex h-11 shrink-0 items-center gap-3 border-b px-3"
      style={{ background: 'var(--surface-1)', borderColor: 'var(--line)' }}
    >
      <BrandLogo compact />

      <span className="text-ink-faint text-xs">/</span>

      {editing && !readonly ? (
        <div className="flex max-w-[280px] items-center gap-1.5">
          <input
            ref={inputRef}
            value={draft}
            maxLength={50}
            onChange={(e) => setDraft(e.target.value.slice(0, 50))}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit()
              if (e.key === 'Escape') cancel()
            }}
            className="min-w-0 flex-1 rounded-md border px-2 py-1 text-[13px] font-medium outline-none focus:border-[var(--accent)]"
            style={{
              background: 'var(--surface-2)',
              borderColor: 'var(--accent)',
              color: 'var(--ink)',
              boxShadow: '0 0 0 2px var(--accent-soft)'
            }}
            placeholder="Room title"
          />
          <button
            type="button"
            title={draftPublic ? 'Public — click for private' : 'Private — click for public'}
            onClick={() => setDraftPublic((v) => !v)}
            className="icon-btn h-7 w-7"
          >
            <i className={`fa-solid ${draftPublic ? 'fa-globe' : 'fa-lock'} text-[11px]`} />
          </button>
          <button type="button" className="icon-btn h-7 w-7" title="Save" onClick={commit}>
            <i className="fa-solid fa-check text-[11px]" style={{ color: 'var(--success)' }} />
          </button>
          <button type="button" className="icon-btn h-7 w-7" title="Cancel" onClick={cancel}>
            <i className="fa-solid fa-xmark text-[11px]" />
          </button>
        </div>
      ) : (
        <div className="flex max-w-[220px] items-center gap-1.5">
          <span
            className="truncate text-[13px] font-medium text-ink"
            title={roomDescription || 'Untitled room'}
          >
            {roomDescription || 'Untitled room'}
          </span>
          {!readonly && (
            <button
              type="button"
              className="icon-btn h-6 w-6 shrink-0 opacity-60 hover:opacity-100"
              title="Edit room title & visibility"
              onClick={() => {
                setDraft(roomDescription)
                setDraftPublic(isPublic)
                setEditing(true)
              }}
            >
              <i className="fa-solid fa-pen text-[10px]" />
            </button>
          )}
        </div>
      )}

      <span className="text-ink-faint text-xs">/</span>

      <span className="pill" title={`Room ID: ${roomId} · ${isPublic ? 'Public' : 'Private'}`}>
        <span className="max-w-[100px] truncate">{roomId}</span>
        {isPublic ? (
          <i className="fa-solid fa-globe text-[9px] text-ink-faint" title="Public room" />
        ) : (
          <i className="fa-solid fa-lock text-[9px] text-ink-faint" title="Private room" />
        )}
      </span>

      {readonly && (
        <button
          type="button"
          onClick={() => onUnlockEditor?.()}
          className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors hover:bg-[var(--surface-3)]"
          style={{
            borderColor: 'var(--accent)',
            color: 'var(--accent)',
            background: 'var(--accent-soft)'
          }}
          title="Enter room password to edit"
        >
          <i className="fa-solid fa-lock text-[10px]" />
          Read-only
          <i className="fa-solid fa-key text-[10px] opacity-80" />
        </button>
      )}

      <div className="flex-1" />

      <div className="flex items-center gap-2">
        <div className="flex -space-x-1.5">
          {users.slice(0, 6).map((u) => {
            const isSelf = localClientId === u.clientId
            const following = followingClientId === u.clientId
            return (
              <button
                key={u.clientId}
                type="button"
                title={
                  isSelf
                    ? `${u.name} (you)`
                    : following
                    ? `Stop following ${u.name}`
                    : `Follow ${u.name}`
                }
                disabled={isSelf || !onFollow}
                onClick={() => onFollow?.(following ? null : u.clientId)}
                className={`relative h-7 w-7 rounded-full border-2 text-[10px] font-semibold text-white ${
                  following ? 'border-brand ring-1 ring-brand/40' : 'border-[var(--surface-1)]'
                }`}
                style={{ backgroundColor: u.color }}
              >
                {u.name.slice(0, 2).toUpperCase()}
                {u.voiceChannel && (
                  <span
                    className={`absolute -bottom-0.5 -right-0.5 flex h-3 w-3 items-center justify-center rounded-full border text-[7px] ${
                      u.voiceMuted ? 'bg-amber-500' : 'bg-success'
                    }`}
                    style={{ borderColor: 'var(--surface-1)' }}
                  >
                    {u.voiceMuted ? 'M' : '♪'}
                  </span>
                )}
              </button>
            )
          })}
        </div>
        <span className="flex items-center gap-1.5 text-[11px] text-ink-soft">
          <span
            className={`h-1.5 w-1.5 rounded-full ${
              status === 'connected'
                ? 'bg-success'
                : status === 'connecting'
                ? 'bg-amber-400 animate-pulse'
                : 'bg-danger'
            }`}
          />
          {online} online
        </span>
      </div>

      <div className="mx-1 h-5 w-px" style={{ background: 'var(--line)' }} />

      <div className="tooltip-wrap">
        <button
          type="button"
          aria-label="Search workspace"
          onClick={onSearch}
          className="icon-btn h-8 w-8"
        >
          <i className="fa-solid fa-magnifying-glass text-[13px]" />
        </button>
        <span className="tooltip">Search · Ctrl+Shift+F</span>
      </div>

      <button
        type="button"
        onClick={onShare}
        className="inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-[12px] font-medium text-ink-muted transition-colors hover:bg-[var(--surface-3)]"
        style={{ borderColor: 'var(--line)' }}
        aria-label="Share room"
      >
        <i className="fa-solid fa-share-nodes text-[12px]" />
        Share
      </button>

      <button
        type="button"
        onClick={onProfileClick}
        className="ml-1 flex h-8 w-8 items-center justify-center rounded-full text-[11px] font-semibold text-white"
        style={{ backgroundColor: profileColor || '#8b5cf6' }}
        title={profileName || 'Profile'}
        aria-label="Profile"
      >
        {(profileName || 'U').slice(0, 2).toUpperCase()}
      </button>
    </header>
  )
}
