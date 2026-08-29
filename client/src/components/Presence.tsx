import type { RemoteUserState } from '../hooks/useYjs'

interface PresenceProps {
  users: RemoteUserState[]
  status: 'connecting' | 'connected' | 'disconnected'
  localClientId?: number
  followingClientId?: number | null
  onFollow?: (clientId: number | null) => void
}

export default function Presence({
  users,
  status,
  localClientId,
  followingClientId = null,
  onFollow
}: PresenceProps) {
  return (
    <div className="flex items-center gap-3">
      <span
        className={`w-2 h-2 rounded-full ${
          status === 'connected'
            ? 'bg-green-500'
            : status === 'connecting'
            ? 'bg-yellow-500 animate-pulse'
            : 'bg-red-500'
        }`}
        title={status}
      />
      <div className="flex -space-x-2">
        {users.map((u) => {
          const inCall = !!u.voiceChannel
          const isSelf = localClientId !== undefined && u.clientId === localClientId
          const isFollowing = followingClientId === u.clientId
          const title = [
            u.name,
            isSelf ? '(you)' : '',
            inCall ? `· in ${u.voiceChannel} call${u.voiceMuted ? ' (muted)' : ''}` : '',
            isFollowing ? '· following' : '',
            !isSelf && onFollow ? '· click to follow' : ''
          ]
            .filter(Boolean)
            .join(' ')
          return (
            <button
              key={u.clientId}
              type="button"
              title={title}
              disabled={isSelf || !onFollow}
              onClick={() => {
                if (isSelf || !onFollow) return
                onFollow(isFollowing ? null : u.clientId)
              }}
              className={`relative w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-semibold border-2 ${
                isFollowing ? 'border-blue-400 ring-1 ring-blue-400/50' : 'border-neutral-900'
              } ${!isSelf && onFollow ? 'cursor-pointer hover:opacity-90' : 'cursor-default'}`}
              style={{ backgroundColor: u.color }}
            >
              {u.name.slice(0, 2).toUpperCase()}
              {inCall && (
                <span
                  className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border border-neutral-900 flex items-center justify-center text-[7px] ${
                    u.voiceMuted ? 'bg-amber-500' : 'bg-green-500'
                  }`}
                >
                  {u.voiceMuted ? 'M' : '♪'}
                </span>
              )}
            </button>
          )
        })}
      </div>
      <span className="text-xs text-neutral-400">{users.length} online</span>
      {followingClientId != null && onFollow && (
        <button
          type="button"
          onClick={() => onFollow(null)}
          className="text-[10px] text-blue-400 hover:underline"
        >
          Stop following
        </button>
      )}
    </div>
  )
}
