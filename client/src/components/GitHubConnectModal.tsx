import { useEffect, useState } from 'react'
import {
  disconnectGitHub,
  getRepo,
  loadGitHubToken,
  loadGitHubUser,
  loadRoomRemote,
  parseRepoRef,
  saveRoomRemote,
  verifyToken,
  type GitHubRemote,
  type GitHubUser
} from '../lib/github'

interface Props {
  roomId: string
  open: boolean
  onClose: () => void
  onConnected: (remote: GitHubRemote | null, user: GitHubUser | null) => void
}

export default function GitHubConnectModal({ roomId, open, onClose, onConnected }: Props) {
  const [token, setToken] = useState('')
  const [repoInput, setRepoInput] = useState('')
  const [branch, setBranch] = useState('main')
  const [user, setUser] = useState<GitHubUser | null>(null)
  const [remote, setRemote] = useState<GitHubRemote | null>(null)
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [step, setStep] = useState<'token' | 'repo'>('token')

  useEffect(() => {
    if (!open) return
    const u = loadGitHubUser()
    const t = loadGitHubToken()
    const r = loadRoomRemote(roomId)
    setUser(u)
    setRemote(r)
    if (t) setToken(t)
    if (r) {
      setRepoInput(`${r.owner}/${r.repo}`)
      setBranch(r.defaultBranch)
      setStep('repo')
    } else if (u) {
      setStep('repo')
    } else {
      setStep('token')
    }
    setStatus('')
    setError('')
  }, [open, roomId])

  if (!open) return null

  const fieldStyle = {
    background: 'var(--surface-2)',
    borderColor: 'var(--line)',
    color: 'var(--ink)'
  } as const

  const connectToken = async () => {
    if (!token.trim()) {
      setError('Paste a GitHub personal access token.')
      return
    }
    setBusy(true)
    setError('')
    setStatus('Verifying…')
    const r = await verifyToken(token.trim())
    setBusy(false)
    if (!r.ok) {
      setStatus('')
      setError(r.error)
      return
    }
    setUser(r.user)
    setStep('repo')
    setStatus(`Signed in as @${r.user.login}`)
    setError('')
    onConnected(loadRoomRemote(roomId), r.user)
  }

  const linkRepo = async () => {
    const parsed = parseRepoRef(repoInput)
    if (!parsed) {
      setError('Use owner/repo or a github.com URL.')
      return
    }
    const t = loadGitHubToken()
    if (!t) {
      setError('Connect a token first.')
      setStep('token')
      return
    }
    setBusy(true)
    setError('')
    setStatus('Checking repository…')
    const info = await getRepo(t, parsed.owner, parsed.repo)
    setBusy(false)
    if (!info.ok) {
      setStatus('')
      setError(info.error)
      return
    }
    const next: GitHubRemote = {
      owner: parsed.owner,
      repo: parsed.repo,
      defaultBranch: branch.trim() || info.defaultBranch,
      url: `https://github.com/${parsed.owner}/${parsed.repo}`
    }
    saveRoomRemote(roomId, next)
    setRemote(next)
    setStatus(`Linked ${info.full_name} (${next.defaultBranch})`)
    setError('')
    onConnected(next, user)
  }

  const unlink = () => {
    saveRoomRemote(roomId, null)
    setRemote(null)
    setStatus('Remote unlinked from this room.')
    setError('')
    onConnected(null, user)
  }

  const signOut = () => {
    disconnectGitHub()
    setUser(null)
    setToken('')
    setStep('token')
    setStatus('GitHub signed out on this browser.')
    setError('')
    onConnected(remote, null)
  }

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center px-4"
      style={{ background: 'rgba(0,0,0,0.45)' }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-2xl border p-6 shadow-dropdown"
        style={{ background: 'var(--surface-1)', borderColor: 'var(--line)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-1 flex items-center gap-2">
          <i className="fa-brands fa-github text-base text-ink" />
          <h2 className="text-base font-semibold text-ink">Connect GitHub</h2>
          <button
            type="button"
            className="ml-auto icon-btn h-7 w-7 text-ink-faint"
            onClick={onClose}
            aria-label="Close"
          >
            <i className="fa-solid fa-xmark" />
          </button>
        </div>
        <p className="mb-4 text-xs text-ink-muted">
          Token stays in this browser only. Classic: <span className="font-mono text-ink-soft">repo</span> scope —
          or fine-grained Contents + Pull requests.
        </p>

        {user && (
          <div
            className="mb-4 flex items-center gap-2 rounded-lg px-3 py-2 text-xs"
            style={{ background: 'var(--surface-2)', border: '1px solid var(--line)' }}
          >
            {user.avatar_url && (
              <img src={user.avatar_url} alt="" className="h-7 w-7 rounded-full" />
            )}
            <span className="text-ink-soft">
              @{user.login}
              {user.name ? ` · ${user.name}` : ''}
            </span>
            <button
              type="button"
              className="ml-auto text-[11px] text-ink-faint hover:text-ink"
              onClick={signOut}
            >
              Sign out
            </button>
          </div>
        )}

        {step === 'token' && (
          <div>
            <label className="mb-1.5 block text-xs font-medium text-ink-muted">
              Personal access token
            </label>
            <input
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="ghp_… or github_pat_…"
              className="mb-3 w-full rounded-lg border px-3 py-2.5 font-mono text-sm outline-none transition-colors focus:border-[var(--accent)]"
              style={fieldStyle}
              autoComplete="off"
              autoFocus
            />
            <button
              type="button"
              disabled={busy}
              onClick={() => void connectToken()}
              className="w-full rounded-lg py-2.5 text-sm font-medium text-white transition-opacity hover:opacity-95 disabled:opacity-50"
              style={{ background: 'var(--accent)' }}
            >
              {busy ? 'Verifying…' : 'Connect GitHub'}
            </button>
            <a
              href="https://github.com/settings/tokens"
              target="_blank"
              rel="noreferrer"
              className="mt-3 block text-center text-xs text-ink-muted hover:text-ink"
            >
              Create a token on GitHub →
            </a>
          </div>
        )}

        {step === 'repo' && (
          <div>
            <label className="mb-1.5 block text-xs font-medium text-ink-muted">Repository</label>
            <input
              type="text"
              value={repoInput}
              onChange={(e) => setRepoInput(e.target.value)}
              placeholder="owner/repo or https://github.com/owner/repo"
              className="mb-3 w-full rounded-lg border px-3 py-2.5 font-mono text-sm outline-none transition-colors focus:border-[var(--accent)]"
              style={fieldStyle}
              autoFocus
            />
            <label className="mb-1.5 block text-xs font-medium text-ink-muted">Default branch</label>
            <input
              type="text"
              value={branch}
              onChange={(e) => setBranch(e.target.value)}
              placeholder="main"
              className="mb-3 w-full rounded-lg border px-3 py-2.5 font-mono text-sm outline-none transition-colors focus:border-[var(--accent)]"
              style={fieldStyle}
            />
            <button
              type="button"
              disabled={busy}
              onClick={() => void linkRepo()}
              className="w-full rounded-lg py-2.5 text-sm font-medium text-white transition-opacity hover:opacity-95 disabled:opacity-50"
              style={{ background: 'var(--accent)' }}
            >
              {busy ? 'Linking…' : remote ? 'Update remote' : 'Link repository'}
            </button>
            {remote && (
              <div
                className="mt-3 flex items-center gap-2 rounded-lg px-3 py-2 text-xs"
                style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}
              >
                <i className="fa-solid fa-link" />
                <a
                  href={remote.url}
                  target="_blank"
                  rel="noreferrer"
                  className="truncate font-medium hover:underline"
                >
                  {remote.owner}/{remote.repo}
                </a>
                <span className="opacity-80">@{remote.defaultBranch}</span>
                <button
                  type="button"
                  className="ml-auto text-[11px] hover:underline"
                  style={{ color: 'var(--danger)' }}
                  onClick={unlink}
                >
                  Unlink
                </button>
              </div>
            )}
            <button
              type="button"
              className="mt-2 w-full rounded-lg border py-2 text-xs text-ink-muted transition-colors hover:bg-[var(--surface-3)]"
              style={{ borderColor: 'var(--line)' }}
              onClick={() => setStep('token')}
            >
              ← Change token
            </button>
          </div>
        )}

        {error && (
          <p className="mt-3 text-xs" style={{ color: 'var(--danger)' }}>
            {error}
          </p>
        )}
        {status && !error && (
          <p className="mt-3 text-xs" style={{ color: 'var(--success, #22c55e)' }}>
            {status}
          </p>
        )}
      </div>
    </div>
  )
}
