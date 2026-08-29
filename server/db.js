/**
 * SQLite persistence for accounts, room metadata, sessions, activity, snapshots.
 * Yjs CRDT content stays in LevelDB — this is only metadata / auth.
 */
const path = require('path')
const fs = require('fs')
const Database = require('better-sqlite3')

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data')
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true })

const DB_PATH = process.env.SQLITE_PATH || path.join(DATA_DIR, 'collab.db')
const db = new Database(DB_PATH)
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    display_name TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS rooms (
    id TEXT PRIMARY KEY,
    description TEXT NOT NULL DEFAULT '',
    owner_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS activity_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    room_id TEXT NOT NULL,
    user_id TEXT,
    display_name TEXT,
    action TEXT NOT NULL,
    detail TEXT,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS snapshots (
    id TEXT PRIMARY KEY,
    room_id TEXT NOT NULL,
    name TEXT NOT NULL,
    created_by TEXT,
    created_at INTEGER NOT NULL,
    payload TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
  CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
  CREATE INDEX IF NOT EXISTS idx_activity_room ON activity_log(room_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_snapshots_room ON snapshots(room_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_rooms_owner ON rooms(owner_id);
`)

// 
// Room access grants (editor invites + synced passwords for signed-in users)
try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS room_access (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      room_id TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'editor',
      room_pwd TEXT,
      invited_by TEXT,
      is_new INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (user_id, room_id)
    );
    CREATE INDEX IF NOT EXISTS idx_room_access_user ON room_access(user_id, updated_at);
  `)
} catch {
  /* ignore */
}

// Phase 2 migrations (idempotent)
try {
  const cols = db.prepare(`PRAGMA table_info(users)`).all().map((c) => c.name)
  if (!cols.includes('color')) {
    db.exec(`ALTER TABLE users ADD COLUMN color TEXT`)
  }
} catch {
  /* ignore */
}
try {
  const roomCols = db.prepare(`PRAGMA table_info(rooms)`).all().map((c) => c.name)
  if (!roomCols.includes('is_public')) {
    db.exec(`ALTER TABLE rooms ADD COLUMN is_public INTEGER NOT NULL DEFAULT 0`)
  }
} catch {
  /* ignore */
}
try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS recent_rooms (
      user_id TEXT NOT NULL,
      room_id TEXT NOT NULL,
      last_seen INTEGER NOT NULL,
      PRIMARY KEY (user_id, room_id)
    );
    CREATE INDEX IF NOT EXISTS idx_recent_user ON recent_rooms(user_id, last_seen);
  `)
} catch {
  /* ignore */
}

function now() {
  return Date.now()
}

// ── Users ──────────────────────────────────────────────────────────
function createUser({ id, email, passwordHash, displayName }) {
  const t = now()
  db.prepare(
    `INSERT INTO users (id, email, password_hash, display_name, created_at)
     VALUES (?, ?, ?, ?, ?)`
  ).run(id, email.trim().toLowerCase(), passwordHash, displayName.trim(), t)
  return getUserById(id)
}

function getUserById(id) {
  return (
    db
      .prepare(
        `SELECT id, email, display_name AS displayName, color, created_at AS createdAt FROM users WHERE id = ?`
      )
      .get(id) || null
  )
}

function getUserByEmail(email) {
  return (
    db
      .prepare(
        `SELECT id, email, password_hash AS passwordHash, display_name AS displayName, color, created_at AS createdAt
         FROM users WHERE email = ?`
      )
      .get(email.trim().toLowerCase()) || null
  )
}

function updateDisplayName(userId, displayName) {
  db.prepare(`UPDATE users SET display_name = ? WHERE id = ?`).run(displayName.trim(), userId)
  return getUserById(userId)
}

function updateUserProfile(userId, { displayName, color }) {
  if (displayName != null) {
    db.prepare(`UPDATE users SET display_name = ? WHERE id = ?`).run(String(displayName).trim(), userId)
  }
  if (color != null) {
    db.prepare(`UPDATE users SET color = ? WHERE id = ?`).run(String(color).trim().slice(0, 32), userId)
  }
  return getUserById(userId)
}

// ── Sessions ───────────────────────────────────────────────────────
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000 // 30 days

function createSession(userId, token) {
  const t = now()
  db.prepare(
    `INSERT INTO sessions (token, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)`
  ).run(token, userId, t + SESSION_TTL_MS, t)
}

function getSession(token) {
  if (!token) return null
  const row = db
    .prepare(
      `SELECT s.token, s.user_id AS userId, s.expires_at AS expiresAt, u.email, u.display_name AS displayName
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token = ?`
    )
    .get(token)
  if (!row) return null
  if (row.expiresAt < now()) {
    db.prepare(`DELETE FROM sessions WHERE token = ?`).run(token)
    return null
  }
  return row
}

function deleteSession(token) {
  if (!token) return
  db.prepare(`DELETE FROM sessions WHERE token = ?`).run(token)
}

function deleteExpiredSessions() {
  db.prepare(`DELETE FROM sessions WHERE expires_at < ?`).run(now())
}

// ── Rooms ──────────────────────────────────────────────────────────
function upsertRoom({ id, description, ownerId, isPublic }) {
  const t = now()
  const existing = db.prepare(`SELECT id FROM rooms WHERE id = ?`).get(id)
  const desc = (description || '').trim().slice(0, 50)
  const pub = isPublic ? 1 : 0
  if (existing) {
    db.prepare(
      `UPDATE rooms SET description = COALESCE(NULLIF(?, ''), description),
       owner_id = COALESCE(?, owner_id),
       is_public = COALESCE(?, is_public),
       updated_at = ? WHERE id = ?`
    ).run(desc, ownerId || null, isPublic == null ? null : pub, t, id)
  } else {
    db.prepare(
      `INSERT INTO rooms (id, description, owner_id, is_public, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`
    ).run(id, desc, ownerId || null, pub, t, t)
  }
  return getRoom(id)
}

function getRoom(id) {
  const row =
    db
      .prepare(
        `SELECT id, description, owner_id AS ownerId, is_public AS isPublic,
                created_at AS createdAt, updated_at AS updatedAt
         FROM rooms WHERE id = ?`
      )
      .get(id) || null
  if (row) row.isPublic = !!row.isPublic
  return row
}

function setRoomDescription(id, description) {
  const t = now()
  const desc = (description || '').trim().slice(0, 50)
  const existing = getRoom(id)
  if (!existing) {
    db.prepare(
      `INSERT INTO rooms (id, description, owner_id, is_public, created_at, updated_at) VALUES (?, ?, NULL, 0, ?, ?)`
    ).run(id, desc, t, t)
  } else {
    db.prepare(`UPDATE rooms SET description = ?, updated_at = ? WHERE id = ?`).run(desc, t, id)
  }
  return getRoom(id)
}

function setRoomPublic(id, isPublic) {
  const t = now()
  const pub = isPublic ? 1 : 0
  const existing = getRoom(id)
  if (!existing) {
    db.prepare(
      `INSERT INTO rooms (id, description, owner_id, is_public, created_at, updated_at) VALUES (?, '', NULL, ?, ?, ?)`
    ).run(id, pub, t, t)
  } else {
    db.prepare(`UPDATE rooms SET is_public = ?, updated_at = ? WHERE id = ?`).run(pub, t, id)
  }
  return getRoom(id)
}

function listRoomsForUser(userId, limit = 50) {
  return db
    .prepare(
      `SELECT id, description, owner_id AS ownerId, is_public AS isPublic,
              created_at AS createdAt, updated_at AS updatedAt
       FROM rooms WHERE owner_id = ? ORDER BY updated_at DESC LIMIT ?`
    )
    .all(userId, limit)
    .map((r) => ({ ...r, isPublic: !!r.isPublic }))
}

function searchRooms({ query, ownerId, publicOnly = false, limit = 50 } = {}) {
  const q = (query || '').trim()
  const pubFilter = publicOnly ? ' AND r.is_public = 1' : ''
  if (q) {
    const like = `%${q.replace(/%/g, '')}%`
    if (ownerId) {
      return db
        .prepare(
          `SELECT r.id, r.description, r.owner_id AS ownerId, r.is_public AS isPublic,
                  r.created_at AS createdAt, r.updated_at AS updatedAt,
                  u.display_name AS ownerName
           FROM rooms r LEFT JOIN users u ON u.id = r.owner_id
           WHERE r.owner_id = ? AND (r.description LIKE ? OR r.id LIKE ?)${pubFilter}
           ORDER BY r.updated_at DESC LIMIT ?`
        )
        .all(ownerId, like, like, limit)
        .map((r) => ({ ...r, isPublic: !!r.isPublic }))
    }
    return db
      .prepare(
        `SELECT r.id, r.description, r.owner_id AS ownerId, r.is_public AS isPublic,
                r.created_at AS createdAt, r.updated_at AS updatedAt,
                u.display_name AS ownerName
         FROM rooms r LEFT JOIN users u ON u.id = r.owner_id
         WHERE (r.description LIKE ? OR r.id LIKE ?)${pubFilter}
         ORDER BY r.updated_at DESC LIMIT ?`
      )
      .all(like, like, limit)
      .map((r) => ({ ...r, isPublic: !!r.isPublic }))
  }
  if (ownerId) return listRoomsForUser(ownerId, limit)
  return db
    .prepare(
      `SELECT r.id, r.description, r.owner_id AS ownerId, r.is_public AS isPublic,
              r.created_at AS createdAt, r.updated_at AS updatedAt,
              u.display_name AS ownerName
       FROM rooms r LEFT JOIN users u ON u.id = r.owner_id
       WHERE 1=1${pubFilter}
       ORDER BY r.updated_at DESC LIMIT ?`
    )
    .all(limit)
    .map((r) => ({ ...r, isPublic: !!r.isPublic }))
}

function touchRecentRoom(userId, roomId) {
  if (!userId || !roomId) return
  const t = now()
  db.prepare(
    `INSERT INTO recent_rooms (user_id, room_id, last_seen) VALUES (?, ?, ?)
     ON CONFLICT(user_id, room_id) DO UPDATE SET last_seen = excluded.last_seen`
  ).run(userId, roomId, t)
}

function listRecentRooms(userId, limit = 20) {
  return db
    .prepare(
      `SELECT r.id, r.description, r.owner_id AS ownerId, r.is_public AS isPublic,
              r.created_at AS createdAt, r.updated_at AS updatedAt,
              rr.last_seen AS lastSeen, u.display_name AS ownerName
       FROM recent_rooms rr
       JOIN rooms r ON r.id = rr.room_id
       LEFT JOIN users u ON u.id = r.owner_id
       WHERE rr.user_id = ?
       ORDER BY rr.last_seen DESC LIMIT ?`
    )
    .all(userId, limit)
    .map((r) => ({ ...r, isPublic: !!r.isPublic }))
}

// ── Activity log ───────────────────────────────────────────────────
function logActivity({ roomId, userId, displayName, action, detail }) {
  db.prepare(
    `INSERT INTO activity_log (room_id, user_id, display_name, action, detail, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(roomId, userId || null, displayName || null, action, detail || null, now())
}

function getActivity(roomId, limit = 100) {
  return db
    .prepare(
      `SELECT id, room_id AS roomId, user_id AS userId, display_name AS displayName,
              action, detail, created_at AS createdAt
       FROM activity_log WHERE room_id = ? ORDER BY created_at DESC LIMIT ?`
    )
    .all(roomId, limit)
}

// ── Snapshots ──────────────────────────────────────────────────────
function createSnapshot({ id, roomId, name, createdBy, payload }) {
  const t = now()
  db.prepare(
    `INSERT INTO snapshots (id, room_id, name, created_by, created_at, payload)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(id, roomId, name.trim().slice(0, 80), createdBy || null, t, JSON.stringify(payload))
  return getSnapshot(id)
}

function getSnapshot(id) {
  const row = db
    .prepare(
      `SELECT id, room_id AS roomId, name, created_by AS createdBy, created_at AS createdAt, payload
       FROM snapshots WHERE id = ?`
    )
    .get(id)
  if (!row) return null
  try {
    row.payload = JSON.parse(row.payload)
  } catch {
    row.payload = null
  }
  return row
}

function listSnapshots(roomId) {
  return db
    .prepare(
      `SELECT id, room_id AS roomId, name, created_by AS createdBy, created_at AS createdAt
       FROM snapshots WHERE room_id = ? ORDER BY created_at DESC`
    )
    .all(roomId)
}

function deleteSnapshot(id) {
  db.prepare(`DELETE FROM snapshots WHERE id = ?`).run(id)
}

// periodic cleanup
setInterval(() => {
  try {
    deleteExpiredSessions()
  } catch {
    /* ignore */
  }
}, 60 * 60 * 1000).unref?.()


// ── Room access (synced editor passwords / invites) ───────────────
function findUserByDisplayName(name) {
  if (!name || !String(name).trim()) return null
  return (
    db
      .prepare(
        `SELECT id, email, display_name AS displayName, color, created_at AS createdAt
         FROM users WHERE display_name = ? COLLATE NOCASE LIMIT 1`
      )
      .get(String(name).trim()) || null
  )
}

function upsertRoomAccess({ userId, roomId, role, roomPwd, invitedBy, isNew }) {
  const t = now()
  const existing = db
    .prepare(`SELECT user_id FROM room_access WHERE user_id = ? AND room_id = ?`)
    .get(userId, roomId)
  if (existing) {
    db.prepare(
      `UPDATE room_access SET
         role = COALESCE(?, role),
         room_pwd = COALESCE(?, room_pwd),
         invited_by = COALESCE(?, invited_by),
         is_new = CASE WHEN ? = 1 THEN 1 ELSE is_new END,
         updated_at = ?
       WHERE user_id = ? AND room_id = ?`
    ).run(
      role || null,
      roomPwd != null ? roomPwd : null,
      invitedBy || null,
      isNew ? 1 : 0,
      t,
      userId,
      roomId
    )
  } else {
    db.prepare(
      `INSERT INTO room_access (user_id, room_id, role, room_pwd, invited_by, is_new, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(userId, roomId, role || 'editor', roomPwd || null, invitedBy || null, isNew ? 1 : 0, t)
  }
  return getRoomAccess(userId, roomId)
}

function getRoomAccess(userId, roomId) {
  return (
    db
      .prepare(
        `SELECT user_id AS userId, room_id AS roomId, role, room_pwd AS roomPwd,
                invited_by AS invitedBy, is_new AS isNew, updated_at AS updatedAt
         FROM room_access WHERE user_id = ? AND room_id = ?`
      )
      .get(userId, roomId) || null
  )
}

function listRoomAccessForUser(userId, { role } = {}) {
  let rows
  if (role) {
    rows = db
      .prepare(
        `SELECT a.user_id AS userId, a.room_id AS roomId, a.role, a.room_pwd AS roomPwd,
                a.invited_by AS invitedBy, a.is_new AS isNew, a.updated_at AS updatedAt,
                r.description, r.is_public AS isPublic, r.owner_id AS ownerId
         FROM room_access a
         LEFT JOIN rooms r ON r.id = a.room_id
         WHERE a.user_id = ? AND a.role = ?
         ORDER BY a.is_new DESC, a.updated_at DESC`
      )
      .all(userId, role)
  } else {
    rows = db
      .prepare(
        `SELECT a.user_id AS userId, a.room_id AS roomId, a.role, a.room_pwd AS roomPwd,
                a.invited_by AS invitedBy, a.is_new AS isNew, a.updated_at AS updatedAt,
                r.description, r.is_public AS isPublic, r.owner_id AS ownerId
         FROM room_access a
         LEFT JOIN rooms r ON r.id = a.room_id
         WHERE a.user_id = ?
         ORDER BY a.is_new DESC, a.updated_at DESC`
      )
      .all(userId)
  }
  return rows.map((r) => ({ ...r, isPublic: !!r.isPublic, isNew: !!r.isNew }))
}

function markRoomAccessSeen(userId, roomId) {
  db.prepare(
    `UPDATE room_access SET is_new = 0, updated_at = ? WHERE user_id = ? AND room_id = ?`
  ).run(now(), userId, roomId)
}

function listEditorialRooms(userId) {
  // Rooms where user has editor access but is not the owner
  return db
    .prepare(
      `SELECT a.room_id AS id, COALESCE(r.description, '') AS description,
              r.is_public AS isPublic, r.owner_id AS ownerId,
              a.room_pwd AS roomPwd, a.is_new AS isNew, a.updated_at AS updatedAt,
              a.invited_by AS invitedBy,
              u.display_name AS ownerName
       FROM room_access a
       LEFT JOIN rooms r ON r.id = a.room_id
       LEFT JOIN users u ON u.id = r.owner_id
       WHERE a.user_id = ? AND a.role = 'editor'
         AND (r.owner_id IS NULL OR r.owner_id != ?)
       ORDER BY a.is_new DESC, a.updated_at DESC`
    )
    .all(userId, userId)
    .map((r) => ({ ...r, isPublic: !!r.isPublic, isNew: !!r.isNew }))
}

module.exports = {
  db,
  DB_PATH,
  createUser,
  getUserById,
  getUserByEmail,
  updateDisplayName,
  updateUserProfile,
  createSession,
  getSession,
  deleteSession,
  upsertRoom,
  getRoom,
  setRoomDescription,
  setRoomPublic,
  listRoomsForUser,
  searchRooms,
  touchRecentRoom,
  listRecentRooms,
  logActivity,
  getActivity,
  createSnapshot,
  getSnapshot,
  listSnapshots,
  deleteSnapshot,
  findUserByDisplayName,
  upsertRoomAccess,
  getRoomAccess,
  listRoomAccessForUser,
  markRoomAccessSeen,
  listEditorialRooms,
  SESSION_TTL_MS
}
