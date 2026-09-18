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
  }, [open, roomId])

  if (!open) return null

  const connectToken = async () => {
    if (!token.trim()) {
      setStatus('Paste a GitHub personal access token.')
      return
    }
    setBusy(true)
    setStatus('Verifying…')
    const r = await verifyToken(token.trim())
    setBusy(false)
    if (!r.ok) {
      setStatus(r.error)
      return
    }
    setUser(r.user)
    setStep('repo')
    setStatus(`Signed in as @${r.user.login}`)
    onConnected(loadRoomRemote(roomId), r.user)
  }

  const linkRepo = async () => {
    const parsed = parseRepoRef(repoInput)
    if (!parsed) {
      setStatus('Use owner/repo or a github.com URL.')
      return
    }
    const t = loadGitHubToken()
    if (!t) {
      setStatus('Connect a token first.')
      setStep('token')
      return
    }
    setBusy(true)
    setStatus('Checking repository…')
    const info = await getRepo(t, parsed.owner, parsed.repo)
    setBusy(false)
    if (!info.ok) {
      setStatus(info.error)
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
    onConnected(next, user)
  }

  const unlink = () => {
    saveRoomRemote(roomId, null)
    setRemote(null)
    setStatus('Remote unlinked from this room.')
    onConnected(null, user)
  }

  const signOut = () => {
    disconnectGitHub()
    setUser(null)
    setToken('')
    setStep('token')
    setStatus('GitHub signed out on this browser.')
    onConnected(remote, null)
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-xl border shadow-xl p-5"
        style={{ background: 'var(--surface)', borderColor: 'var(--line)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 mb-3">
          <i className="fa-brands fa-github text-lg" />
          <h2 className="text-sm font-semibold text-ink">GitHub (Phase 2)</h2>
          <button type="button" className="ml-auto icon-btn h-7 w-7" onClick={onClose} aria-label="Close">
            <i className="fa-solid fa-xmark" />
          </button>
        </div>

        <p className="text-[11px] text-ink-faint mb-3">
          Connect a Personal Access Token (classic: <code className="text-ink-soft">repo</code> scope, or
          fine-grained: Contents + Pull requests). Token stays in this browser only.
        </p>

        {user && (
          <div className="flex items-center gap-2 mb-3 text-[12px] text-ink-soft">
            {user.avatar_url && (
              <img src={user.avatar_url} alt="" className="h-6 w-6 rounded-full" />
            )}
            <span>
              @{user.login}
              {user.name ? ` · ${user.name}` : ''}
            </span>
            <button type="button" className="ml-auto text-[11px] text-ink-faint hover:text-ink" onClick={signOut}>
              Sign out
            </button>
          </div>
        )}

        {step === 'token' && (
          <div className="space-y-2">
            <label className="text-[11px] text-ink-faint">Personal access token</label>
            <input
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="ghp_… or github_pat_…"
              className="w-full rounded border px-2 py-1.5 text-[12px] font-mono bg-transparent text-ink"
              style={{ borderColor: 'var(--line)' }}
              autoComplete="off"
            />
            <button
              type="button"
              disabled={busy}
              onClick={() => void connectToken()}
              className="w-full rounded bg-brand text-white text-[12px] font-medium py-1.5 hover:opacity-90 disabled:opacity-50"
            >
              {busy ? 'Verifying…' : 'Connect GitHub'}
            </button>
            <a
              href="https://github.com/settings/tokens"
              target="_blank"
              rel="noreferrer"
              className="block text-center text-[11px] text-brand hover:underline"
            >
              Create a token on GitHub →
            </a>
          </div>
        )}

        {step === 'repo' && (
          <div className="space-y-2">
            <label className="text-[11px] text-ink-faint">Repository</label>
            <input
              type="text"
              value={repoInput}
              onChange={(e) => setRepoInput(e.target.value)}
              placeholder="owner/repo or https://github.com/owner/repo"
              className="w-full rounded border px-2 py-1.5 text-[12px] font-mono bg-transparent text-ink"
              style={{ borderColor: 'var(--line)' }}
            />
            <label className="text-[11px] text-ink-faint">Default branch</label>
            <input
              type="text"
              value={branch}
              onChange={(e) => setBranch(e.target.value)}
              placeholder="main"
              className="w-full rounded border px-2 py-1.5 text-[12px] font-mono bg-transparent text-ink"
              style={{ borderColor: 'var(--line)' }}
            />
            <button
              type="button"
              disabled={busy}
              onClick={() => void linkRepo()}
              className="w-full rounded bg-brand text-white text-[12px] font-medium py-1.5 hover:opacity-90 disabled:opacity-50"
            >
              {busy ? 'Linking…' : remote ? 'Update remote' : 'Link repository'}
            </button>
            {remote && (
              <div className="text-[11px] text-ink-soft flex items-center gap-2">
                <i className="fa-solid fa-link text-brand" />
                <a href={remote.url} target="_blank" rel="noreferrer" className="hover:underline text-brand">
                  {remote.owner}/{remote.repo}
                </a>
                <span className="text-ink-faint">@{remote.defaultBranch}</span>
                <button type="button" className="ml-auto text-red-400 hover:underline" onClick={unlink}>
                  Unlink
                </button>
              </div>
            )}
            {!user && (
              <button type="button" className="text-[11px] text-ink-faint hover:text-ink" onClick={() => setStep('token')}>
                ← Change token
              </button>
            )}
          </div>
        )}

        {status && (
          <p className={`mt-3 text-[11px] ${status.includes('Linked') || status.includes('Signed') ? 'text-success' : 'text-amber-400'}`}>
            {status}
          </p>
        )}
      </div>
    </div>
  )
}
