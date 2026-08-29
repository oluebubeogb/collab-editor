import type { FileMetaValue } from '../hooks/useYjs'

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

export function downloadFile(
  path: string,
  texts: Record<string, string>,
  binaries: Record<string, string>
) {
  const name = path.split('/').pop() || path
  if (texts[path] !== undefined) {
    triggerDownload(new Blob([texts[path]], { type: 'text/plain;charset=utf-8' }), name)
    return
  }
  if (binaries[path] !== undefined) {
    fetch(binaries[path])
      .then((r) => r.blob())
      .then((blob) => triggerDownload(blob, name))
      .catch(() => {
        triggerDownload(new Blob([binaries[path]], { type: 'text/plain' }), name + '.txt')
      })
    return
  }
  window.alert(`File not found: ${path}`)
}

export async function exportRoomAsZip(
  entries: { path: string; meta: FileMetaValue }[],
  texts: Record<string, string>,
  binaries: Record<string, string>,
  roomId: string
) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let JSZipCtor: any
  try {
    const mod = await import('jszip')
    JSZipCtor = mod.default ?? mod
  } catch {
    window.alert('ZIP export requires the jszip package. Run: npm install jszip')
    return
  }

  const zip = new JSZipCtor()
  for (const { path, meta } of entries) {
    if (meta.type === 'folder') {
      zip.folder(path)
      continue
    }
    if (texts[path] !== undefined) {
      zip.file(path, texts[path])
    } else if (binaries[path] !== undefined) {
      const base64 = binaries[path].split(',')[1]
      if (base64) zip.file(path, base64, { base64: true })
    }
  }
  const blob = await zip.generateAsync({ type: 'blob' })
  triggerDownload(blob, `room-${roomId}.zip`)
}
