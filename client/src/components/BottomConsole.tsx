import { useState } from 'react'

export interface ConsoleLine {
  level: 'log' | 'warn' | 'error' | 'info' | 'success'
  text: string
  ts?: number
}

interface BottomConsoleProps {
  lines: ConsoleLine[]
  changeCount?: number
  onClear: () => void
  collapsed?: boolean
  onToggleCollapse?: () => void
}

export default function BottomConsole({
  lines,
  changeCount = 0,
  onClear,
  collapsed = false,
  onToggleCollapse
}: BottomConsoleProps) {
  const [tab, setTab] = useState<'console' | 'changes'>('console')

  return (
    <div
      className="flex flex-col border-t shrink-0"
      style={{
        borderColor: 'var(--line)',
        background: 'var(--surface-console)',
        height: collapsed ? 32 : 140
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
          onClick={() => setTab('changes')}
          className={`px-2 py-0.5 text-[11px] font-medium rounded ${
            tab === 'changes' ? 'text-brand bg-brand-dim' : 'text-ink-soft hover:text-ink'
          }`}
        >
          Changes
          {changeCount > 0 && (
            <span className="ml-1 rounded-full bg-brand/20 px-1.5 text-[10px] text-brand">
              {changeCount}
            </span>
          )}
        </button>
        <div className="flex-1" />
        <button
          type="button"
          aria-label="Clear console"
          onClick={onClear}
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
        <div className="flex-1 overflow-y-auto px-3 py-2 font-mono text-[11px]">
          {tab === 'console' ? (
            lines.length === 0 ? (
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
            )
          ) : (
            <div className="text-ink-faint">
              {changeCount === 0
                ? 'No pending local change markers.'
                : `${changeCount} file(s) touched this session. Collaborative history uses Ctrl+Z undo.`}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
