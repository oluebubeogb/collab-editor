import { useEffect, useMemo, useState } from 'react'
import { searchFiles, type SearchHit } from '../lib/workspace'

interface SearchPanelProps {
  texts: Record<string, string>
  onOpenHit: (path: string, line: number) => void
  onClose: () => void
}

export default function SearchPanel({ texts, onOpenHit, onClose }: SearchPanelProps) {
  const [query, setQuery] = useState('')
  const [debounced, setDebounced] = useState('')

  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(query), 150)
    return () => window.clearTimeout(t)
  }, [query])

  const hits = useMemo(() => searchFiles(texts, debounced), [texts, debounced])

  // Group by path
  const grouped = useMemo(() => {
    const map = new Map<string, SearchHit[]>()
    for (const h of hits) {
      const list = map.get(h.path) || []
      list.push(h)
      map.set(h.path, list)
    }
    return Array.from(map.entries())
  }, [hits])

  return (
    <div
      className="fixed inset-0 z-40 flex items-start justify-center p-4 pt-[10vh]"
      style={{ background: 'rgba(0,0,0,0.55)' }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        className="flex w-full max-w-xl max-h-[70vh] flex-col rounded-xl border shadow-2xl"
        style={{ background: 'var(--surface-1)', borderColor: 'var(--line)' }}
      >
        <div
          className="flex items-center gap-2 border-b px-3 py-2"
          style={{ borderColor: 'var(--line)' }}
        >
          <i className="fa-solid fa-magnifying-glass text-[13px] text-ink-faint" />
          <input
            autoFocus
            className="flex-1 bg-transparent px-1 text-sm outline-none text-ink"
            placeholder="Search across all text files…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') onClose()
            }}
          />
          <span className="shrink-0 text-[10px] text-ink-faint">
            {debounced ? `${hits.length} hit${hits.length === 1 ? '' : 's'}` : 'Ctrl+Shift+F'}
          </span>
          <button
            type="button"
            onClick={onClose}
            className="icon-btn h-7 w-7"
            aria-label="Close search"
          >
            <i className="fa-solid fa-xmark text-[12px]" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-2">
          {!debounced.trim() && (
            <p className="px-2 py-4 text-center text-xs text-ink-faint">
              Type to search file contents in this room.
            </p>
          )}
          {debounced.trim() && hits.length === 0 && (
            <p className="px-2 py-4 text-center text-xs text-ink-faint">No matches.</p>
          )}
          {grouped.map(([path, list]) => (
            <div key={path} className="mb-3">
              <div
                className="sticky top-0 px-2 py-1 font-mono text-[11px] text-ink-soft"
                style={{ background: 'var(--surface-1)' }}
              >
                {path} · {list.length}
              </div>
              {list.map((h, i) => (
                <button
                  key={`${path}-${h.line}-${i}`}
                  type="button"
                  onClick={() => {
                    onOpenHit(h.path, h.line)
                    onClose()
                  }}
                  className="w-full rounded px-2 py-1.5 text-left font-mono text-[11px] transition-colors hover:bg-[var(--surface-3)]"
                >
                  <span className="inline-block w-8 text-ink-faint">{h.line}</span>
                  <span className="text-ink-muted">
                    {h.text.slice(0, h.matchStart)}
                    <mark
                      className="rounded-sm px-0.5"
                      style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}
                    >
                      {h.text.slice(h.matchStart, h.matchEnd)}
                    </mark>
                    {h.text.slice(h.matchEnd)}
                  </span>
                </button>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
