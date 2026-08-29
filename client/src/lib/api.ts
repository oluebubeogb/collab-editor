/**
 * HTTP API client for auth, rooms, snapshots, activity.
 * Base URL: same host as the WebSocket server (port 1234), or VITE_API_URL.
 */

function resolveApiBase(): string {
  const fromEnv = (import.meta.env.VITE_API_URL as string | undefined)?.trim()
  if (fromEnv) return fromEnv.replace(/\/$/, '')
  if (typeof window !== 'undefined' && window.location?.hostname) {
    const protocol = window.location.protocol === 'https:' ? 'https:' : 'http:'
    // Default: API shares the y-websocket host on :1234
    const wsEnv = (import.meta.env.VITE_WS_URL as string | undefined)?.trim()
    if (wsEnv) {
      try {
        const u = new URL(wsEnv.replace(/^ws/, 'http'))
        return `${u.protocol}//${u.host}`
      } catch {
        /* fall through */
      }
    }
    return `${protocol}//${window.location.hostname}:1234`
  }
  return 'http://localhost:1234'
}

export const API_BASE = resolveApiBase()

export interface AuthUser {
  id: string
  email: string
  displayName: string
  color?: string | null
  createdAt?: number
}

export interface RoomMeta {
  id: string
  description: string
  ownerId: string | null
  ownerName?: string | null
  isPublic?: boolean
  createdAt: number
  updatedAt: number
  lastSeen?: number
}

export interface ActivityEntry {
  id: number
  roomId: string
  userId: string | null
  displayName: string | null
  action: string
  detail: string | null
  createdAt: number
}

export interface SnapshotMeta {
  id: string
  roomId: string
  name: string
  createdBy: string | null
  createdAt: number
  payload?: SnapshotPayload
}

export interface SnapshotPayload {
  filesMeta: Record<string, { type: 'file' | 'folder'; binary: boolean; mime?: string }>
  fileTexts: Record<string, string>
  fileBinaries: Record<string, string>
  description?: string
}

async function request<T>(
  path: string,
  options: RequestInit = {}
): Promise<{ data?: T; error?: string; status: number }> {
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {})
      },
      ...options
    })
    const text = await res.text()
    let body: unknown = null
    if (text) {
      try {
        body = JSON.parse(text)
      } catch {
        body = { error: text }
      }
    }
    if (!res.ok) {
      const err =
        body && typeof body === 'object' && body !== null && 'error' in body
          ? String((body as { error: string }).error)
          : res.statusText
      return { error: err, status: res.status }
    }
    return { data: body as T, status: res.status }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Network error', status: 0 }
  }
}

export async function signup(
  email: string,
  password: string,
  displayName: string
): Promise<{ user?: AuthUser; error?: string }> {
  const r = await request<{ user: AuthUser }>('/api/auth/signup', {
    method: 'POST',
    body: JSON.stringify({ email, password, displayName })
  })
  if (r.error) return { error: r.error }
  return { user: r.data?.user }
}

export async function signin(
  email: string,
  password: string
): Promise<{ user?: AuthUser; error?: string }> {
  const r = await request<{ user: AuthUser }>('/api/auth/signin', {
    method: 'POST',
    body: JSON.stringify({ email, password })
  })
  if (r.error) return { error: r.error }
  return { user: r.data?.user }
}

export async function logout(): Promise<void> {
  await request('/api/auth/logout', { method: 'POST' })
}

export async function fetchMe(): Promise<{ user?: AuthUser; error?: string }> {
  const r = await request<{ user: AuthUser }>('/api/auth/me')
  if (r.error) return { error: r.error }
  return { user: r.data?.user }
}

export async function updateMe(patch: {
  displayName?: string
  color?: string
}): Promise<{ user?: AuthUser; error?: string }> {
  const r = await request<{ user: AuthUser }>('/api/auth/me', {
    method: 'PUT',
    body: JSON.stringify(patch)
  })
  if (r.error) return { error: r.error }
  return { user: r.data?.user }
}

export async function listMyRooms(q = ''): Promise<{ rooms?: RoomMeta[]; error?: string }> {
  const qs = new URLSearchParams({ mine: '1' })
  if (q) qs.set('q', q)
  const r = await request<{ rooms: RoomMeta[] }>(`/api/rooms?${qs}`)
  if (r.error) return { error: r.error }
  return { rooms: r.data?.rooms || [] }
}

export async function searchRooms(q: string): Promise<{ rooms?: RoomMeta[]; error?: string }> {
  const qs = new URLSearchParams()
  if (q) qs.set('q', q)
  const r = await request<{ rooms: RoomMeta[] }>(`/api/rooms?${qs}`)
  if (r.error) return { error: r.error }
  return { rooms: r.data?.rooms || [] }
}

export async function listRecentRooms(): Promise<{ rooms?: RoomMeta[]; error?: string }> {
  const r = await request<{ rooms: RoomMeta[] }>('/api/rooms/recent')
  if (r.error) return { error: r.error }
  return { rooms: r.data?.rooms || [] }
}

export async function touchRoom(roomId: string): Promise<void> {
  await request(`/api/rooms/${encodeURIComponent(roomId)}/touch`, { method: 'POST' })
}

export async function rotateRoomSecrets(
  roomId: string,
  opts: { currentPwd: string; rotatePwd?: boolean; rotateView?: boolean; displayName?: string }
): Promise<{ pwd?: string; view?: string; error?: string }> {
  const r = await request<{ pwd: string; view: string }>(
    `/api/rooms/${encodeURIComponent(roomId)}/rotate-secrets`,
    {
      method: 'POST',
      body: JSON.stringify(opts)
    }
  )
  if (r.error) return { error: r.error }
  return { pwd: r.data?.pwd, view: r.data?.view }
}

export async function createRoomMeta(
  id: string,
  description: string,
  isPublic = false
): Promise<{ room?: RoomMeta; error?: string }> {
  const r = await request<{ room: RoomMeta }>('/api/rooms', {
    method: 'POST',
    body: JSON.stringify({ id, description, isPublic })
  })
  if (r.error) return { error: r.error }
  return { room: r.data?.room }
}

export async function getRoomMeta(id: string): Promise<{ room?: RoomMeta; error?: string }> {
  const r = await request<{ room: RoomMeta }>(`/api/rooms/${encodeURIComponent(id)}`)
  if (r.error) return { error: r.error }
  return { room: r.data?.room }
}

export async function setRoomDescription(
  id: string,
  description: string
): Promise<{ room?: RoomMeta; error?: string }> {
  const r = await request<{ room: RoomMeta }>(`/api/rooms/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: JSON.stringify({ description })
  })
  if (r.error) return { error: r.error }
  return { room: r.data?.room }
}

export async function setRoomVisibility(
  id: string,
  isPublic: boolean
): Promise<{ room?: RoomMeta; error?: string }> {
  const r = await request<{ room: RoomMeta }>(`/api/rooms/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: JSON.stringify({ isPublic })
  })
  if (r.error) return { error: r.error }
  return { room: r.data?.room }
}

export async function fetchActivity(
  roomId: string
): Promise<{ activity?: ActivityEntry[]; error?: string }> {
  const r = await request<{ activity: ActivityEntry[] }>(
    `/api/rooms/${encodeURIComponent(roomId)}/activity`
  )
  if (r.error) return { error: r.error }
  return { activity: r.data?.activity || [] }
}

export async function postActivity(
  roomId: string,
  action: string,
  detail?: string,
  displayName?: string
): Promise<void> {
  await request(`/api/rooms/${encodeURIComponent(roomId)}/activity`, {
    method: 'POST',
    body: JSON.stringify({ action, detail, displayName })
  })
}

export async function listSnapshots(
  roomId: string
): Promise<{ snapshots?: SnapshotMeta[]; error?: string }> {
  const r = await request<{ snapshots: SnapshotMeta[] }>(
    `/api/rooms/${encodeURIComponent(roomId)}/snapshots`
  )
  if (r.error) return { error: r.error }
  return { snapshots: r.data?.snapshots || [] }
}

export async function createSnapshot(
  roomId: string,
  name: string,
  payload: SnapshotPayload,
  displayName?: string
): Promise<{ snapshot?: SnapshotMeta; error?: string }> {
  const r = await request<{ snapshot: SnapshotMeta }>(
    `/api/rooms/${encodeURIComponent(roomId)}/snapshots`,
    {
      method: 'POST',
      body: JSON.stringify({ name, payload, displayName })
    }
  )
  if (r.error) return { error: r.error }
  return { snapshot: r.data?.snapshot }
}

export async function getSnapshot(
  roomId: string,
  snapId: string
): Promise<{ snapshot?: SnapshotMeta; error?: string }> {
  const r = await request<{ snapshot: SnapshotMeta }>(
    `/api/rooms/${encodeURIComponent(roomId)}/snapshots/${encodeURIComponent(snapId)}`
  )
  if (r.error) return { error: r.error }
  return { snapshot: r.data?.snapshot }
}

export async function deleteSnapshot(
  roomId: string,
  snapId: string
): Promise<{ error?: string }> {
  const r = await request(
    `/api/rooms/${encodeURIComponent(roomId)}/snapshots/${encodeURIComponent(snapId)}`,
    { method: 'DELETE' }
  )
  return { error: r.error }
}

export interface EditorialRoom {
  id: string
  description: string
  isPublic?: boolean
  ownerId?: string | null
  ownerName?: string | null
  roomPwd?: string | null
  isNew?: boolean
  invitedBy?: string | null
  updatedAt?: number
}

export async function listEditorialRooms(): Promise<{ rooms?: EditorialRoom[]; error?: string }> {
  const r = await request<{ rooms: EditorialRoom[] }>('/api/rooms/editorial')
  if (r.error) return { error: r.error }
  return { rooms: r.data?.rooms || [] }
}

export async function getRoomAccess(roomId: string): Promise<{
  isOwner?: boolean
  access?: { role: string; roomPwd: string; isNew: boolean; invitedBy: string | null } | null
  error?: string
}> {
  const r = await request<{
    isOwner: boolean
    access: { role: string; roomPwd: string; isNew: boolean; invitedBy: string | null } | null
  }>(`/api/rooms/${encodeURIComponent(roomId)}/access`)
  if (r.error) return { error: r.error }
  return { isOwner: r.data?.isOwner, access: r.data?.access ?? null }
}

export async function saveRoomAccess(
  roomId: string,
  opts: { role?: string; roomPwd?: string }
): Promise<{ error?: string }> {
  const r = await request(`/api/rooms/${encodeURIComponent(roomId)}/access`, {
    method: 'POST',
    body: JSON.stringify(opts)
  })
  return r.error ? { error: r.error } : {}
}

export async function inviteEditor(
  roomId: string,
  email: string,
  roomPwd?: string
): Promise<{ error?: string; invited?: string }> {
  const r = await request<{ invited?: string }>(`/api/rooms/${encodeURIComponent(roomId)}/invite`, {
    method: 'POST',
    body: JSON.stringify({ email, roomPwd })
  })
  if (r.error) return { error: r.error }
  return { invited: r.data?.invited }
}

export async function markAccessSeen(roomId: string): Promise<void> {
  await request(`/api/rooms/${encodeURIComponent(roomId)}/access/seen`, { method: 'POST' })
}
