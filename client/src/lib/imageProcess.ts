/**
 * Client-side image resize / convert for uploads and git pull.
 */

const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'avif'])

export function isImagePath(path: string): boolean {
  const ext = path.split('.').pop()?.toLowerCase() || ''
  return IMAGE_EXT.has(ext)
}

export function imageMimeFromPath(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() || ''
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg'
  if (ext === 'png') return 'image/png'
  if (ext === 'gif') return 'image/gif'
  if (ext === 'webp') return 'image/webp'
  if (ext === 'bmp') return 'image/bmp'
  if (ext === 'avif') return 'image/avif'
  return 'application/octet-stream'
}

function loadImageFromBlob(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve(img)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('Failed to decode image'))
    }
    img.src = url
  })
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  mime: string,
  quality: number
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('toBlob failed'))),
      mime,
      quality
    )
  })
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(r.result as string)
    r.onerror = () => reject(new Error('read failed'))
    r.readAsDataURL(blob)
  })
}

/**
 * Resize so the longest edge is at most maxEdge (default 720).
 * - format 'webp': always output image/webp
 * - format 'keep': preserve jpeg/png/webp (gif → png)
 */
export async function processImage(
  source: Blob | ArrayBuffer | string,
  opts: {
    maxEdge?: number
    format: 'webp' | 'keep'
    quality?: number
    /** original path for keep-mime detection */
    pathHint?: string
  }
): Promise<{ dataUrl: string; mime: string; ext: string }> {
  const maxEdge = opts.maxEdge ?? 720
  const quality = opts.quality ?? 0.82

  let blob: Blob
  if (typeof source === 'string') {
    // data URL or fetch later
    if (source.startsWith('data:')) {
      const res = await fetch(source)
      blob = await res.blob()
    } else {
      // assume base64 raw
      const bin = atob(source.replace(/\s/g, ''))
      const bytes = new Uint8Array(bin.length)
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
      blob = new Blob([bytes])
    }
  } else if (source instanceof ArrayBuffer) {
    blob = new Blob([source])
  } else {
    blob = source
  }

  const img = await loadImageFromBlob(blob)
  let { width, height } = img
  if (width <= 0 || height <= 0) {
    throw new Error('Invalid image dimensions')
  }

  const scale = Math.min(1, maxEdge / Math.max(width, height))
  const w = Math.max(1, Math.round(width * scale))
  const h = Math.max(1, Math.round(height * scale))

  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('No canvas context')
  ctx.drawImage(img, 0, 0, w, h)

  let mime = 'image/webp'
  let ext = 'webp'

  if (opts.format === 'keep') {
    const hint = (opts.pathHint || '').toLowerCase()
    if (hint.endsWith('.png')) {
      mime = 'image/png'
      ext = 'png'
    } else if (hint.endsWith('.jpg') || hint.endsWith('.jpeg')) {
      mime = 'image/jpeg'
      ext = hint.endsWith('.jpeg') ? 'jpeg' : 'jpg'
    } else if (hint.endsWith('.webp')) {
      mime = 'image/webp'
      ext = 'webp'
    } else if (hint.endsWith('.gif')) {
      // static frame as png
      mime = 'image/png'
      ext = 'png'
    } else {
      mime = blob.type || 'image/png'
      ext = mime.includes('jpeg') ? 'jpg' : mime.includes('webp') ? 'webp' : 'png'
    }
  }

  const outBlob = await canvasToBlob(canvas, mime, quality)
  const dataUrl = await blobToDataUrl(outBlob)
  return { dataUrl, mime, ext }
}

/** child.png → child.webp (same basename). */
export function pathWithWebpExt(path: string): string {
  const i = path.lastIndexOf('.')
  if (i <= 0) return path + '.webp'
  return path.slice(0, i) + '.webp'
}
