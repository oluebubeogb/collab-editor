import { nanoid } from './id'

export type ChatChannel = string // 'general' | 'editors' | 'dm:nameA|nameB'
export type ChatMessageType = 'text' | 'image' | 'voice'

export interface ChatMessage {
  id: string
  channel: ChatChannel
  type: ChatMessageType
  text?: string
  dataUrl?: string
  durationSec?: number
  author: string
  color: string
  ts: number
  pinned?: boolean
  mentions?: string[]
}

export const CHAT_GENERAL = '__chat__/general'
export const CHAT_EDITORS = '__chat__/editors'
export const CHAT_DM_PREFIX = '__chat__/dm:'

export function isChatTab(path: string | null | undefined): path is string {
  if (!path) return false
  return path === CHAT_GENERAL || path === CHAT_EDITORS || path.startsWith(CHAT_DM_PREFIX)
}

export function chatTabLabel(path: string): string {
  if (path === CHAT_GENERAL) return 'General'
  if (path === CHAT_EDITORS) return 'Editors'
  if (path.startsWith(CHAT_DM_PREFIX)) {
    const key = path.slice(CHAT_DM_PREFIX.length)
    return `DM · ${key.split('|').join(' & ')}`
  }
  return path
}

export function channelFromTab(path: string): ChatChannel | null {
  if (path === CHAT_GENERAL) return 'general'
  if (path === CHAT_EDITORS) return 'editors'
  if (path.startsWith(CHAT_DM_PREFIX)) return `dm:${path.slice(CHAT_DM_PREFIX.length)}`
  return null
}

export function tabFromChannel(channel: ChatChannel): string {
  if (channel === 'general') return CHAT_GENERAL
  if (channel === 'editors') return CHAT_EDITORS
  if (channel.startsWith('dm:')) return `${CHAT_DM_PREFIX}${channel.slice(3)}`
  return CHAT_GENERAL
}

/** Stable DM channel id from two display names (order-independent). */
export function dmChannelId(nameA: string, nameB: string): string {
  const pair = [nameA.trim().toLowerCase(), nameB.trim().toLowerCase()].sort()
  return `dm:${pair[0]}|${pair[1]}`
}

export function isDmChannel(channel: string): boolean {
  return channel.startsWith('dm:')
}

export function createTextMessage(
  channel: ChatChannel,
  text: string,
  author: string,
  color: string,
  mentions?: string[]
): ChatMessage {
  return {
    id: nanoid(12),
    channel,
    type: 'text',
    text,
    author,
    color,
    ts: Date.now(),
    mentions
  }
}

export function formatChatTime(ts: number): string {
  const d = new Date(ts)
  const now = new Date()
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  if (sameDay) {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }
  return d.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}

export function extractMentions(text: string): string[] {
  const found = new Set<string>()
  const re = /@([a-zA-Z0-9_\-.\s]{1,40})/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    found.add(m[1].trim())
  }
  return Array.from(found)
}

export function makeTextMessage(
  channel: ChatChannel,
  text: string,
  author: string,
  color: string
): ChatMessage {
  return {
    id: nanoid(12),
    channel,
    type: 'text',
    text,
    author,
    color,
    ts: Date.now(),
    mentions: extractMentions(text)
  }
}

export function makeImageMessage(
  channel: ChatChannel,
  dataUrl: string,
  author: string,
  color: string,
  caption?: string
): ChatMessage {
  return {
    id: nanoid(12),
    channel,
    type: 'image',
    dataUrl,
    text: caption,
    author,
    color,
    ts: Date.now()
  }
}

export function makeVoiceMessage(
  channel: ChatChannel,
  dataUrl: string,
  durationSec: number,
  author: string,
  color: string
): ChatMessage {
  return {
    id: nanoid(12),
    channel,
    type: 'voice',
    dataUrl,
    durationSec,
    author,
    color,
    ts: Date.now()
  }
}


export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(reader.error || new Error('Failed to read blob'))
    reader.readAsDataURL(blob)
  })
}

/** Resize/compress an image file to ~360px max edge as WebP data URL. */
export async function imageFileToWebp360(file: File, maxEdge = 360, quality = 0.82): Promise<string> {
  const dataUrl = await blobToDataUrl(file)
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image()
    el.onload = () => resolve(el)
    el.onerror = () => reject(new Error('Failed to decode image'))
    el.src = dataUrl
  })
  const scale = Math.min(1, maxEdge / Math.max(img.width, img.height))
  const w = Math.max(1, Math.round(img.width * scale))
  const h = Math.max(1, Math.round(img.height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) return dataUrl
  ctx.drawImage(img, 0, 0, w, h)
  try {
    return canvas.toDataURL('image/webp', quality)
  } catch {
    return canvas.toDataURL('image/jpeg', quality)
  }
}
