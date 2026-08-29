// Central place that decides how a file extension should be treated:
// which Monaco language to use for syntax highlighting, whether it's
// text (editable, synced character-by-character via Yjs) or binary
// (uploaded as a data URL, synced as a single blob), and what MIME
// type to assign when resolving it in the live preview.

const BINARY_EXTENSIONS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'ico', 'bmp', 'avif',
  'woff', 'woff2', 'ttf', 'otf', 'eot',
  'mp3', 'mp4', 'wav', 'ogg', 'webm',
  'pdf', 'zip'
])

const LANGUAGE_BY_EXT: Record<string, string> = {
  html: 'html',
  htm: 'html',
  css: 'css',
  scss: 'scss',
  less: 'less',
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  ts: 'typescript',
  tsx: 'typescript',
  json: 'json',
  md: 'markdown',
  xml: 'xml',
  svg: 'xml',
  yml: 'yaml',
  yaml: 'yaml',
  py: 'python',
  java: 'java',
  c: 'c',
  h: 'c',
  cpp: 'cpp',
  cs: 'csharp',
  go: 'go',
  rs: 'rust',
  php: 'php',
  sql: 'sql',
  sh: 'shell',
  txt: 'plaintext'
}

const MIME_BY_EXT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  ico: 'image/x-icon',
  bmp: 'image/bmp',
  avif: 'image/avif',
  svg: 'image/svg+xml',
  woff: 'font/woff',
  woff2: 'font/woff2',
  ttf: 'font/ttf',
  otf: 'font/otf'
}

export function getExtension(path: string): string {
  const name = path.split('/').pop() || ''
  const dot = name.lastIndexOf('.')
  if (dot === -1) return ''
  return name.slice(dot + 1).toLowerCase()
}

export function getFileName(path: string): string {
  return path.split('/').pop() || path
}

export function getParentFolder(path: string): string | null {
  const idx = path.lastIndexOf('/')
  return idx === -1 ? null : path.slice(0, idx)
}

export function isTextFile(path: string): boolean {
  const ext = getExtension(path)
  if (!ext) return true // extensionless files (e.g. "Dockerfile") -> treat as text
  return !BINARY_EXTENSIONS.has(ext)
}

export function getMonacoLanguage(path: string): string {
  return LANGUAGE_BY_EXT[getExtension(path)] || 'plaintext'
}

export function getMimeType(path: string): string {
  return MIME_BY_EXT[getExtension(path)] || 'application/octet-stream'
}

export function isHtmlFile(path: string): boolean {
  const ext = getExtension(stripQueryAndHash(path))
  return ext === 'html' || ext === 'htm'
}

/** Strips a trailing "?query" and/or "#hash" so extension/existence checks
 * work on the bare file path (e.g. "incident.html?case=123" -> "incident.html"). */
export function stripQueryAndHash(path: string): string {
  const idx = path.search(/[?#]/)
  return idx === -1 ? path : path.slice(0, idx)
}

/** The "?query#hash" suffix of a path, if any (empty string if none). */
export function getQueryAndHash(path: string): string {
  const idx = path.search(/[?#]/)
  return idx === -1 ? '' : path.slice(idx)
}

/**
 * Resolves a relative reference (from an href/src attribute) against the
 * folder of the file that references it, producing a normalized path that
 * can be looked up directly in the virtual file map. Returns null for
 * references that aren't relative local paths (http(s), data:, #, mailto:).
 */
export function resolveRelativePath(basePath: string, ref: string): string | null {
  const trimmed = ref.trim()
  if (!trimmed) return null
  if (/^([a-z]+:)?\/\//i.test(trimmed)) return null // http://, https://, //cdn...
  if (/^(data|mailto|tel|javascript):/i.test(trimmed)) return null
  if (trimmed.startsWith('#')) return null

  // A leading "/" means "relative to the room root", not "relative to the
  // current file's folder" -- resolve it from the root instead of
  // silently nesting it under the current folder.
  const isRootRelative = trimmed.startsWith('/')

  const baseFolder = isRootRelative ? null : getParentFolder(basePath)
  const segments = (baseFolder ? baseFolder.split('/') : []).concat(
    trimmed.split('/').filter((s) => s.length > 0)
  )

  const resolved: string[] = []
  for (const seg of segments) {
    if (seg === '.') continue
    if (seg === '..') resolved.pop()
    else resolved.push(seg)
  }
  return resolved.join('/')
}
