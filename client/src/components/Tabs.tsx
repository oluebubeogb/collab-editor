import { isChatTab, chatTabLabel } from '../lib/chat'

interface TabsProps {
  openPaths: string[]
  activePath: string | null
  onSelect: (path: string) => void
  onClose: (path: string) => void
  /** Optional unread counts keyed by tab path */
  unreadByPath?: Record<string, number>
}

function tabLabel(path: string): string {
  if (path === '__chat__/general') return 'General'
  if (path === '__chat__/editors') return 'Editors'
  if (path === '__messages__') return 'Messages'
  if (path === '__phone__') return 'Phone'
  if (path === '__collaborators__') return 'Collaborators'
  if (path === '__invite__') return 'Invite'
  if (path.startsWith('__chat__/dm:')) {
    const key = path.slice('__chat__/dm:'.length)
    const parts = key.split('|')
    return parts.length === 2 ? `DM · ${parts[1] || parts[0]}` : 'DM'
  }
  const parts = path.split('/')
  return parts[parts.length - 1] || path
}

export default function Tabs({
  openPaths,
  activePath,
  onSelect,
  onClose,
  unreadByPath = {}
}: TabsProps) {
  return (
    <div
      className="flex h-9 shrink-0 items-end overflow-x-auto border-b px-1"
      style={{ background: 'var(--surface-1)', borderColor: 'var(--line)' }}
    >
      {openPaths.map((path, i) => {
        const active = path === activePath
        const label = tabLabel(path)
        const unread = unreadByPath[path] || 0
        return (
          <div
            key={path}
            className={`group relative flex h-8 max-w-[160px] items-center gap-1.5 border-b-2 px-2.5 text-[12px] transition-colors ${
              active
                ? 'border-brand text-ink'
                : 'border-transparent text-ink-soft hover:text-ink-muted'
            }`}
            style={{
              background: active ? 'var(--surface-2)' : undefined,
              borderRight:
                i < openPaths.length - 1 ? '1px solid var(--line)' : undefined
            }}
          >
            <button
              type="button"
              className="flex min-w-0 flex-1 items-center gap-1.5"
              onClick={() => onSelect(path)}
              title={isChatTab(path) ? chatTabLabel(path) : path}
            >
              <span className="truncate font-medium">{label}</span>
              {unread > 0 && (
                <span
                  className="flex h-4 min-w-[16px] shrink-0 items-center justify-center rounded-full px-1 text-[9px] font-semibold text-white"
                  style={{ background: 'var(--accent)' }}
                >
                  {unread > 99 ? '99+' : unread}
                </span>
              )}
            </button>
            <button
              type="button"
              aria-label={`Close ${label}`}
              className="flex h-4 w-4 shrink-0 items-center justify-center rounded text-ink-faint opacity-0 transition-opacity hover:bg-[var(--surface-3)] hover:text-ink group-hover:opacity-100"
              onClick={(e) => {
                e.stopPropagation()
                onClose(path)
              }}
            >
              <i className="fa-solid fa-xmark text-[9px]" />
            </button>
          </div>
        )
      })}
    </div>
  )
}
