import { useCallback, useEffect, useRef, useState } from 'react'
import type { GitStatusEntry } from '../lib/localGit'
import { gitAutocomplete } from '../lib/localGit'

export interface ConsoleLine {
  level: 'log' | 'warn' | 'error' | 'info' | 'success'
  text: string
  ts?: number
}

export interface TerminalLine {
  kind: 'in' | 'out' | 'err' | 'sys'
  text: string
}

interface BottomConsoleProps {
  lines: ConsoleLine[]
  changeCount?: number
  /** Live git status for Changes tab */
  gitStatus?: GitStatusEntry[]
  gitBranch?: string
  gitHead?: string | null
  onClear: () => void
  collapsed?: boolean
  onToggleCollapse?: () => void
  /** Run a shell/git command; returns output lines */
  onRunCommand?: (command: string) => Promise<{ ok: boolean; lines: string[] }> | { ok: boolean; lines: string[] }
  /** Paths for git add/restore autocomplete */
  filePaths?: string[]
  branchNames?: string[]
  /** Phase 2 */
  remoteLabel?: string | null
  onOpenGitHub?: () => void
}

type TabId = 'console' | 'terminal' | 'changes'

export default function BottomConsole({
  lines,
  changeCount = 0,
  gitStatus = [],
  gitBranch = 'main',
  gitHead = null,
  onClear,
  collapsed = false,
  onToggleCollapse,
  onRunCommand,
  filePaths = [],
  branchNames = ['main'],
  remoteLabel = null,
  onOpenGitHub
}: BottomConsoleProps) {
  const [tab, setTab] = useState<TabId>('console')
  const [termLines, setTermLines] = useState<TerminalLine[]>([
    { kind: 'sys', text: 'Phase 1 local terminal — room files are the working tree.' },
    { kind: 'sys', text: "Try: git init · git status · git add . · git commit -m \"msg\" · git help" }
  ])
  const [input, setInput] = useState('')
  const [history, setHistory] = useState<string[]>([])
  const [histIdx, setHistIdx] = useState(-1)
  const [suggestions, setSuggestions] = useState<string[]>([])
  const [sugIdx, setSugIdx] = useState(0)
  const [busy, setBusy] = useState(false)
  const termEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (tab === 'terminal') {
      termEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [termLines, tab])

  const updateSuggestions = useCallback(
    (value: string) => {
      if (!value.trim()) {
        setSuggestions([])
        return
      }
      const list = gitAutocomplete(value, filePaths, branchNames)
      setSuggestions(list.slice(0, 8))
      setSugIdx(0)
    },
    [filePaths, branchNames]
  )

  const runCommand = useCallback(
    async (cmd: string) => {
      const trimmed = cmd.trim()
      if (!trimmed) return
      setTermLines((prev) => [...prev, { kind: 'in', text: `$ ${trimmed}` }])
      setHistory((prev) => (prev[0] === trimmed ? prev : [trimmed, ...prev].slice(0, 80)))
      setHistIdx(-1)
      setInput('')
      setSuggestions([])
      setBusy(true)
      try {
        if (!onRunCommand) {
          setTermLines((prev) => [...prev, { kind: 'err', text: 'Terminal backend not wired.' }])
          return
        }
        const result = await onRunCommand(trimmed)
        const out =
          result.lines.length > 0
            ? result.lines.map((t) => ({
                kind: (result.ok ? 'out' : 'err') as TerminalLine['kind'],
                text: t
              }))
            : [{ kind: 'out' as const, text: '' }]
        setTermLines((prev) => [...prev, ...out])
      } catch (e) {
        setTermLines((prev) => [
          ...prev,
          { kind: 'err', text: e instanceof Error ? e.message : String(e) }
        ])
      } finally {
        setBusy(false)
        requestAnimationFrame(() => inputRef.current?.focus())
      }
    },
    [onRunCommand]
  )

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      void runCommand(input)
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (suggestions.length) {
        setSugIdx((i) => (i <= 0 ? suggestions.length - 1 : i - 1))
        return
      }
      const next = histIdx + 1
      if (next < history.length) {
        setHistIdx(next)
        setInput(history[next])
        updateSuggestions(history[next])
      }
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (suggestions.length) {
        setSugIdx((i) => (i >= suggestions.length - 1 ? 0 : i + 1))
        return
      }
      if (histIdx <= 0) {
        setHistIdx(-1)
        setInput('')
        setSuggestions([])
        return
      }
      const next = histIdx - 1
      setHistIdx(next)
      setInput(history[next] || '')
      updateSuggestions(history[next] || '')
      return
    }
    if (e.key === 'Tab' && suggestions.length) {
      e.preventDefault()
      const pick = suggestions[sugIdx] || suggestions[0]
      setInput(pick)
      setSuggestions([])
      return
    }
    if (e.key === 'Escape') {
      setSuggestions([])
    }
  }

  const statusLabel = (s: GitStatusEntry) => {
    if (s.staged) return s.status === 'deleted' ? 'D  ' : s.status === 'added' ? 'A  ' : 'M  '
    if (s.status === 'untracked') return '?? '
    if (s.status === 'deleted') return ' D '
    if (s.status === 'modified') return ' M '
    if (s.status === 'added') return ' A '
    return '   '
  }

  const statusColor = (s: GitStatusEntry) => {
    if (s.status === 'deleted') return 'text-red-400'
    if (s.status === 'added' || s.status === 'untracked') return 'text-emerald-400'
    if (s.status === 'modified') return 'text-amber-400'
    return 'text-ink-soft'
  }

  const staged = gitStatus.filter((s) => s.staged)
  const unstaged = gitStatus.filter((s) => !s.staged && s.status !== 'untracked')
  const untracked = gitStatus.filter((s) => s.status === 'untracked')
  const effectiveChangeCount = gitStatus.length > 0 ? gitStatus.length : changeCount

  return (
    <div
      className="flex flex-col border-t shrink-0 relative"
      style={{
        borderColor: 'var(--line)',
        background: 'var(--surface-console)',
        height: collapsed ? 32 : 180
      }}
    >
      <div className="flex h-8 items-center gap-1 border-b px-2" style={{ borderColor: 'var(--line)' }}>
        <button
          type="button"
          onClick={() => setTab('console')}
          className={`px-2 py-0.5 text-[11px] font-medium rounded ${
            tab === 'console' ? 'text-brand bg-brand-dim' : 'text-ink-soft hover:text-ink'
          }`}
        >
          <i className="fa-solid fa-terminal mr-1 text-[10px]" />
          Console
        </button>
        <button
          type="button"
          onClick={() => {
            setTab('terminal')
            requestAnimationFrame(() => inputRef.current?.focus())
          }}
          className={`px-2 py-0.5 text-[11px] font-medium rounded ${
            tab === 'terminal' ? 'text-brand bg-brand-dim' : 'text-ink-soft hover:text-ink'
          }`}
        >
          <i className="fa-solid fa-code mr-1 text-[10px]" />
          Terminal
        </button>
        <button
          type="button"
          onClick={() => setTab('changes')}
          className={`px-2 py-0.5 text-[11px] font-medium rounded ${
            tab === 'changes' ? 'text-brand bg-brand-dim' : 'text-ink-soft hover:text-ink'
          }`}
        >
          Changes
          {effectiveChangeCount > 0 && (
            <span className="ml-1 rounded-full bg-brand/20 px-1.5 text-[10px] text-brand">
              {effectiveChangeCount}
            </span>
          )}
        </button>

        <div className="relative ml-1">
          <details className="group">
            <summary
              className="list-none cursor-pointer px-2 py-0.5 text-[11px] font-medium rounded text-ink-soft hover:text-ink hover:bg-brand-dim/40 flex items-center gap-1"
              title="Git commands"
            >
              <i className="fa-brands fa-git-alt text-[12px]" />
              Git
              <i className="fa-solid fa-chevron-down text-[8px] opacity-60" />
            </summary>
            <div
              className="absolute left-0 top-full z-50 mt-1 min-w-[220px] rounded-md border py-1 shadow-lg"
              style={{ background: 'var(--surface)', borderColor: 'var(--line)' }}
            >
              {[
                { label: 'Status', cmd: 'git status' },
                { label: 'Stage all', cmd: 'git add .' },
                { label: 'Commit…', cmd: 'git commit -m "' },
                { label: 'Log', cmd: 'git log --oneline' },
                { label: 'Diff', cmd: 'git diff' },
                { label: 'Init repo', cmd: 'git init' },
                { label: 'Pull', cmd: 'git pull' },
                { label: 'Push…', cmd: 'git push -m "' },
                { label: 'Create PR', cmd: 'git pr create' },
                { label: 'Remote -v', cmd: 'git remote -v' },
                { label: 'Help', cmd: 'git help' }
              ].map((item) => (
                <button
                  key={item.cmd}
                  type="button"
                  className="flex w-full items-center px-3 py-1.5 text-left text-[11px] text-ink-soft hover:bg-brand-dim hover:text-ink"
                  onClick={() => {
                    setTab('terminal')
                    if (item.cmd.endsWith('"')) {
                      setInput(item.cmd)
                      requestAnimationFrame(() => inputRef.current?.focus())
                    } else {
                      void runCommand(item.cmd)
                    }
                  }}
                >
                  {item.label}
                  <span className="ml-auto text-[10px] text-ink-faint font-mono">{item.cmd}</span>
                </button>
              ))}
              {onOpenGitHub && (
                <button
                  type="button"
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11px] text-brand hover:bg-brand-dim border-t"
                  style={{ borderColor: 'var(--line)' }}
                  onClick={() => onOpenGitHub()}
                >
                  <i className="fa-brands fa-github" />
                  {remoteLabel ? `Remote: ${remoteLabel}` : 'Connect GitHub…'}
                </button>
              )}
            </div>
          </details>
        </div>

        <div className="flex-1" />
        <button
          type="button"
          aria-label="Clear"
          onClick={() => {
            if (tab === 'console') onClear()
            else if (tab === 'terminal') {
              setTermLines([{ kind: 'sys', text: 'Terminal cleared.' }])
            }
          }}
          className="icon-btn h-6 w-6 text-ink-faint"
          title="Clear"
        >
          <i className="fa-solid fa-broom text-[11px]" />
        </button>
        {onToggleCollapse && (
          <button
            type="button"
            aria-label={collapsed ? 'Expand console' : 'Collapse console'}
            onClick={onToggleCollapse}
            className="icon-btn h-6 w-6 text-ink-faint"
          >
            <i className={`fa-solid ${collapsed ? 'fa-chevron-up' : 'fa-chevron-down'} text-[10px]`} />
          </button>
        )}
      </div>

      {!collapsed && (
        <div className="flex-1 overflow-hidden flex flex-col min-h-0">
          {tab === 'console' && (
            <div className="flex-1 overflow-y-auto px-3 py-2 font-mono text-[11px]">
              {lines.length === 0 ? (
                <div className="text-ink-faint">No console output yet.</div>
              ) : (
                lines.map((l, i) => (
                  <div
                    key={i}
                    className={
                      l.level === 'error'
                        ? 'text-red-400'
                        : l.level === 'warn'
                          ? 'text-amber-400'
                          : l.level === 'success'
                            ? 'text-success'
                            : 'text-ink-soft'
                    }
                  >
                    {l.level === 'success' && <i className="fa-solid fa-check mr-1.5 text-[10px]" />}
                    {l.text}
                  </div>
                ))
              )}
            </div>
          )}

          {tab === 'terminal' && (
            <div className="flex flex-col flex-1 min-h-0 relative">
              <div className="flex-1 overflow-y-auto px-3 py-2 font-mono text-[11px]">
                {termLines.map((l, i) => (
                  <div
                    key={i}
                    className={
                      l.kind === 'in'
                        ? 'text-brand'
                        : l.kind === 'err'
                          ? 'text-red-400'
                          : l.kind === 'sys'
                            ? 'text-ink-faint'
                            : 'text-ink-soft whitespace-pre-wrap'
                    }
                  >
                    {l.text}
                  </div>
                ))}
                <div ref={termEndRef} />
              </div>
              <div
                className="relative border-t px-2 py-1 flex items-center gap-1"
                style={{ borderColor: 'var(--line)' }}
              >
                <span className="text-brand font-mono text-[11px] select-none">$</span>
                <input
                  ref={inputRef}
                  type="text"
                  value={input}
                  disabled={busy}
                  onChange={(e) => {
                    setInput(e.target.value)
                    updateSuggestions(e.target.value)
                  }}
                  onKeyDown={onKeyDown}
                  className="flex-1 bg-transparent border-0 outline-none font-mono text-[11px] text-ink placeholder:text-ink-faint"
                  placeholder='git status · git add . · git commit -m "…"'
                  spellCheck={false}
                  autoComplete="off"
                />
                {busy && <i className="fa-solid fa-spinner fa-spin text-[10px] text-ink-faint" />}
              </div>
              {suggestions.length > 0 && (
                <div
                  className="absolute left-2 right-2 bottom-8 z-40 max-h-36 overflow-y-auto rounded border shadow-lg py-1"
                  style={{ background: 'var(--surface)', borderColor: 'var(--line)' }}
                >
                  {suggestions.map((s, i) => (
                    <button
                      key={s + i}
                      type="button"
                      className={`flex w-full px-2 py-1 text-left font-mono text-[11px] ${
                        i === sugIdx ? 'bg-brand-dim text-brand' : 'text-ink-soft hover:bg-brand-dim/50'
                      }`}
                      onMouseDown={(e) => {
                        e.preventDefault()
                        setInput(s)
                        setSuggestions([])
                        inputRef.current?.focus()
                      }}
                    >
                      {s}
                    </button>
                  ))}
                  <div
                    className="px-2 py-0.5 text-[9px] text-ink-faint border-t"
                    style={{ borderColor: 'var(--line)' }}
                  >
                    Tab to complete · ↑↓ to navigate
                  </div>
                </div>
              )}
            </div>
          )}

          {tab === 'changes' && (
            <div className="flex-1 overflow-y-auto px-3 py-2 font-mono text-[11px]">
              <div className="text-ink-faint mb-2">
                On branch <span className="text-brand">{gitBranch}</span>
                {gitHead ? (
                  <span className="ml-2 text-ink-soft">HEAD {gitHead.slice(0, 7)}</span>
                ) : (
                  <span className="ml-2">(no commits)</span>
                )}
                {remoteLabel && (
                  <div className="mt-0.5 text-[10px]">
                    <i className="fa-brands fa-github mr-1" />
                    <span className="text-ink-soft">{remoteLabel}</span>
                  </div>
                )}
              </div>
              {gitStatus.length === 0 ? (
                <div className="text-ink-faint">
                  {changeCount === 0
                    ? 'Working tree clean — no pending changes.'
                    : `${changeCount} file(s) touched this session. Run git init + git status for full tracking.`}
                </div>
              ) : (
                <>
                  {staged.length > 0 && (
                    <div className="mb-2">
                      <div className="text-ink-faint mb-0.5">Staged</div>
                      {staged.map((s) => (
                        <div key={'s-' + s.path} className={statusColor(s)}>
                          <span className="opacity-70">{statusLabel(s)}</span>
                          {s.path}
                        </div>
                      ))}
                    </div>
                  )}
                  {unstaged.length > 0 && (
                    <div className="mb-2">
                      <div className="text-ink-faint mb-0.5">Unstaged</div>
                      {unstaged.map((s) => (
                        <div key={'u-' + s.path} className={statusColor(s)}>
                          <span className="opacity-70">{statusLabel(s)}</span>
                          {s.path}
                        </div>
                      ))}
                    </div>
                  )}
                  {untracked.length > 0 && (
                    <div className="mb-2">
                      <div className="text-ink-faint mb-0.5">Untracked</div>
                      {untracked.map((s) => (
                        <div key={'t-' + s.path} className={statusColor(s)}>
                          <span className="opacity-70">{statusLabel(s)}</span>
                          {s.path}
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
