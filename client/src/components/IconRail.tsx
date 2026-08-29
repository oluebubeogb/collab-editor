import { useTheme } from '../hooks/useTheme'

export type RailPanel =
  | 'files'
  | 'search'
  | 'collaborators'
  | 'chat'
  | 'voice'
  | 'media'
  | 'settings'
  | 'invite'
  | null

interface IconRailProps {
  active: RailPanel
  explorerOpen: boolean
  onToggleExplorer: () => void
  onSelect: (panel: RailPanel) => void
  onOpenSearch: () => void
  onOpenChat: () => void
  onOpenCollaborators: () => void
  onOpenSettings?: () => void
  onOpenVoice?: () => void
  onOpenInvite?: () => void
  unreadMessages?: number
  showInvite?: boolean
}

function RailButton({
  icon,
  label,
  active,
  onClick,
  badge
}: {
  icon: string
  label: string
  active?: boolean
  onClick: () => void
  badge?: number
}) {
  return (
    <div className="tooltip-wrap relative">
      <button
        type="button"
        aria-label={label}
        onClick={onClick}
        className={`icon-btn ${active ? 'active' : ''}`}
      >
        <i className={`fa-solid ${icon} text-[15px]`} />
      </button>
      {badge != null && badge > 0 && (
        <span
          className="absolute -right-0.5 -top-0.5 flex h-4 min-w-[16px] items-center justify-center rounded-full px-1 text-[9px] font-semibold text-white"
          style={{ background: 'var(--accent)' }}
        >
          {badge > 99 ? '99+' : badge}
        </span>
      )}
      <span className="tooltip">{label}</span>
    </div>
  )
}

export default function IconRail({
  active,
  explorerOpen,
  onToggleExplorer,
  onSelect,
  onOpenSearch,
  onOpenChat,
  onOpenCollaborators,
  onOpenSettings,
  onOpenVoice,
  onOpenInvite,
  unreadMessages = 0,
  showInvite = false
}: IconRailProps) {
  const { theme, toggle } = useTheme()

  return (
    <aside
      className="flex w-[56px] shrink-0 flex-col items-center border-r py-2 gap-0.5"
      style={{ background: 'var(--rail)', borderColor: 'var(--line)' }}
    >
      <div className="tooltip-wrap mb-1">
        <button
          type="button"
          aria-label={explorerOpen ? 'Hide files' : 'Show files'}
          aria-pressed={explorerOpen}
          onClick={onToggleExplorer}
          className={`icon-btn font-mono text-sm font-semibold ${explorerOpen ? 'active' : ''}`}
        >
          <span className="text-brand">{'</>'}</span>
        </button>
        <span className="tooltip">{explorerOpen ? 'Hide files' : 'Show files'}</span>
      </div>

      <div className="my-1 h-px w-8" style={{ background: 'var(--line)' }} />

      <RailButton
        icon="fa-file-code"
        label="Files"
        active={active === 'files' || explorerOpen}
        onClick={() => {
          onSelect('files')
          if (!explorerOpen) onToggleExplorer()
        }}
      />
      <RailButton icon="fa-magnifying-glass" label="Search" active={active === 'search'} onClick={onOpenSearch} />
      <RailButton
        icon="fa-user-group"
        label="Collaborators"
        active={active === 'collaborators'}
        onClick={onOpenCollaborators}
      />
      <RailButton
        icon="fa-message"
        label="Messages"
        active={active === 'chat'}
        onClick={onOpenChat}
        badge={unreadMessages}
      />
      <RailButton
        icon="fa-phone"
        label="Phone"
        active={active === 'voice'}
        onClick={() => {
          onOpenVoice?.()
          onSelect('voice')
        }}
      />
      {showInvite && (
        <RailButton
          icon="fa-user-plus"
          label="Invite editor"
          active={active === 'invite'}
          onClick={() => onOpenInvite?.()}
        />
      )}
      <RailButton
        icon="fa-image"
        label="Shared Media"
        active={active === 'media'}
        onClick={() => onSelect('media')}
      />

      <div className="flex-1" />

      <RailButton
        icon="fa-gear"
        label="Settings"
        active={active === 'settings'}
        onClick={() => onOpenSettings?.()}
      />
      <div className="tooltip-wrap">
        <button
          type="button"
          aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          onClick={toggle}
          className="icon-btn"
        >
          <i className={`fa-solid ${theme === 'dark' ? 'fa-sun' : 'fa-moon'} text-[15px]`} />
        </button>
        <span className="tooltip">{theme === 'dark' ? 'Light mode' : 'Dark mode'}</span>
      </div>
    </aside>
  )
}
