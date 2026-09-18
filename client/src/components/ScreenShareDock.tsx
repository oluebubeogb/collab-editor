import { useEffect, useRef, useState } from 'react'
import type { RemoteScreen } from '../hooks/useVoice'

interface Props {
  remoteScreens: RemoteScreen[]
  /** Local preview while sharing */
  localStream?: MediaStream | null
  localSharing?: boolean
}

/**
 * Floating dock for remote (and local) screen shares.
 * Best placement: bottom-right over the editor/preview, above the console.
 */
export default function ScreenShareDock({ remoteScreens, localStream, localSharing }: Props) {
  const [fullscreenId, setFullscreenId] = useState<string | null>(null)
  const items: { id: string; label: string; stream: MediaStream; local?: boolean }[] = []

  if (localSharing && localStream) {
    items.push({ id: 'local', label: 'You (sharing)', stream: localStream, local: true })
  }
  for (const s of remoteScreens) {
    items.push({ id: String(s.peerId), label: s.name, stream: s.stream })
  }

  if (items.length === 0) return null

  const fsItem = items.find((i) => i.id === fullscreenId) || null

  return (
    <>
      <div
        className="pointer-events-none fixed z-[90] flex flex-col gap-2"
        style={{ right: 16, bottom: 200, maxWidth: 320 }}
      >
        {items.map((item) => (
          <ScreenTile
            key={item.id}
            label={item.label}
            stream={item.stream}
            local={item.local}
            onFullscreen={() => setFullscreenId(item.id)}
          />
        ))}
      </div>

      {fsItem && (
        <div
          className="fixed inset-0 z-[200] flex flex-col"
          style={{ background: 'rgba(0,0,0,0.92)' }}
        >
          <div className="flex h-10 items-center gap-2 px-3 text-sm text-white/90">
            <i className="fa-solid fa-desktop" />
            <span className="font-medium">{fsItem.label}</span>
            <span className="text-white/50 text-xs">Screen share</span>
            <button
              type="button"
              className="ml-auto rounded px-3 py-1 text-xs hover:bg-white/10"
              onClick={() => setFullscreenId(null)}
            >
              <i className="fa-solid fa-compress mr-1" />
              Exit fullscreen
            </button>
          </div>
          <div className="flex flex-1 items-center justify-center p-4 min-h-0">
            <VideoEl stream={fsItem.stream} className="max-h-full max-w-full rounded-lg shadow-2xl" />
          </div>
        </div>
      )}
    </>
  )
}

function ScreenTile({
  label,
  stream,
  local,
  onFullscreen
}: {
  label: string
  stream: MediaStream
  local?: boolean
  onFullscreen: () => void
}) {
  return (
    <div
      className="pointer-events-auto overflow-hidden rounded-lg border shadow-xl"
      style={{
        background: 'var(--surface-1)',
        borderColor: 'var(--line)',
        width: 280
      }}
    >
      <div
        className="flex h-7 items-center gap-1.5 px-2 text-[11px]"
        style={{ background: 'var(--surface-2)', borderBottom: '1px solid var(--line)' }}
      >
        <i className={`fa-solid ${local ? 'fa-upload' : 'fa-desktop'} text-[10px] text-brand`} />
        <span className="truncate text-ink-soft font-medium">{label}</span>
        <button
          type="button"
          className="ml-auto icon-btn h-5 w-5 text-ink-faint"
          title="Fullscreen"
          onClick={onFullscreen}
        >
          <i className="fa-solid fa-expand text-[10px]" />
        </button>
      </div>
      <div className="bg-black aspect-video relative">
        <VideoEl stream={stream} className="absolute inset-0 h-full w-full object-contain" />
      </div>
    </div>
  )
}

function VideoEl({ stream, className }: { stream: MediaStream; className?: string }) {
  const ref = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.srcObject = stream
    void el.play().catch(() => {})
    return () => {
      el.srcObject = null
    }
  }, [stream])
  return <video ref={ref} autoPlay playsInline muted className={className} />
}
