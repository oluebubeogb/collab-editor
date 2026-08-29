import { useState } from 'react'
import PasswordInput from './PasswordInput'
import { useAuth } from '../hooks/useAuth'

interface AuthModalProps {
  onClose?: () => void
  onSuccess?: () => void
  initialMode?: 'signin' | 'signup'
}

export default function AuthModal({ onClose, onSuccess, initialMode = 'signin' }: AuthModalProps) {
  const { signin, signup } = useAuth()
  const [mode, setMode] = useState<'signin' | 'signup'>(initialMode)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      let err: string | null = null
      if (mode === 'signin') {
        err = await signin(email.trim(), password)
      } else {
        err = await signup(email.trim(), password, displayName.trim() || email.split('@')[0])
      }
      if (err) setError(err)
      else {
        onSuccess?.()
        onClose?.()
      }
    } finally {
      setBusy(false)
    }
  }

  const fieldStyle = {
    background: 'var(--surface-2)',
    borderColor: 'var(--line)',
    color: 'var(--ink)'
  } as const

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-4"
      style={{ background: 'rgba(0,0,0,0.45)' }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose?.()
      }}
    >
      <form
        onSubmit={(e) => void handleSubmit(e)}
        className="w-full max-w-sm rounded-2xl border p-6 shadow-dropdown"
        style={{ background: 'var(--surface-1)', borderColor: 'var(--line)' }}
      >
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-base font-semibold text-ink">
            {mode === 'signin' ? 'Sign in' : 'Create account'}
          </h2>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="icon-btn h-8 w-8"
              aria-label="Close"
            >
              <i className="fa-solid fa-xmark text-[13px]" />
            </button>
          )}
        </div>

        <label className="mb-1.5 block text-xs font-medium text-ink-muted">Email</label>
        <input
          type="email"
          required
          autoComplete="email"
          className="mb-3 w-full rounded-lg border px-3 py-2.5 text-sm outline-none transition-colors focus:border-[var(--accent)]"
          style={fieldStyle}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoFocus
        />

        {mode === 'signup' && (
          <>
            <label className="mb-1.5 block text-xs font-medium text-ink-muted">Display name</label>
            <input
              className="mb-3 w-full rounded-lg border px-3 py-2.5 text-sm outline-none transition-colors focus:border-[var(--accent)]"
              style={fieldStyle}
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Optional"
              maxLength={40}
            />
          </>
        )}

        <label className="mb-1.5 block text-xs font-medium text-ink-muted">Password</label>
        <PasswordInput
          value={password}
          onChange={setPassword}
          placeholder="Password"
          autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
        />

        {error && (
          <p className="mb-3 text-xs" style={{ color: 'var(--danger)' }}>
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-lg py-2.5 text-sm font-medium text-white transition-opacity disabled:opacity-50"
          style={{ background: 'var(--accent)' }}
        >
          {busy ? 'Please wait…' : mode === 'signin' ? 'Sign in' : 'Sign up'}
        </button>

        <p className="mt-4 text-center text-xs text-ink-soft">
          {mode === 'signin' ? (
            <>
              No account?{' '}
              <button
                type="button"
                className="font-medium text-brand hover:underline"
                onClick={() => {
                  setMode('signup')
                  setError('')
                }}
              >
                Sign up
              </button>
            </>
          ) : (
            <>
              Already have an account?{' '}
              <button
                type="button"
                className="font-medium text-brand hover:underline"
                onClick={() => {
                  setMode('signin')
                  setError('')
                }}
              >
                Sign in
              </button>
            </>
          )}
        </p>
        <p className="mt-3 text-center text-[10px] text-ink-faint">
          Build in public. Ship in sync. Your session stays with you across refreshes.
        </p>
      </form>
    </div>
  )
}
