import { useState } from 'react'

interface JoinModalProps {
  roomId: string
  roomDescription?: string
  requiredPwd: string
  defaultName: string
  readonly?: boolean
  /** Called with display name and whether to join read-only (no / wrong / omitted password). */
  onJoin: (name: string, opts: { readonly: boolean; password?: string }) => void
}

export default function JoinModal({
  roomId,
  roomDescription = '',
  requiredPwd,
  defaultName,
  readonly = false,
  onJoin
}: JoinModalProps) {
  const [name, setName] = useState(defaultName)
  const [pwd, setPwd] = useState(requiredPwd || '')
  const [error, setError] = useState('')

  const fieldStyle = {
    background: 'var(--surface-2)',
    borderColor: 'var(--line)',
    color: 'var(--ink)'
  } as const

  const submit = (asReadonly: boolean) => {
    if (!name.trim()) {
      setError('Please enter a display name.')
      return
    }
    if (!asReadonly && !readonly) {
      // Edit path: if URL already has the correct pwd, accept; otherwise require match when known
      if (requiredPwd && pwd && pwd !== requiredPwd) {
        setError('Incorrect password for this room.')
        return
      }
      if (requiredPwd && !pwd.trim()) {
        // Omit password → fall back to read-only
        onJoin(name.trim(), { readonly: true })
        return
      }
      onJoin(name.trim(), { readonly: false, password: pwd.trim() || requiredPwd || undefined })
      return
    }
    onJoin(name.trim(), { readonly: true })
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (readonly) {
      submit(true)
      return
    }
    // Empty password → read-only; non-empty → try edit
    if (!pwd.trim()) submit(true)
    else submit(false)
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-4"
      style={{ background: 'rgba(0,0,0,0.45)' }}
    >
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm rounded-2xl border p-6 shadow-dropdown"
        style={{ background: 'var(--surface-1)', borderColor: 'var(--line)' }}
      >
        <h2 className="mb-1 text-base font-semibold text-ink">
          {readonly ? 'View room' : 'Join room'}
        </h2>
        <p className="mb-1 font-mono text-xs text-ink-soft">Room: {roomId}</p>
        {roomDescription ? (
          <p className="mb-4 truncate text-sm text-ink-muted" title={roomDescription}>
            {roomDescription}
          </p>
        ) : (
          <p className="mb-4 text-xs italic text-ink-faint">No description</p>
        )}
        {readonly && (
          <p
            className="mb-4 rounded-lg px-3 py-2 text-xs"
            style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}
          >
            Read-only link — browse files and preview; editing is disabled.
          </p>
        )}

        <label className="mb-1.5 block text-xs font-medium text-ink-muted">Display name</label>
        <input
          className="mb-3 w-full rounded-lg border px-3 py-2.5 text-sm outline-none transition-colors focus:border-[var(--accent)]"
          style={fieldStyle}
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
        />

        {!readonly && (
          <>
            <label className="mb-1.5 block text-xs font-medium text-ink-muted">Room password</label>
            <input
              type="password"
              className="mb-1 w-full rounded-lg border px-3 py-2.5 text-sm outline-none transition-colors focus:border-[var(--accent)]"
              style={fieldStyle}
              value={pwd}
              onChange={(e) => setPwd(e.target.value)}
              placeholder="Enter password to edit — or leave blank for read-only"
            />
            <p className="mb-3 text-[11px] text-ink-faint">
              Leave password empty to open this room in read-only mode.
            </p>
          </>
        )}

        {error && (
          <p className="mb-3 text-xs" style={{ color: 'var(--danger)' }}>
            {error}
          </p>
        )}

        <button
          type="submit"
          className="w-full rounded-lg py-2.5 text-sm font-medium text-white transition-opacity hover:opacity-95"
          style={{ background: 'var(--accent)' }}
        >
          {readonly ? 'View' : pwd.trim() ? 'Join as editor' : 'Join read-only'}
        </button>

        {!readonly && pwd.trim() && (
          <button
            type="button"
            onClick={() => submit(true)}
            className="mt-2 w-full rounded-lg border py-2 text-xs text-ink-muted transition-colors hover:bg-[var(--surface-3)]"
            style={{ borderColor: 'var(--line)' }}
          >
            Join without password (read-only)
          </button>
        )}
      </form>
    </div>
  )
}
