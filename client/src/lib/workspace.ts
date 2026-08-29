/**
 * Phase 2 workspace helpers: persistent tabs, cross-file search, soft locks.
 */

const TABS_KEY = 'collab-editor-tabs'
const PREFS_KEY = 'collab-editor-prefs'
const VOICE_REJOIN_KEY = 'collab-editor-voice-rejoin'

export interface RoomTabsState {
  openTabs: string[]
  activeTab: string | null
  previewEntryPath: string | null
  wordWrap?: 'on' | 'off'
}

export function loadRoomTabs(roomId: string): RoomTabsState | null {
  try {
    const raw = localStorage.getItem(TABS_KEY)
    if (!raw) return null
    const data = JSON.parse(raw) as Record<string, RoomTabsState>
    return data[roomId] || null
  } catch {
    return null
  }
}

export function saveRoomTabs(roomId: string, state: RoomTabsState) {
  try {
    const raw = localStorage.getItem(TABS_KEY)
    const data = raw ? JSON.parse(raw) : {}
    data[roomId] = state
    localStorage.setItem(TABS_KEY, JSON.stringify(data))
  } catch {
    /* ignore */
  }
}

export interface UserPrefs {
  color?: string
  displayName?: string
}

export function loadUserPrefs(): UserPrefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

export function saveUserPrefs(prefs: UserPrefs) {
  try {
    const prev = loadUserPrefs()
    localStorage.setItem(PREFS_KEY, JSON.stringify({ ...prev, ...prefs }))
  } catch {
    /* ignore */
  }
}

export function loadVoiceRejoin(roomId: string): 'general' | 'editors' | null {
  try {
    const raw = localStorage.getItem(VOICE_REJOIN_KEY)
    if (!raw) return null
    const data = JSON.parse(raw) as Record<string, string>
    const v = data[roomId]
    return v === 'general' || v === 'editors' ? v : null
  } catch {
    return null
  }
}

export function saveVoiceRejoin(roomId: string, channel: 'general' | 'editors' | null) {
  try {
    const raw = localStorage.getItem(VOICE_REJOIN_KEY)
    const data = raw ? JSON.parse(raw) : {}
    if (channel) data[roomId] = channel
    else delete data[roomId]
    localStorage.setItem(VOICE_REJOIN_KEY, JSON.stringify(data))
  } catch {
    /* ignore */
  }
}

export interface SearchHit {
  path: string
  line: number
  column: number
  text: string
  matchStart: number
  matchEnd: number
}

/** Case-insensitive search across text files. */
export function searchFiles(
  texts: Record<string, string>,
  query: string,
  maxHits = 200
): SearchHit[] {
  const q = query.trim()
  if (!q) return []
  const lower = q.toLowerCase()
  const hits: SearchHit[] = []

  for (const [path, content] of Object.entries(texts)) {
    if (!content) continue
    const lines = content.split('\n')
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      const idx = line.toLowerCase().indexOf(lower)
      if (idx === -1) continue
      hits.push({
        path,
        line: i + 1,
        column: idx + 1,
        text: line.length > 120 ? line.slice(0, 117) + '…' : line,
        matchStart: idx,
        matchEnd: idx + q.length
      })
      if (hits.length >= maxHits) return hits
    }
  }
  return hits
}

export interface LineComment {
  id: string
  path: string
  /** 1-based line number */
  line: number
  /** Optional selection end line */
  endLine?: number
  author: string
  color: string
  text: string
  ts: number
  /** Parent comment id for replies */
  parentId?: string | null
  resolved?: boolean
}

export const ROOM_TEMPLATES = [
  {
    id: 'blank',
    name: 'Blank',
    description: 'Empty room — no starter files',
    files: {} as Record<string, string>
  },
  {
    id: 'html',
    name: 'HTML starter',
    description: 'index.html + CSS + JS',
    files: {
      'index.html': `<!DOCTYPE html>
<html lang="en" data-theme="dark">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Collab project</title>
    <link rel="stylesheet" href="style.css" />
  </head>
  <body>
    <div class="topbar">
      <strong>My project</strong>
      <button type="button" id="theme-toggle" class="theme-btn" aria-label="Toggle theme">
        <span class="icon-sun">☀</span>
        <span class="icon-moon">☾</span>
        <span class="label">Theme</span>
      </button>
    </div>
    <main class="content">
      <h1>Hello, collaborators!</h1>
      <p>Edit any file in the explorer. This starter respects light &amp; dark mode.</p>
      <p class="hint">Toggle theme with the control above — CSS variables switch automatically.</p>
    </main>
    <script src="script.js"></script>
  </body>
</html>`,
      'style.css': `/* Theme tokens — edit these to restyle the whole project */
:root,
[data-theme="light"] {
  --bg: #f7f7f5;
  --surface: #fafaf8;
  --text: #1f1f1f;
  --muted: #777777;
  --border: #e2e2de;
  --accent: #6d5bd0;
  --accent-soft: #e9e5f7;
}

[data-theme="dark"] {
  --bg: #0a0a0b;
  --surface: #141416;
  --text: #f4f4f5;
  --muted: #a1a1aa;
  --border: #27272a;
  --accent: #8b5cf6;
  --accent-soft: rgba(139, 92, 246, 0.18);
}

* { box-sizing: border-box; }
body {
  margin: 0;
  font-family: system-ui, -apple-system, sans-serif;
  background: var(--bg);
  color: var(--text);
  transition: background 0.2s ease, color 0.2s ease;
}
.topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 20px;
  border-bottom: 1px solid var(--border);
  background: var(--surface);
}
.theme-btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: var(--bg);
  color: var(--text);
  cursor: pointer;
  font-size: 13px;
}
.theme-btn:hover { border-color: var(--accent); }
[data-theme="light"] .icon-moon { display: none; }
[data-theme="dark"] .icon-sun { display: none; }
.content { padding: 32px 24px; max-width: 640px; }
h1 { font-size: 1.75rem; margin: 0 0 8px; }
p { color: var(--muted); line-height: 1.5; }
.hint { font-size: 13px; color: var(--accent); }`,
      'script.js': `/* Theme switch — persists in localStorage */
(function () {
  const KEY = 'project-theme';
  const root = document.documentElement;
  const btn = document.getElementById('theme-toggle');

  function apply(theme) {
    root.setAttribute('data-theme', theme);
    try { localStorage.setItem(KEY, theme); } catch (_) {}
  }

  const saved = (function () {
    try { return localStorage.getItem(KEY); } catch (_) { return null; }
  })();
  if (saved === 'light' || saved === 'dark') apply(saved);
  else if (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) apply('light');
  else apply('dark');

  btn && btn.addEventListener('click', function () {
    const next = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    apply(next);
  });

  console.log('ready — theme:', root.getAttribute('data-theme'));
})();`
    }
  },
  {
    id: 'landing',
    name: 'Simple landing',
    description: 'Hero + CTA landing page',
    files: {
      'index.html': `<!DOCTYPE html>
<html lang="en" data-theme="dark">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Landing</title>
    <link rel="stylesheet" href="style.css" />
  </head>
  <body>
    <header class="nav">
      <strong>Acme</strong>
      <nav>
        <a href="#features">Features</a>
        <button type="button" id="theme-toggle" class="theme-btn" aria-label="Toggle theme">Theme</button>
        <a href="#cta" class="btn">Get started</a>
      </nav>
    </header>
    <main>
      <section class="hero">
        <h1>Ship together, faster</h1>
        <p>A minimal landing page template with built-in light &amp; dark mode.</p>
        <a href="#cta" class="btn primary">Try it free</a>
      </section>
      <section id="features" class="features">
        <div><h3>Realtime</h3><p>Edit with your team live.</p></div>
        <div><h3>Preview</h3><p>See changes instantly.</p></div>
        <div><h3>Share</h3><p>Invite editors or viewers.</p></div>
      </section>
      <section id="cta" class="cta">
        <h2>Ready when you are</h2>
        <button type="button" onclick="alert('Wire this up!')">Join waitlist</button>
      </section>
    </main>
    <script src="script.js"></script>
  </body>
</html>`,
      'style.css': `/* Theme tokens */
:root,
[data-theme="light"] {
  --bg: #f7f7f5;
  --surface: #ffffff;
  --text: #1f1f1f;
  --muted: #666666;
  --border: #e2e2de;
  --card: #f3f3f1;
  --accent: #6d5bd0;
  --btn: #1f1f1f;
  --btn-text: #ffffff;
}
[data-theme="dark"] {
  --bg: #0b0f19;
  --surface: #111827;
  --text: #e8eaed;
  --muted: #9ca3af;
  --border: #1f2937;
  --card: #111827;
  --accent: #8b5cf6;
  --btn: #1f2937;
  --btn-text: #ffffff;
}
* { box-sizing: border-box; }
body { margin: 0; font-family: system-ui, sans-serif; background: var(--bg); color: var(--text); transition: background 0.2s, color 0.2s; }
.nav { display: flex; justify-content: space-between; align-items: center; padding: 16px 24px; border-bottom: 1px solid var(--border); background: var(--surface); }
.nav a { color: var(--muted); text-decoration: none; margin-left: 16px; font-size: 14px; }
.theme-btn { margin-left: 16px; padding: 6px 12px; border-radius: 8px; border: 1px solid var(--border); background: var(--bg); color: var(--text); cursor: pointer; font-size: 13px; }
.btn { display: inline-block; padding: 8px 14px; border-radius: 8px; background: var(--btn); color: var(--btn-text) !important; }
.btn.primary { background: var(--accent); }
.hero { text-align: center; padding: 80px 24px 48px; }
.hero h1 { font-size: 2.5rem; margin: 0 0 12px; }
.hero p { color: var(--muted); max-width: 420px; margin: 0 auto 24px; }
.features { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 16px; padding: 24px; max-width: 900px; margin: 0 auto; }
.features div { background: var(--card); border: 1px solid var(--border); border-radius: 12px; padding: 20px; }
.features h3 { margin: 0 0 8px; }
.features p { margin: 0; color: var(--muted); font-size: 14px; }
.cta { text-align: center; padding: 48px 24px 80px; }
.cta button { background: var(--accent); color: #fff; border: 0; padding: 12px 20px; border-radius: 10px; font-size: 15px; cursor: pointer; }`,
      'script.js': `(function () {
  const KEY = 'project-theme';
  const root = document.documentElement;
  const btn = document.getElementById('theme-toggle');
  function apply(theme) {
    root.setAttribute('data-theme', theme);
    try { localStorage.setItem(KEY, theme); } catch (_) {}
  }
  let saved = null;
  try { saved = localStorage.getItem(KEY); } catch (_) {}
  if (saved === 'light' || saved === 'dark') apply(saved);
  else if (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) apply('light');
  else apply('dark');
  btn && btn.addEventListener('click', function () {
    apply(root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
  });
  console.log('landing ready');
})();`
  }
  }
] as const

export type TemplateId = (typeof ROOM_TEMPLATES)[number]['id']
