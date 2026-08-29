# Collab Editor

Real-time collaborative editor (Yjs + Monaco + y-websocket).

## Features

### Core
- Shared multi-file virtual FS, live HTML preview
- Chat (General / Editors) — text, images, voice notes, **@mentions**, **pin messages**
- WebRTC voice (General / Editors) with mute indicators + **screen share**
- Collaborative undo/redo, remote cursors / selections, **follow mode**
- Export file or room ZIP; invite + read-only (view key) links

### Phase 1
- Accounts (email + password) with httpOnly session cookie; SQLite on the server PC
- Room description (max 50 chars)
- IndexedDB local Yjs persistence + silent reconnect UI
- Named snapshots and activity log

### Phase 2
- **Persistent editor tabs** restored after reboot (localStorage per room)
- **Cross-file search** (Ctrl+Shift+F)
- **Threaded line comments** on files
- **Soft file locks** (“Editing…” from Awareness)
- Preview **device frames** (phone / tablet / full), stronger console + error stacks
- **Preview-only** route: `/preview/:roomId?view=…`
- Room **dashboard**: recent rooms, search by description, **templates** (blank / HTML / landing)
- Sticky avatar **colors** from account / prefs
- **Rotate** password or view key without changing room id
- Voice **rejoin** prompt after disconnect

## Install

```bash
cd server && npm install
cd ../client && npm install
```

## Run (local / PC build)

```bash
# Terminal 1
cd server && npm run start

# Terminal 2
cd client && npm run dev
```

Open http://localhost:5173

Local behaviour is unchanged: Vite serves the UI; the server only serves API + WebSocket until `client/dist` exists.

## Production (v1 Option A — Coolify / Docker)

When `client/dist` is present (built in the Docker image), the **same Node process** serves:

- UI (SPA)
- `/api/*`
- Yjs WebSocket

One domain, simple cookies/CORS.

```bash
# Optional local production test
cd client && npm run build
cd ../server && npm run start
# open http://localhost:1234
```

### Docker

```bash
docker build -t collab-editor .
docker run -d \
  -p 1234:1234 \
  -e CORS_ORIGIN=https://collab.yourdomain.com \
  -v collab-data:/app/server/data \
  collab-editor
```

### Coolify

1. Connect this Git repo, build pack **Dockerfile**, port **1234**.
2. Persistent volume → container path `/app/server/data`.
3. Env: `CORS_ORIGIN=https://your-public-https-origin`.
4. Optional build args: `VITE_API_URL` / `VITE_WS_URL` (leave empty for same-origin).
5. Attach domain + TLS in Coolify.

See `client/.env.example` and `server/.env.example`.

## Environment

### Client (`client/.env`)

```
# Same-origin production: leave empty
# VITE_API_URL=
# VITE_WS_URL=

# Or tunnels / split hosts:
# VITE_API_URL=https://ws.example.com
# VITE_WS_URL=wss://ws.example.com
```

### Server

```
PORT=1234
HOST=0.0.0.0
DATA_DIR=./data
SQLITE_PATH=./data/collab.db
CORS_ORIGIN=https://collab.yourdomain.com
```

## Data layout

| Store | Purpose |
|-------|---------|
| LevelDB `server/data/ydocs` | Yjs CRDT document content |
| SQLite `server/data/collab.db` | Users, sessions, room metadata, activity, snapshots index |
| Client IndexedDB | Per-room Yjs local cache |
| Client localStorage | Tabs, chat unread, voice rejoin, color prefs |

## LAN / Tunnel

See `HTTPS-LAN.md`. For Cloudflare Tunnel, set `VITE_WS_URL` (and optionally `VITE_API_URL`) to the WS/API host.
