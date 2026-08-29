import { useEffect, useMemo, useState } from 'react'
import { resolveHtml } from '../lib/resolvePreview'

export type DeviceFrame = 'full' | 'tablet' | 'phone'

interface PreviewProps {
  texts: Record<string, string>
  binaries: Record<string, string>
  entryPath: string | null
  minimal?: boolean
}

interface ConsoleLine {
  level: string
  args: string[]
  ts: number
  stack?: string
}

const DEVICE_WIDTHS: Record<DeviceFrame, number | null> = {
  full: null,
  tablet: 768,
  phone: 390
}

export default function Preview({ texts, binaries, entryPath, minimal = false }: PreviewProps) {
  const [consoleLines, setConsoleLines] = useState<ConsoleLine[]>([])
  const [showConsole, setShowConsole] = useState(false)
  const [device, setDevice] = useState<DeviceFrame>('full')
  const [iframeKey, setIframeKey] = useState(0)

  const srcDoc = useMemo(() => {
    if (!entryPath) {
      return `<body style="font-family:Inter,sans-serif;color:#888;padding:24px;background:#111">
        Select an HTML file and set it as preview entry.
      </body>`
    }
    return resolveHtml(entryPath, texts, binaries, new Set())
  }, [texts, binaries, entryPath])

  useEffect(() => {
    setConsoleLines([])
    const handler = (e: MessageEvent) => {
      if (!e.data) return
      if (e.data.type === 'vfs-console') {
        setConsoleLines((prev) => [
          ...prev.slice(-300),
          { level: e.data.level, args: e.data.args, ts: Date.now(), stack: e.data.stack }
        ])
        if (e.data.level === 'error') setShowConsole(true)
      }
      if (e.data.type === 'vfs-error') {
        setConsoleLines((prev) => [
          ...prev.slice(-300),
          {
            level: 'error',
            args: [e.data.message || 'Uncaught error'],
            ts: Date.now(),
            stack: e.data.stack
          }
        ])
        setShowConsole(true)
      }
    }
    window.addEventListener('message', handler)
    return () => window.removeEventListener('message', handler)
  }, [entryPath])

  useEffect(() => {
    setIframeKey((k) => k + 1)
  }, [entryPath])

  const width = DEVICE_WIDTHS[device]
  const errorCount = consoleLines.filter((l) => l.level === 'error').length

  const deviceBtn = (d: DeviceFrame, icon: string, label: string) => (
    <div className="tooltip-wrap" key={d}>
      <button
        type="button"
        aria-label={label}
        onClick={() => setDevice(d)}
        className={`flex h-7 w-7 items-center justify-center rounded-md transition-colors ${
          device === d ? 'bg-brand-dim text-brand' : 'text-ink-faint hover:text-ink-muted'
        }`}
      >
        <i className={`fa-solid ${icon} text-[12px]`} />
      </button>
      <span className="tooltip">{label}</span>
    </div>
  )

  return (
    <div className="flex h-full flex-col" style={{ background: 'var(--surface-preview)' }}>
      {!minimal && (
        <div
          className="flex h-9 shrink-0 items-center gap-2 border-b px-2"
          style={{ borderColor: 'var(--line)', background: 'var(--surface-1)' }}
        >
          <span className="flex items-center gap-1.5 text-[11px] font-medium text-brand">
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: 'var(--accent)' }} />
            LIVE PREVIEW
          </span>
          <span className="flex-1 truncate text-[10px] text-ink-faint font-mono">
            {entryPath || 'No entry'}
          </span>

          <div className="tooltip-wrap">
            <button
              type="button"
              aria-label="Open preview in new tab"
              onClick={() => {
                const blob = new Blob([srcDoc], { type: 'text/html;charset=utf-8' })
                const url = URL.createObjectURL(blob)
                const w = window.open(url, '_blank')
                if (!w) URL.revokeObjectURL(url)
                else {
                  // revoke after the tab has a chance to load
                  window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
                }
              }}
              className="icon-btn h-7 w-7"
            >
              <i className="fa-solid fa-arrow-up-right-from-square text-[12px]" />
            </button>
            <span className="tooltip">Open in new tab</span>
          </div>

          <div className="flex items-center gap-0.5">
            {deviceBtn('full', 'fa-desktop', 'Desktop preview')}
            {deviceBtn('tablet', 'fa-tablet-screen-button', 'Tablet preview')}
            {deviceBtn('phone', 'fa-mobile-screen-button', 'Mobile preview')}
          </div>

          <div className="mx-1 h-4 w-px" style={{ background: 'var(--line)' }} />

          <div className="tooltip-wrap">
            <button
              type="button"
              aria-label="Reload preview"
              onClick={() => setIframeKey((k) => k + 1)}
              className="icon-btn h-7 w-7"
            >
              <i className="fa-solid fa-rotate text-[12px]" />
            </button>
            <span className="tooltip">Reload</span>
          </div>
          <div className="tooltip-wrap">
            <button
              type="button"
              aria-label="Toggle console"
              onClick={() => setShowConsole((v) => !v)}
              className={`icon-btn h-7 w-7 ${showConsole ? 'active' : ''} ${
                errorCount ? 'text-danger' : ''
              }`}
            >
              <i className="fa-solid fa-terminal text-[12px]" />
            </button>
            <span className="tooltip">
              Console{consoleLines.length ? ` (${consoleLines.length})` : ''}
            </span>
          </div>
        </div>
      )}

      <div className="flex min-h-0 flex-1 justify-center overflow-auto" style={{ background: 'var(--surface-preview)' }}>
        <div
          className={`h-full bg-white ${width ? 'shadow-lg border-x' : 'w-full'}`}
          style={width ? { width, maxWidth: '100%', borderColor: 'var(--line)' } : undefined}
        >
          <iframe
            key={iframeKey}
            title="live-preview"
            srcDoc={srcDoc}
            sandbox="allow-scripts"
            className="h-full w-full border-0 bg-white"
          />
        </div>
      </div>

      {showConsole && !minimal && (
        <div
          className="h-28 shrink-0 overflow-y-auto border-t p-2 font-mono text-[11px]"
          style={{ borderColor: 'var(--line)', background: 'var(--surface-1)' }}
        >
          {consoleLines.length === 0 && <div className="text-ink-faint">No console output yet.</div>}
          {consoleLines.map((line, i) => (
            <div
              key={i}
              className={
                line.level === 'error'
                  ? 'text-red-400 mb-0.5'
                  : line.level === 'warn'
                  ? 'text-amber-400 mb-0.5'
                  : 'text-ink-soft mb-0.5'
              }
            >
              <span className="text-ink-faint mr-2">
                {new Date(line.ts).toLocaleTimeString()} {line.level}
              </span>
              {line.args.join(' ')}
              {line.stack && (
                <pre className="ml-4 mt-0.5 whitespace-pre-wrap text-[10px] text-red-400/70">
                  {line.stack}
                </pre>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
