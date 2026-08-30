const http = require('http')
const https = require('https')
const fs = require('fs')
const path = require('path')
const { URL } = require('url')
const crypto = require('crypto')
const WebSocket = require('ws')
const bcrypt = require('bcryptjs')
const { setupWSConnection } = require('y-websocket/bin/utils')

// Load server/.env into process.env (does not override existing vars)
try {
  const envPath = path.join(__dirname, '.env')
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const eq = trimmed.indexOf('=')
      if (eq <= 0) continue
      const key = trimmed.slice(0, eq).trim()
      let val = trimmed.slice(eq + 1).trim()
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1)
      }
      if (process.env[key] === undefined) process.env[key] = val
    }
  }
} catch {
  /* ignore */
}

const db = require('./db')

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data')
const PASSWORDS_FILE = path.join(DATA_DIR, 'room-passwords.json')
const SESSION_COOKIE = 'collab_session'
const BCRYPT_ROUNDS = 10

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true })
}

/**
 * Room secrets shape (persisted):
 *   { pwd: string, view: string }
 * Legacy entries may be a plain string (treated as pwd only).
 */
function normalizeSecret(value) {
  if (value == null) return null
  if (typeof value === 'string') return { pwd: value, view: '' }
  if (typeof value === 'object' && typeof value.pwd === 'string') {
    return { pwd: value.pwd, view: typeof value.view === 'string' ? value.view : '' }
  }
  return null
}

function loadPasswords() {
  try {
    if (fs.existsSync(PASSWORDS_FILE)) {
      const raw = JSON.parse(fs.readFileSync(PASSWORDS_FILE, 'utf8'))
      const map = new Map()
      for (const [k, v] of Object.entries(raw)) {
        const n = normalizeSecret(v)
        if (n) map.set(k, n)
      }
      return map
    }
  } catch (e) {
    console.warn('Failed to load room passwords:', e.message)
  }
  return new Map()
}

function savePasswords(map) {
  try {
    fs.writeFileSync(PASSWORDS_FILE, JSON.stringify(Object.fromEntries(map), null, 2))
  } catch (e) {
    console.warn('Failed to save room passwords:', e.message)
  }
}

const roomPasswords = loadPasswords()

let persistence = null
try {
  const { LeveldbPersistence } = require('y-leveldb')
  persistence = new LeveldbPersistence(path.join(DATA_DIR, 'ydocs'))
  console.log('Yjs LevelDB persistence enabled at', path.join(DATA_DIR, 'ydocs'))
} catch (e) {
  console.warn('y-leveldb not available – document content will not survive restarts.')
  console.warn('Run: cd server && npm install y-leveldb')
}

function loadTlsOptions() {
  const candidates = [
    path.join(__dirname, 'certs'),
    path.join(__dirname, '..', 'client', 'certs')
  ]
  for (const dir of candidates) {
    const key = path.join(dir, 'key.pem')
    const cert = path.join(dir, 'cert.pem')
    if (fs.existsSync(key) && fs.existsSync(cert)) {
      console.log('TLS certs loaded from', dir)
      return {
        key: fs.readFileSync(key),
        cert: fs.readFileSync(cert)
      }
    }
  }
  return null
}

// ── HTTP helpers ───────────────────────────────────────────────────
function parseCookies(header) {
  const out = {}
  if (!header) return out
  header.split(';').forEach((part) => {
    const idx = part.indexOf('=')
    if (idx === -1) return
    const k = part.slice(0, idx).trim()
    const v = part.slice(idx + 1).trim()
    out[k] = decodeURIComponent(v)
  })
  return out
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (c) => {
      size += c.length
      if (size > 2 * 1024 * 1024) {
        reject(new Error('Body too large'))
        req.destroy()
        return
      }
      chunks.push(c)
    })
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8')
      if (!raw) return resolve({})
      try {
        resolve(JSON.parse(raw))
      } catch {
        reject(new Error('Invalid JSON'))
      }
    })
    req.on('error', reject)
  })
}

/** Allowed browser origins for credentialed CORS (comma-separated env, or sensible defaults). */
function isOriginAllowed(origin) {
  if (!origin) return false
  const fromEnv = (process.env.CORS_ORIGIN || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  if (fromEnv.includes('*')) return true
  if (fromEnv.length && fromEnv.includes(origin)) return true
  if (fromEnv.length && !fromEnv.includes('*')) {
    // still allow localhost + collab.name.ng when env is set partially
  }
  try {
    const u = new URL(origin)
    if (u.hostname === 'localhost' || u.hostname === '127.0.0.1') return true
    if (u.hostname === 'collab.name.ng' || u.hostname.endsWith('.collab.name.ng')) return true
  } catch {
    /* ignore */
  }
  return fromEnv.includes(origin)
}

function corsHeaders(req) {
  const origin = req.headers.origin || ''
  // Reflect specific origin when credentials are used (never '*')
  const allowOrigin = isOriginAllowed(origin)
    ? origin
    : 'http://localhost:5173'
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    Vary: 'Origin'
  }
}

function sendJson(res, status, data, extraHeaders = {}) {
  const body = status === 204 ? '' : JSON.stringify(data)
  // Node attaches the request as res.req
  const req = res.req
  const cors = req ? corsHeaders(req) : {
    'Access-Control-Allow-Origin': process.env.CORS_ORIGIN?.split(',')[0]?.trim() || 'http://localhost:5173',
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    Vary: 'Origin'
  }
  res.writeHead(status, {
    'Content-Type': 'application/json',
    ...cors,
    ...extraHeaders
  })
  res.end(body)
}

function setSessionCookie(token, secure) {
  const maxAge = Math.floor(db.SESSION_TTL_MS / 1000)
  // Cross-origin tunnels (ui.* → ws.*) need SameSite=None; Secure so the browser stores the cookie
  const sameSite = secure ? 'None' : 'Lax'
  const parts = [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    'Path=/',
    `Max-Age=${maxAge}`,
    'HttpOnly',
    `SameSite=${sameSite}`
  ]
  if (secure || sameSite === 'None') parts.push('Secure')
  return { 'Set-Cookie': parts.join('; ') }
}

function clearSessionCookie(secure) {
  const sameSite = secure ? 'None' : 'Lax'
  const parts = [
    `${SESSION_COOKIE}=`,
    'Path=/',
    'Max-Age=0',
    'HttpOnly',
    `SameSite=${sameSite}`
  ]
  if (secure || sameSite === 'None') parts.push('Secure')
  return { 'Set-Cookie': parts.join('; ') }
}

function getAuthUser(req) {
  const cookies = parseCookies(req.headers.cookie)
  let token = cookies[SESSION_COOKIE]
  if (!token && req.headers.authorization) {
    const m = String(req.headers.authorization).match(/^Bearer\s+(.+)$/i)
    if (m) token = m[1]
  }
  const session = db.getSession(token)
  if (!session) return null
  const full = db.getUserById(session.userId)
  return {
    id: session.userId,
    email: session.email,
    displayName: session.displayName,
    color: full?.color || null,
    token
  }
}

function isValidEmail(email) {
  return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
}

function nanoid(size = 16) {
  return crypto.randomBytes(size).toString('base64url').slice(0, size)
}

// ── API router ─────────────────────────────────────────────────────
async function handleApi(req, res, pathname) {
  const secure = !!(req.socket.encrypted || req.headers['x-forwarded-proto'] === 'https')
  
  // inside handleApi, near the top
if (pathname === '/api/health' && req.method === 'GET') {
  sendJson(res, 200, { ok: true })
  return
}

  if (req.method === 'OPTIONS') {
    sendJson(res, 204, {})
    return
  }

  // POST /api/auth/signup
  if (pathname === '/api/auth/signup' && req.method === 'POST') {
    try {
      const body = await readBody(req)
      const email = (body.email || '').trim()
      const password = body.password || ''
      const displayName = (body.displayName || '').trim() || email.split('@')[0]
      if (!isValidEmail(email)) return sendJson(res, 400, { error: 'Invalid email' })
      if (password.length < 6) return sendJson(res, 400, { error: 'Password must be at least 6 characters' })
      if (displayName.length > 40) return sendJson(res, 400, { error: 'Display name too long' })
      if (db.getUserByEmail(email)) return sendJson(res, 409, { error: 'Email already registered' })
      const id = nanoid(20)
      const passwordHash = bcrypt.hashSync(password, BCRYPT_ROUNDS)
      const user = db.createUser({ id, email, passwordHash, displayName })
      const token = nanoid(32)
      db.createSession(user.id, token)
      sendJson(res, 201, { user }, setSessionCookie(token, secure))
    } catch (e) {
      sendJson(res, 400, { error: e.message || 'Signup failed' })
    }
    return
  }

  // POST /api/auth/signin
  if (pathname === '/api/auth/signin' && req.method === 'POST') {
    try {
      const body = await readBody(req)
      const email = (body.email || '').trim()
      const password = body.password || ''
      const row = db.getUserByEmail(email)
      if (!row || !bcrypt.compareSync(password, row.passwordHash)) {
        return sendJson(res, 401, { error: 'Invalid email or password' })
      }
      const token = nanoid(32)
      db.createSession(row.id, token)
      sendJson(
        res,
        200,
        {
          user: {
            id: row.id,
            email: row.email,
            displayName: row.displayName,
            color: row.color || null,
            createdAt: row.createdAt
          }
        },
        setSessionCookie(token, secure)
      )
    } catch (e) {
      sendJson(res, 400, { error: e.message || 'Sign-in failed' })
    }
    return
  }

  // POST /api/auth/logout
  if (pathname === '/api/auth/logout' && req.method === 'POST') {
    const user = getAuthUser(req)
    if (user) db.deleteSession(user.token)
    sendJson(res, 200, { ok: true }, clearSessionCookie(secure))
    return
  }

  // GET /api/auth/me
  if (pathname === '/api/auth/me' && req.method === 'GET') {
    const user = getAuthUser(req)
    if (!user) return sendJson(res, 401, { error: 'Not signed in' })
    sendJson(res, 200, {
      user: { id: user.id, email: user.email, displayName: user.displayName, color: user.color }
    })
    return
  }

  // PUT /api/auth/me  { displayName?, color? }
  if (pathname === '/api/auth/me' && req.method === 'PUT') {
    const user = getAuthUser(req)
    if (!user) return sendJson(res, 401, { error: 'Not signed in' })
    try {
      const body = await readBody(req)
      const patch = {}
      if (body.displayName != null) {
        const displayName = String(body.displayName).trim()
        if (!displayName || displayName.length > 40) {
          return sendJson(res, 400, { error: 'Display name required (max 40 chars)' })
        }
        patch.displayName = displayName
      }
      if (body.color != null) {
        patch.color = String(body.color).trim().slice(0, 32)
      }
      if (!Object.keys(patch).length) {
        return sendJson(res, 400, { error: 'Nothing to update' })
      }
      const updated = db.updateUserProfile(user.id, patch)
      sendJson(res, 200, { user: updated })
    } catch (e) {
      sendJson(res, 400, { error: e.message })
    }
    return
  }

  // GET /api/rooms?q=&mine=1  search / list (public-only unless mine)
  if (pathname === '/api/rooms' && req.method === 'GET') {
    const user = getAuthUser(req)
    const url = new URL(req.url, `http://${req.headers.host}`)
    const q = url.searchParams.get('q') || ''
    const mine = url.searchParams.get('mine') === '1'
    if (mine && !user) return sendJson(res, 401, { error: 'Not signed in' })
    const rooms = db.searchRooms({
      query: q,
      ownerId: mine && user ? user.id : undefined,
      publicOnly: !mine,
      limit: 50
    })
    sendJson(res, 200, { rooms })
    return
  }


  // GET /api/rooms/editorial — rooms where user is invited/editor (not owner)
  if (pathname === '/api/rooms/editorial' && req.method === 'GET') {
    const user = getAuthUser(req)
    if (!user) return sendJson(res, 401, { error: 'Not signed in' })
    sendJson(res, 200, { rooms: db.listEditorialRooms(user.id) })
    return
  }

  // GET /api/rooms/:id/access — current user's access + pwd if any
  const accessGetMatch = pathname.match(/^\/api\/rooms\/([^/]+)\/access$/)
  if (accessGetMatch && req.method === 'GET') {
    const user = getAuthUser(req)
    if (!user) return sendJson(res, 401, { error: 'Not signed in' })
    const roomId = decodeURIComponent(accessGetMatch[1])
    const room = db.getRoom(roomId)
    const access = db.getRoomAccess(user.id, roomId)
    const isOwner = !!(room && room.ownerId && room.ownerId === user.id)
    sendJson(res, 200, {
      isOwner,
      access: access
        ? {
            role: access.role,
            roomPwd: access.roomPwd || '',
            isNew: !!access.isNew,
            invitedBy: access.invitedBy || null
          }
        : null
    })
    return
  }

  // POST /api/rooms/:id/access  { role?, roomPwd? } — remember access/password
  if (accessGetMatch && req.method === 'POST') {
    const user = getAuthUser(req)
    if (!user) return sendJson(res, 401, { error: 'Not signed in' })
    try {
      const body = await readBody(req)
      const roomId = decodeURIComponent(accessGetMatch[1])
      const room = db.getRoom(roomId) || db.upsertRoom({ id: roomId, description: '', ownerId: null })
      const isOwner = !!(room && room.ownerId && room.ownerId === user.id)
      const role = isOwner ? 'owner' : body.role || 'editor'
      const access = db.upsertRoomAccess({
        userId: user.id,
        roomId,
        role,
        roomPwd: body.roomPwd != null ? String(body.roomPwd) : undefined,
        invitedBy: null,
        isNew: false
      })
      if (role === 'editor' || role === 'owner') {
        db.touchRecentRoom(user.id, roomId)
      }
      sendJson(res, 200, { access })
    } catch (e) {
      sendJson(res, 400, { error: e.message })
    }
    return
  }

  // POST /api/rooms/:id/invite  { email } — invite by email as editor (syncs pwd)
  const inviteMatch = pathname.match(/^\/api\/rooms\/([^/]+)\/invite$/)
  if (inviteMatch && req.method === 'POST') {
    const user = getAuthUser(req)
    if (!user) return sendJson(res, 401, { error: 'Not signed in' })
    try {
      const body = await readBody(req)
      const roomId = decodeURIComponent(inviteMatch[1])
      const email = String(body.email || body.username || '').trim()
      if (!email) return sendJson(res, 400, { error: 'Email required' })
      if (!isValidEmail(email)) return sendJson(res, 400, { error: 'Invalid email' })
      const target = db.getUserByEmail(email)
      if (!target) return sendJson(res, 404, { error: 'No signed-up user with that email' })
      if (target.id === user.id) return sendJson(res, 400, { error: 'Cannot invite yourself' })
      const room = db.getRoom(roomId)
      if (!room) return sendJson(res, 404, { error: 'Room not found' })
      // Inviter must be owner or have editor access with a password
      const inviterAccess = db.getRoomAccess(user.id, roomId)
      const isOwner = room.ownerId === user.id
      const pwd = (body.roomPwd != null ? String(body.roomPwd) : '') || (inviterAccess && inviterAccess.roomPwd) || ''
      if (!isOwner && !(inviterAccess && inviterAccess.role === 'editor')) {
        return sendJson(res, 403, { error: 'Only room owners or editors can invite' })
      }
      if (!pwd) {
        return sendJson(res, 400, { error: 'No room password available to share. Open the room as editor first.' })
      }
      db.upsertRoomAccess({
        userId: target.id,
        roomId,
        role: 'editor',
        roomPwd: pwd,
        invitedBy: user.displayName || user.email,
        isNew: true
      })
      db.logActivity({
        roomId,
        userId: user.id,
        displayName: user.displayName,
        action: 'invite',
        detail: target.displayName
      })
      sendJson(res, 200, { ok: true, invited: target.displayName })
    } catch (e) {
      sendJson(res, 400, { error: e.message })
    }
    return
  }

  // POST /api/rooms/:id/access/seen
  const accessSeenMatch = pathname.match(/^\/api\/rooms\/([^/]+)\/access\/seen$/)
  if (accessSeenMatch && req.method === 'POST') {
    const user = getAuthUser(req)
    if (!user) return sendJson(res, 401, { error: 'Not signed in' })
    db.markRoomAccessSeen(user.id, decodeURIComponent(accessSeenMatch[1]))
    sendJson(res, 200, { ok: true })
    return
  }


  // GET /api/rooms/recent
  if (pathname === '/api/rooms/recent' && req.method === 'GET') {
    const user = getAuthUser(req)
    if (!user) return sendJson(res, 401, { error: 'Not signed in' })
    sendJson(res, 200, { rooms: db.listRecentRooms(user.id) })
    return
  }

  // POST /api/rooms/:id/touch  — mark as recent
  // handled below with roomMatch patterns

  // POST /api/rooms  { id, description?, isPublic? }
  if (pathname === '/api/rooms' && req.method === 'POST') {
    const user = getAuthUser(req)
    try {
      const body = await readBody(req)
      const id = (body.id || '').trim()
      if (!id || id.length > 64) return sendJson(res, 400, { error: 'Invalid room id' })
      const description = (body.description || '').trim()
      if (description.length > 50) return sendJson(res, 400, { error: 'Description max 50 characters' })
      const isPublic = !!body.isPublic
      const room = db.upsertRoom({ id, description, ownerId: user?.id || null, isPublic })
      if (user) {
        db.logActivity({
          roomId: id,
          userId: user.id,
          displayName: user.displayName,
          action: 'create',
          detail: description || null
        })
      }
      sendJson(res, 201, { room })
    } catch (e) {
      sendJson(res, 400, { error: e.message })
    }
    return
  }

  // GET /api/rooms/:id
  const roomMatch = pathname.match(/^\/api\/rooms\/([^/]+)$/)
  if (roomMatch && req.method === 'GET') {
    const room = db.getRoom(roomMatch[1])
    if (!room) return sendJson(res, 404, { error: 'Room not found' })
    sendJson(res, 200, { room })
    return
  }

  // PUT /api/rooms/:id  { description?, isPublic? }
  if (roomMatch && req.method === 'PUT') {
    const user = getAuthUser(req)
    try {
      const body = await readBody(req)
      const roomId = roomMatch[1]
      let room = db.getRoom(roomId)
      if (body.description != null) {
        const description = String(body.description || '').trim()
        if (description.length > 50) return sendJson(res, 400, { error: 'Description max 50 characters' })
        room = db.setRoomDescription(roomId, description)
        if (user) {
          db.logActivity({
            roomId,
            userId: user.id,
            displayName: user.displayName,
            action: 'description',
            detail: description
          })
        }
      }
      if (body.isPublic != null) {
        room = db.setRoomPublic(roomId, !!body.isPublic)
        if (user) {
          db.logActivity({
            roomId,
            userId: user.id,
            displayName: user.displayName,
            action: 'visibility',
            detail: body.isPublic ? 'public' : 'private'
          })
        }
      }
      if (!room) return sendJson(res, 404, { error: 'Room not found' })
      sendJson(res, 200, { room })
    } catch (e) {
      sendJson(res, 400, { error: e.message })
    }
    return
  }

  // POST /api/rooms/:id/touch
  const touchMatch = pathname.match(/^\/api\/rooms\/([^/]+)\/touch$/)
  if (touchMatch && req.method === 'POST') {
    const user = getAuthUser(req)
    if (user) db.touchRecentRoom(user.id, touchMatch[1])
    sendJson(res, 200, { ok: true })
    return
  }

  // POST /api/rooms/:id/rotate-secrets  { rotatePwd?, rotateView?, currentPwd }
  // Requires knowing the current edit password. Room id stays the same.
  const rotateMatch = pathname.match(/^\/api\/rooms\/([^/]+)\/rotate-secrets$/)
  if (rotateMatch && req.method === 'POST') {
    try {
      const body = await readBody(req)
      const roomId = rotateMatch[1]
      const currentPwd = body.currentPwd || ''
      const locked = normalizeSecret(roomPasswords.get(roomId))
      if (!locked) return sendJson(res, 404, { error: 'Room secrets not found' })
      if (!currentPwd || locked.pwd !== currentPwd) {
        return sendJson(res, 403, { error: 'Current password required' })
      }
      const next = { pwd: locked.pwd, view: locked.view || '' }
      if (body.rotatePwd) next.pwd = nanoid(10)
      if (body.rotateView) next.view = nanoid(12)
      roomPasswords.set(roomId, next)
      savePasswords(roomPasswords)
      const user = getAuthUser(req)
      db.logActivity({
        roomId,
        userId: user?.id || null,
        displayName: user?.displayName || body.displayName || null,
        action: 'rotate-secrets',
        detail: [body.rotatePwd ? 'pwd' : null, body.rotateView ? 'view' : null].filter(Boolean).join(',')
      })
      sendJson(res, 200, { pwd: next.pwd, view: next.view })
    } catch (e) {
      sendJson(res, 400, { error: e.message })
    }
    return
  }

  // GET /api/rooms/:id/activity
  const activityMatch = pathname.match(/^\/api\/rooms\/([^/]+)\/activity$/)
  if (activityMatch && req.method === 'GET') {
    sendJson(res, 200, { activity: db.getActivity(activityMatch[1]) })
    return
  }

  // POST /api/rooms/:id/activity  { action, detail?, displayName? }
  if (activityMatch && req.method === 'POST') {
    const user = getAuthUser(req)
    try {
      const body = await readBody(req)
      const action = (body.action || '').trim()
      if (!action) return sendJson(res, 400, { error: 'action required' })
      db.logActivity({
        roomId: activityMatch[1],
        userId: user?.id || null,
        displayName: body.displayName || user?.displayName || null,
        action,
        detail: body.detail || null
      })
      sendJson(res, 201, { ok: true })
    } catch (e) {
      sendJson(res, 400, { error: e.message })
    }
    return
  }

  // GET /api/rooms/:id/snapshots
  const snapsMatch = pathname.match(/^\/api\/rooms\/([^/]+)\/snapshots$/)
  if (snapsMatch && req.method === 'GET') {
    sendJson(res, 200, { snapshots: db.listSnapshots(snapsMatch[1]) })
    return
  }

  // POST /api/rooms/:id/snapshots  { name, payload }
  if (snapsMatch && req.method === 'POST') {
    const user = getAuthUser(req)
    try {
      const body = await readBody(req)
      const name = (body.name || '').trim()
      if (!name) return sendJson(res, 400, { error: 'Snapshot name required' })
      if (!body.payload || typeof body.payload !== 'object') {
        return sendJson(res, 400, { error: 'payload required' })
      }
      const id = nanoid(16)
      const snap = db.createSnapshot({
        id,
        roomId: snapsMatch[1],
        name,
        createdBy: user?.displayName || body.displayName || null,
        payload: body.payload
      })
      db.logActivity({
        roomId: snapsMatch[1],
        userId: user?.id || null,
        displayName: user?.displayName || body.displayName || null,
        action: 'snapshot',
        detail: name
      })
      sendJson(res, 201, { snapshot: { id: snap.id, roomId: snap.roomId, name: snap.name, createdBy: snap.createdBy, createdAt: snap.createdAt } })
    } catch (e) {
      sendJson(res, 400, { error: e.message })
    }
    return
  }

  // GET /api/rooms/:id/snapshots/:snapId
  const snapOneMatch = pathname.match(/^\/api\/rooms\/([^/]+)\/snapshots\/([^/]+)$/)
  if (snapOneMatch && req.method === 'GET') {
    const snap = db.getSnapshot(snapOneMatch[2])
    if (!snap || snap.roomId !== snapOneMatch[1]) return sendJson(res, 404, { error: 'Not found' })
    sendJson(res, 200, { snapshot: snap })
    return
  }

  // DELETE /api/rooms/:id/snapshots/:snapId
  if (snapOneMatch && req.method === 'DELETE') {
    const snap = db.getSnapshot(snapOneMatch[2])
    if (!snap || snap.roomId !== snapOneMatch[1]) return sendJson(res, 404, { error: 'Not found' })
    db.deleteSnapshot(snapOneMatch[2])
    sendJson(res, 200, { ok: true })
    return
  }

  sendJson(res, 404, { error: 'Not found' })
}

// ── Server ─────────────────────────────────────────────────────────
const tls = loadTlsOptions()

/** When client/dist exists (production / Docker), serve the SPA from the same origin. */
const CLIENT_DIST = path.join(__dirname, '..', 'client', 'dist')
const hasClientDist = fs.existsSync(path.join(CLIENT_DIST, 'index.html'))

const STATIC_MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
}

function sendStaticFile(res, filePath) {
  const ext = path.extname(filePath).toLowerCase()
  const type = STATIC_MIME[ext] || 'application/octet-stream'
  res.writeHead(200, { 'Content-Type': type })
  fs.createReadStream(filePath).pipe(res)
}

const requestHandler = (req, res) => {
  try {
    const { pathname } = new URL(req.url, `http://${req.headers.host}`)
    if (pathname.startsWith('/api/')) {
      handleApi(req, res, pathname).catch((e) => {
        console.error('API error', e)
        sendJson(res, 500, { error: 'Internal error' })
      })
      return
    }

    // Production SPA: serve built client (same origin → simple cookies / CORS)
    if (hasClientDist) {
      // Prevent path traversal
      const safePath = pathname === '/' ? '/index.html' : pathname
      const resolved = path.normalize(path.join(CLIENT_DIST, safePath))
      if (!resolved.startsWith(CLIENT_DIST)) {
        res.writeHead(403)
        res.end('Forbidden')
        return
      }
      if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) {
        sendStaticFile(res, resolved)
        return
      }
      // SPA fallback for client-side routes (/room/..., /preview/...)
      sendStaticFile(res, path.join(CLIENT_DIST, 'index.html'))
      return
    }

    res.writeHead(200, { 'Content-Type': 'text/plain' })
    res.end(tls ? 'y-websocket server is running (HTTPS)' : 'y-websocket server is running')
  } catch (e) {
    res.writeHead(500)
    res.end('error')
  }
}

const server = tls ? https.createServer(tls, requestHandler) : http.createServer(requestHandler)

const wss = new WebSocket.Server({ noServer: true })

server.on('upgrade', (req, socket, head) => {
  const { pathname, searchParams } = new URL(req.url, `http://${req.headers.host}`)
  // Don't upgrade API paths
  if (pathname.startsWith('/api/')) {
    socket.write('HTTP/1.1 400 Bad Request\r\n\r\n')
    socket.destroy()
    return
  }

  const roomId = pathname.slice(1).split('?')[0] || 'default'
  const pwd = searchParams.get('pwd') || ''
  const view = searchParams.get('view') || ''

  const locked = normalizeSecret(roomPasswords.get(roomId))
  let readonly = false

  if (!locked) {
    if (!pwd) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n')
      socket.destroy()
      return
    }
    roomPasswords.set(roomId, { pwd, view: view || '' })
    savePasswords(roomPasswords)
    // Ensure room row exists
    try {
      db.upsertRoom({ id: roomId, description: '', ownerId: null })
    } catch {
      /* ignore */
    }
    readonly = false
  } else if (pwd && locked.pwd === pwd) {
    readonly = false
    if (view && !locked.view) {
      locked.view = view
      roomPasswords.set(roomId, locked)
      savePasswords(roomPasswords)
    }
  } else if (view && locked.view && locked.view === view) {
    readonly = true
  } else if (!pwd && !view) {
    // Bare room link (no pwd / view) → read-only observer
    readonly = true
  } else {
    // Wrong password
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n')
    socket.destroy()
    return
  }

  wss.handleUpgrade(req, socket, head, (ws) => {
    req.__readonly = readonly
    wss.emit('connection', ws, req)
  })
})

wss.on('connection', (conn, req) => {
  const { pathname } = new URL(req.url, `http://${req.headers.host}`)
  const docName = pathname.slice(1).split('?')[0] || 'default'

  setupWSConnection(conn, req, {
    docName,
    gc: true
  })

  if (persistence) {
    setImmediate(() => {
      try {
        const utils = require('y-websocket/bin/utils')
        const docs = utils.docs
        const doc = docs && docs.get(docName)
        if (doc && !doc.__persisted) {
          doc.__persisted = true
          persistence.bindState(docName, doc).catch((err) => {
            console.warn('bindState failed for', docName, err.message)
          })
        }
      } catch (e) {
        // non-fatal
      }
    })
  }
})

const PORT = process.env.PORT || 1234
const HOST = process.env.HOST || '0.0.0.0'
server.listen(PORT, HOST, () => {
  const scheme = tls ? 'https/wss' : 'http/ws'
  console.log(`y-websocket + API server running on ${scheme}://${HOST}:${PORT}`)
  console.log(`SQLite database: ${db.DB_PATH}`)
  if (hasClientDist) {
    console.log(`Serving SPA from ${CLIENT_DIST}`)
  }
  if (!tls) {
    console.log('No TLS certs found (server/certs or client/certs). Mic/WebRTC need HTTPS on LAN.')
  }
  console.log(`Room passwords persisted at ${PASSWORDS_FILE}`)
})
