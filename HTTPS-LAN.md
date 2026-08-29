# HTTPS on your LAN (mic, WebRTC, clipboard)

Browsers only allow the microphone on a **secure context**:
- `https://...` or
- `http://localhost` / `http://127.0.0.1`

`http://192.168.x.x` is **not** secure → mic and call stay blocked.

## Recommended: mkcert (trusted local certificates)

### 1. Install mkcert (host PC)

**Windows (Chocolatey):**
```bat
choco install mkcert
```

Or download a release from: https://github.com/FiloSottile/mkcert/releases

Then install the local CA (one time, as Administrator if needed):
```bat
mkcert -install
```

### 2. Create certs for your LAN IP

```bat
cd C:\Users\USER\Downloads\collab\collab-editor
mkdir client\certs 2>nul
cd client\certs

REM Replace 192.168.1.42 with YOUR ipconfig IPv4
mkcert -key-file key.pem -cert-file cert.pem 192.168.1.42 localhost 127.0.0.1
```

You can list several IPs if the host IP changes:
```bat
mkcert -key-file key.pem -cert-file cert.pem 192.168.1.42 192.168.0.15 localhost 127.0.0.1
```

### 3. Point the client at WSS

`client\.env`:
```env
VITE_WS_URL=wss://192.168.1.42:1234
```

(Note **`wss://`**, not `ws://`.)

### 4. Restart both processes

```bat
cd server
npm run start

cd ..\client
npm run dev
```

Vite and the server auto-load `client/certs/key.pem` + `cert.pem` when present.

### 5. Open HTTPS on every PC

```text
https://192.168.1.42:5173/room/...?pwd=...
```

**First visit:** if the browser warns about the certificate:

- **mkcert -install** must have been run on **that PC too**, or  
- Click through “Advanced → Proceed” (works, but install CA on each device for a clean lock icon).

On phones, install the mkcert root CA (see mkcert docs) or accept the warning once.

### 6. Firewall

Allow inbound TCP **5173** and **1234** on the host.

---

## Alternative: Chrome flag (dev only, not ideal)

On each Chrome that needs the mic without HTTPS:

```text
chrome://flags/#unsafely-treat-insecure-origin-as-secure
```

Add `http://192.168.1.42:5173` and enable. Restart Chrome.

This is weaker than real HTTPS and easy to forget; prefer mkcert.

---

## Checklist

| Step | Done |
|------|------|
| `mkcert -install` on host | |
| Certs in `client/certs/` for your LAN IP | |
| `.env` has `VITE_WS_URL=wss://LAN_IP:1234` | |
| Server + Vite restarted | |
| Open **https://**LAN_IP:5173 (not http) | |
| Allow mic when the browser asks | |
