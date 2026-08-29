import { useEffect, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import Preview from '../components/Preview'
import { useYjs } from '../hooks/useYjs'
import { randomColor, randomDisplayName } from '../lib/id'
import type { FileMetaValue } from '../hooks/useYjs'

/**
 * Minimal chrome live preview for share links:
 * /preview/:roomId?view=...
 */
export default function PreviewOnly() {
  const { roomId = '' } = useParams()
  const [searchParams] = useSearchParams()
  const viewKey = searchParams.get('view') || ''
  const entry = searchParams.get('entry') || 'index.html'

  const user = { name: randomDisplayName(), color: randomColor() }
  const { ready, synced, filesMeta, fileTexts, fileBinaries, status } = useYjs(
    roomId,
    user,
    '',
    viewKey,
    true,
    !!viewKey
  )

  const [texts, setTexts] = useState<Record<string, string>>({})
  const [binaries, setBinaries] = useState<Record<string, string>>({})
  const [entryPath, setEntryPath] = useState<string | null>(entry)

  useEffect(() => {
    if (!ready) return
    const texts_ = fileTexts()
    const binaries_ = fileBinaries()
    const meta = filesMeta()

    const sync = () => {
      const t: Record<string, string> = {}
      texts_.forEach((y, p) => {
        t[p] = y.toString()
      })
      setTexts(t)
      const b: Record<string, string> = {}
      binaries_.forEach((v, p) => {
        b[p] = v
      })
      setBinaries(b)
      if (!meta.has(entry) && meta.size > 0) {
        const firstHtml = Array.from(meta.entries()).find(
          ([p, m]) => (m as FileMetaValue).type === 'file' && p.endsWith('.html')
        )
        if (firstHtml) setEntryPath(firstHtml[0])
      }
    }
    sync()
    texts_.observeDeep(sync)
    binaries_.observeDeep(sync)
    meta.observeDeep(sync)
    return () => {
      texts_.unobserveDeep(sync)
      binaries_.unobserveDeep(sync)
      meta.unobserveDeep(sync)
    }
  }, [ready, fileTexts, fileBinaries, filesMeta, entry])

  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (e.data?.type === 'vfs-navigate' && typeof e.data.path === 'string') {
        setEntryPath(e.data.path)
      }
    }
    window.addEventListener('message', handler)
    return () => window.removeEventListener('message', handler)
  }, [])

  if (!viewKey) {
    return (
      <div className="h-screen flex items-center justify-center bg-neutral-950 text-neutral-400 text-sm">
        Preview links require a view key (?view=…).
      </div>
    )
  }

  if (!ready || !synced) {
    return (
      <div className="h-screen flex items-center justify-center bg-neutral-950 text-neutral-400 text-sm">
        Loading preview… ({status})
      </div>
    )
  }

  return (
    <div className="h-screen">
      <Preview texts={texts} binaries={binaries} entryPath={entryPath} minimal />
    </div>
  )
}
