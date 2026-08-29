import { useMemo, useState } from 'react'
import type { LineComment } from '../lib/workspace'

interface CommentsPanelProps {
  comments: LineComment[]
  pathFilter?: string | null
  readonly: boolean
  currentAuthor: string
  currentColor: string
  onAdd: (c: Omit<LineComment, 'id' | 'ts'>) => void
  onResolve: (id: string, resolved: boolean) => void
  onDelete: (id: string) => void
  onJump: (path: string, line: number) => void
  onClose: () => void
}

export default function CommentsPanel({
  comments,
  pathFilter,
  readonly,
  currentAuthor,
  currentColor,
  onAdd,
  onResolve,
  onDelete,
  onJump,
  onClose
}: CommentsPanelProps) {
  const [draft, setDraft] = useState('')
  const [line, setLine] = useState(1)
  const [replyTo, setReplyTo] = useState<string | null>(null)
  const [showResolved, setShowResolved] = useState(false)

  const filtered = useMemo(() => {
    let list = comments
    if (pathFilter) list = list.filter((c) => c.path === pathFilter)
    if (!showResolved) list = list.filter((c) => !c.resolved)
    // Roots first, then replies under them
    const roots = list.filter((c) => !c.parentId)
    const byParent = new Map<string, LineComment[]>()
    for (const c of list) {
      if (!c.parentId) continue
      const arr = byParent.get(c.parentId) || []
      arr.push(c)
      byParent.set(c.parentId, arr)
    }
    return roots
      .sort((a, b) => a.path.localeCompare(b.path) || a.line - b.line)
      .map((r) => ({ root: r, replies: (byParent.get(r.id) || []).sort((a, b) => a.ts - b.ts) }))
  }, [comments, pathFilter, showResolved])

  const submit = () => {
    const text = draft.trim()
    if (!text || readonly) return
    const path = pathFilter || window.prompt('File path for comment:') || ''
    if (!path) return
    onAdd({
      path,
      line: replyTo ? comments.find((c) => c.id === replyTo)?.line || line : line,
      author: currentAuthor,
      color: currentColor,
      text,
      parentId: replyTo,
      resolved: false
    })
    setDraft('')
    setReplyTo(null)
  }

  return (
    <div className="fixed inset-0 bg-black/60 z-40 flex items-center justify-center p-4">
      <div className="bg-neutral-900 border border-neutral-700 rounded-xl w-full max-w-md max-h-[80vh] flex flex-col shadow-2xl">
        <div className="flex items-center justify-between px-4 py-3 border-b border-neutral-800">
          <div>
            <h2 className="text-sm font-medium">Comments</h2>
            {pathFilter && (
              <p className="text-[10px] text-neutral-500 font-mono truncate">{pathFilter}</p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <label className="text-[10px] text-neutral-500 flex items-center gap-1">
              <input
                type="checkbox"
                checked={showResolved}
                onChange={(e) => setShowResolved(e.target.checked)}
              />
              Resolved
            </label>
            <button onClick={onClose} className="text-neutral-500 hover:text-neutral-300 text-sm">
              ✕
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-3 space-y-3">
          {filtered.length === 0 && (
            <p className="text-xs text-neutral-500 text-center py-6">No comments yet.</p>
          )}
          {filtered.map(({ root, replies }) => (
            <div
              key={root.id}
              className={`rounded-lg border p-2 ${
                root.resolved ? 'border-neutral-800 opacity-60' : 'border-neutral-700'
              }`}
            >
              <div className="flex items-start gap-2">
                <span
                  className="w-5 h-5 rounded-full text-[9px] flex items-center justify-center shrink-0 mt-0.5"
                  style={{ backgroundColor: root.color }}
                >
                  {root.author.slice(0, 2).toUpperCase()}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-[11px]">
                    <span className="text-neutral-300 font-medium">{root.author}</span>
                    <button
                      type="button"
                      className="text-blue-400 hover:underline font-mono"
                      onClick={() => onJump(root.path, root.line)}
                    >
                      {root.path}:{root.line}
                    </button>
                  </div>
                  <p className="text-xs text-neutral-200 mt-1 whitespace-pre-wrap">{root.text}</p>
                  <div className="flex gap-2 mt-1.5 text-[10px]">
                    {!readonly && (
                      <button
                        className="text-neutral-400 hover:text-neutral-200"
                        onClick={() => setReplyTo(root.id)}
                      >
                        Reply
                      </button>
                    )}
                    {!readonly && (
                      <button
                        className="text-neutral-400 hover:text-neutral-200"
                        onClick={() => onResolve(root.id, !root.resolved)}
                      >
                        {root.resolved ? 'Unresolve' : 'Resolve'}
                      </button>
                    )}
                    {!readonly && (
                      <button
                        className="text-red-400/80 hover:text-red-300"
                        onClick={() => onDelete(root.id)}
                      >
                        Delete
                      </button>
                    )}
                  </div>
                </div>
              </div>
              {replies.map((r) => (
                <div key={r.id} className="ml-7 mt-2 flex items-start gap-2 border-l border-neutral-800 pl-2">
                  <span
                    className="w-4 h-4 rounded-full text-[8px] flex items-center justify-center shrink-0"
                    style={{ backgroundColor: r.color }}
                  >
                    {r.author.slice(0, 1).toUpperCase()}
                  </span>
                  <div>
                    <span className="text-[10px] text-neutral-400">{r.author}</span>
                    <p className="text-xs text-neutral-300 whitespace-pre-wrap">{r.text}</p>
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>

        {!readonly && (
          <div className="border-t border-neutral-800 p-3 space-y-2">
            {replyTo && (
              <div className="text-[10px] text-neutral-400 flex justify-between">
                <span>Replying…</span>
                <button className="text-blue-400" onClick={() => setReplyTo(null)}>
                  Cancel
                </button>
              </div>
            )}
            {!replyTo && !pathFilter && (
              <div className="flex gap-2 items-center">
                <label className="text-[10px] text-neutral-500">Line</label>
                <input
                  type="number"
                  min={1}
                  className="w-16 px-2 py-1 text-xs rounded bg-neutral-950 border border-neutral-700"
                  value={line}
                  onChange={(e) => setLine(Math.max(1, Number(e.target.value) || 1))}
                />
              </div>
            )}
            {!replyTo && pathFilter && (
              <div className="flex gap-2 items-center">
                <label className="text-[10px] text-neutral-500">Line</label>
                <input
                  type="number"
                  min={1}
                  className="w-16 px-2 py-1 text-xs rounded bg-neutral-950 border border-neutral-700"
                  value={line}
                  onChange={(e) => setLine(Math.max(1, Number(e.target.value) || 1))}
                />
              </div>
            )}
            <textarea
              className="w-full px-2 py-1.5 text-sm rounded bg-neutral-950 border border-neutral-700 outline-none focus:border-blue-500 resize-none"
              rows={2}
              placeholder="Add a comment…"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit()
              }}
            />
            <button
              type="button"
              onClick={submit}
              className="text-xs bg-blue-600 hover:bg-blue-500 px-3 py-1.5 rounded"
            >
              Comment
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
