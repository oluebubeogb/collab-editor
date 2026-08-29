/** Per signed-in user memory of room passwords (local only). */

function storageKey(userId: string) {
  return `collab-room-pwds:${userId}`
}

function readAll(userId: string): Record<string, string> {
  try {
    const raw = localStorage.getItem(storageKey(userId))
    if (!raw) return {}
    const data = JSON.parse(raw) as Record<string, string>
    return data && typeof data === 'object' ? data : {}
  } catch {
    return {}
  }
}

function writeAll(userId: string, data: Record<string, string>) {
  try {
    localStorage.setItem(storageKey(userId), JSON.stringify(data))
  } catch {
    /* ignore */
  }
}

export function rememberRoomPassword(userId: string, roomId: string, pwd: string) {
  if (!userId || !roomId || !pwd) return
  const all = readAll(userId)
  all[roomId] = pwd
  writeAll(userId, all)
}

export function getRememberedPassword(userId: string | null | undefined, roomId: string): string {
  if (!userId || !roomId) return ''
  return readAll(userId)[roomId] || ''
}

export function forgetRoomPassword(userId: string, roomId: string) {
  if (!userId || !roomId) return
  const all = readAll(userId)
  delete all[roomId]
  writeAll(userId, all)
}
