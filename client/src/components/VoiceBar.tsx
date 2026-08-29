import type { VoiceChannel, VoicePeer } from '../hooks/useVoice'

interface VoiceBarProps {
  channel: VoiceChannel | null
  muted: boolean
  joining: boolean
  error: string | null
  peers: VoicePeer[]
  readonly: boolean
  screenSharing?: boolean
  onJoin: (ch: VoiceChannel) => void
  onLeave: () => void
  onToggleMute: () => void
  onToggleScreen?: () => void
}

export default function VoiceBar({
  channel,
  muted,
  joining,
  error,
  peers,
  readonly,
  screenSharing = false,
  onJoin,
  onLeave,
  onToggleMute,
  onToggleScreen
}: VoiceBarProps) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      {!channel ? (
        <>
          <button
            type="button"
            disabled={joining}
            onClick={() => onJoin('general')}
            className="text-[11px] px-2 py-1 rounded border border-neutral-700 text-neutral-300 hover:bg-neutral-800 disabled:opacity-40"
            title="Join General voice call (everyone)"
          >
            {joining ? '…' : '📞 General'}
          </button>
          {!readonly && (
            <button
              type="button"
              disabled={joining}
              onClick={() => onJoin('editors')}
              className="text-[11px] px-2 py-1 rounded border border-violet-700/50 text-violet-300 hover:bg-violet-900/30 disabled:opacity-40"
              title="Join Editors voice call (edit access only)"
            >
              {joining ? '…' : '📞 Editors'}
            </button>
          )}
        </>
      ) : (
        <>
          <span
            className={`text-[11px] px-2 py-1 rounded border ${
              channel === 'editors'
                ? 'border-violet-500/50 text-violet-300 bg-violet-500/10'
                : 'border-green-500/50 text-green-300 bg-green-500/10'
            }`}
          >
            In {channel === 'editors' ? 'Editors' : 'General'} call
            {peers.length > 0 ? ` · ${peers.length} peer${peers.length === 1 ? '' : 's'}` : ' · waiting…'}
          </span>
          <button
            type="button"
            onClick={onToggleMute}
            className={`text-[11px] px-2 py-1 rounded border ${
              muted
                ? 'border-amber-500/60 text-amber-300 bg-amber-500/10'
                : 'border-neutral-700 text-neutral-300 hover:bg-neutral-800'
            }`}
          >
            {muted ? 'Unmute' : 'Mute'}
          </button>
          {onToggleScreen && (
            <button
              type="button"
              onClick={onToggleScreen}
              className={`text-[11px] px-2 py-1 rounded border ${
                screenSharing
                  ? 'border-blue-500/60 text-blue-300 bg-blue-500/10'
                  : 'border-neutral-700 text-neutral-300 hover:bg-neutral-800'
              }`}
            >
              {screenSharing ? 'Stop share' : 'Share screen'}
            </button>
          )}
          <button
            type="button"
            onClick={onLeave}
            className="text-[11px] px-2 py-1 rounded border border-red-500/50 text-red-300 hover:bg-red-900/30"
          >
            Leave
          </button>
        </>
      )}
      {error && <span className="text-[10px] text-red-400 max-w-[200px] truncate" title={error}>{error}</span>}
    </div>
  )
}
