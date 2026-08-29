import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'fs'
import path from 'path'

/**
 * Optional HTTPS for LAN access (mic / WebRTC / clipboard).
 * Place certs next to this file:
 *   client/certs/key.pem
 *   client/certs/cert.pem
 * Generate with mkcert (see README / HTTPS-LAN.md).
 */
function loadHttps() {
  const key = path.resolve(__dirname, 'certs/key.pem')
  const cert = path.resolve(__dirname, 'certs/cert.pem')
  if (fs.existsSync(key) && fs.existsSync(cert)) {
    return {
      key: fs.readFileSync(key),
      cert: fs.readFileSync(cert)
    }
  }
  return undefined
}

const https = loadHttps()

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
	allowedHosts: true,
    https,
    // HMR over WSS when using HTTPS
    hmr: https
      ? {
          protocol: 'wss'
        }
      : undefined
  }
})
