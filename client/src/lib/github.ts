/**
 * Phase 2 — GitHub REST API helpers for collab rooms.
 * Uses a Personal Access Token (classic: repo scope, or fine-grained: contents + PRs).
 * Browser-native fetch (GitHub API allows CORS with Authorization header).
 */

const GH_API = 'https://api.github.com'
const TOKEN_KEY = 'collab-editor-github-token'
const USER_KEY = 'collab-editor-github-user'
const REMOTE_PREFIX = 'collab-editor-github-remote:'

export interface GitHubUser {
  login: string
  name: string | null
  avatar_url: string
}

export interface GitHubRemote {
  owner: string
  repo: string
  defaultBranch: string
  /** full https clone url without .git required */
  url: string
}

export interface GhFileEntry {
  path: string
  content: string
  sha?: string
}

export interface GhPullRequest {
  number: number
  html_url: string
  title: string
  state: string
}

function headers(token?: string | null): HeadersInit {
  const h: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type': 'application/json'
  }
  if (token) h.Authorization = `Bearer ${token}`
  return h
}

export function loadGitHubToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY)
  } catch {
    return null
  }
}

export function saveGitHubToken(token: string | null) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token.trim())
    else {
      localStorage.removeItem(TOKEN_KEY)
      localStorage.removeItem(USER_KEY)
    }
  } catch {
    /* ignore */
  }
}

export function loadGitHubUser(): GitHubUser | null {
  try {
    const raw = localStorage.getItem(USER_KEY)
    return raw ? (JSON.parse(raw) as GitHubUser) : null
  } catch {
    return null
  }
}

function saveGitHubUser(user: GitHubUser | null) {
  try {
    if (user) localStorage.setItem(USER_KEY, JSON.stringify(user))
    else localStorage.removeItem(USER_KEY)
  } catch {
    /* ignore */
  }
}

export function loadRoomRemote(roomId: string): GitHubRemote | null {
  try {
    const raw = localStorage.getItem(REMOTE_PREFIX + roomId)
    return raw ? (JSON.parse(raw) as GitHubRemote) : null
  } catch {
    return null
  }
}

export function saveRoomRemote(roomId: string, remote: GitHubRemote | null) {
  try {
    if (remote) localStorage.setItem(REMOTE_PREFIX + roomId, JSON.stringify(remote))
    else localStorage.removeItem(REMOTE_PREFIX + roomId)
  } catch {
    /* ignore */
  }
}

/** Parse owner/repo from URL or shorthand. */
export function parseRepoRef(input: string): { owner: string; repo: string } | null {
  const s = input.trim().replace(/\.git$/, '')
  // https://github.com/owner/repo
  let m = s.match(/github\.com[/:]([^/]+)\/([^/\s#?]+)/i)
  if (m) return { owner: m[1], repo: m[2] }
  // owner/repo
  m = s.match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/)
  if (m) return { owner: m[1], repo: m[2] }
  return null
}

async function gh<T>(
  token: string | null | undefined,
  path: string,
  init?: RequestInit
): Promise<{ ok: true; data: T; status: number } | { ok: false; error: string; status: number }> {
  try {
    const res = await fetch(`${GH_API}${path}`, {
      ...init,
      headers: { ...headers(token), ...(init?.headers || {}) }
    })
    if (res.status === 204) {
      return { ok: true, data: null as T, status: 204 }
    }
    const text = await res.text()
    let data: unknown = null
    try {
      data = text ? JSON.parse(text) : null
    } catch {
      data = text
    }
    if (!res.ok) {
      const msg =
        data && typeof data === 'object' && data !== null && 'message' in data
          ? String((data as { message: string }).message)
          : res.statusText || `HTTP ${res.status}`
      return { ok: false, error: msg, status: res.status }
    }
    return { ok: true, data: data as T, status: res.status }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e), status: 0 }
  }
}

export async function verifyToken(token: string): Promise<{ ok: true; user: GitHubUser } | { ok: false; error: string }> {
  const r = await gh<GitHubUser>(token, '/user')
  if (!r.ok) return { ok: false, error: r.error }
  const user: GitHubUser = {
    login: r.data.login,
    name: r.data.name,
    avatar_url: r.data.avatar_url
  }
  saveGitHubToken(token)
  saveGitHubUser(user)
  return { ok: true, user }
}

export function disconnectGitHub() {
  saveGitHubToken(null)
  saveGitHubUser(null)
}

export async function getRepo(
  token: string,
  owner: string,
  repo: string
): Promise<{ ok: true; defaultBranch: string; full_name: string } | { ok: false; error: string }> {
  const r = await gh<{ default_branch: string; full_name: string }>(token, `/repos/${owner}/${repo}`)
  if (!r.ok) return { ok: false, error: r.error }
  return { ok: true, defaultBranch: r.data.default_branch, full_name: r.data.full_name }
}

export async function listBranches(
  token: string,
  owner: string,
  repo: string
): Promise<{ ok: true; branches: string[] } | { ok: false; error: string }> {
  const r = await gh<{ name: string }[]>(token, `/repos/${owner}/${repo}/branches?per_page=100`)
  if (!r.ok) return { ok: false, error: r.error }
  return { ok: true, branches: (r.data || []).map((b) => b.name) }
}

interface GhRef {
  ref: string
  object: { sha: string; type: string }
}

interface GhCommit {
  sha: string
  tree: { sha: string }
  message: string
  parents: { sha: string }[]
}

interface GhTree {
  sha: string
  tree: { path: string; mode: string; type: string; sha: string; size?: number }[]
}

/** Recursively list text files from a branch (via git tree API). */
export async function fetchTreeFiles(
  token: string | null | undefined,
  owner: string,
  repo: string,
  branch: string
): Promise<{ ok: true; files: GhFileEntry[]; commitSha: string } | { ok: false; error: string }> {
  // Resolve branch → commit SHA
  let commitSha = ''
  const ref = await gh<GhRef>(token, `/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(branch)}`)
  if (ref.ok) {
    commitSha = ref.data.object.sha
  } else {
    const br = await gh<{ commit: { sha: string } }>(
      token,
      `/repos/${owner}/${repo}/branches/${encodeURIComponent(branch)}`
    )
    if (!br.ok) {
      return {
        ok: false,
        error: `Branch '${branch}' not found (${ref.error}). Set the correct default branch in Connect GitHub.`
      }
    }
    commitSha = br.data.commit.sha
  }

  const commit = await gh<GhCommit>(token, `/repos/${owner}/${repo}/git/commits/${commitSha}`)
  if (!commit.ok) return { ok: false, error: `commit: ${commit.error}` }

  const tree = await gh<GhTree>(
    token,
    `/repos/${owner}/${repo}/git/trees/${commit.data.tree.sha}?recursive=1`
  )
  if (!tree.ok) return { ok: false, error: `tree: ${tree.error}` }

  const blobs = (tree.data.tree || []).filter(
    (t) => t.type === 'blob' && t.path && (!t.size || t.size < 1_500_000)
  )

  if (blobs.length === 0) {
    return { ok: false, error: 'Repository tree is empty (no files found).' }
  }

  const files: GhFileEntry[] = []
  const concurrency = 6
  let blobErrors = 0
  for (let i = 0; i < blobs.length; i += concurrency) {
    const chunk = blobs.slice(i, i + concurrency)
    const results = await Promise.all(
      chunk.map(async (b) => {
        const blob = await gh<{ content: string; encoding: string; sha: string }>(
          token,
          `/repos/${owner}/${repo}/git/blobs/${b.sha}`
        )
        if (!blob.ok) {
          blobErrors++
          return null
        }
        let content = blob.data.content || ''
        if (blob.data.encoding === 'base64') {
          try {
            content = decodeBase64Utf8(content.replace(/\n/g, ''))
          } catch {
            return null
          }
        }
        if (content.includes('\0')) return null
        return { path: b.path, content, sha: blob.data.sha } as GhFileEntry
      })
    )
    for (const f of results) if (f) files.push(f)
  }

  if (files.length === 0) {
    return {
      ok: false,
      error: `No text files could be loaded (${blobs.length} blobs, ${blobErrors} errors). Token may lack Contents access.`
    }
  }

  return { ok: true, files, commitSha }
}

export async function pushTree(
  token: string,
  owner: string,
  repo: string,
  branch: string,
  files: Record<string, string>,
  message: string,
  authorName: string
): Promise<{ ok: true; commitSha: string; url: string } | { ok: false; error: string }> {
  // Current branch tip (or create orphan if missing)
  let parentSha: string | null = null
  let baseTreeSha: string | null = null
  const ref = await gh<GhRef>(token, `/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(branch)}`)
  if (ref.ok) {
    parentSha = ref.data.object.sha
    const commit = await gh<GhCommit>(token, `/repos/${owner}/${repo}/git/commits/${parentSha}`)
    if (commit.ok) baseTreeSha = commit.data.tree.sha
  }

  // Create blobs
  const treeItems: { path: string; mode: string; type: 'blob'; sha: string }[] = []
  const paths = Object.keys(files).sort()
  for (const path of paths) {
    const content = files[path]
    const blob = await gh<{ sha: string }>(token, `/repos/${owner}/${repo}/git/blobs`, {
      method: 'POST',
      body: JSON.stringify({ content: encodeBase64Utf8(content), encoding: 'base64' })
    })
    if (!blob.ok) return { ok: false, error: `blob ${path}: ${blob.error}` }
    treeItems.push({ path, mode: '100644', type: 'blob', sha: blob.data.sha })
  }

  const treeBody: Record<string, unknown> = {
    tree: treeItems,
    base_tree: baseTreeSha || undefined
  }
  // If we want a full replace of text files only, base_tree keeps binaries/other files from remote
  const tree = await gh<{ sha: string }>(token, `/repos/${owner}/${repo}/git/trees`, {
    method: 'POST',
    body: JSON.stringify(treeBody)
  })
  if (!tree.ok) return { ok: false, error: `tree: ${tree.error}` }

  const commitBody: Record<string, unknown> = {
    message,
    tree: tree.data.sha,
    parents: parentSha ? [parentSha] : [],
    author: {
      name: authorName || 'collab-editor',
      email: 'collab-editor@users.noreply.github.com',
      date: new Date().toISOString()
    }
  }
  const commit = await gh<{ sha: string; html_url?: string }>(token, `/repos/${owner}/${repo}/git/commits`, {
    method: 'POST',
    body: JSON.stringify(commitBody)
  })
  if (!commit.ok) return { ok: false, error: `commit: ${commit.error}` }

  if (parentSha) {
    const upd = await gh<unknown>(token, `/repos/${owner}/${repo}/git/refs/heads/${encodeURIComponent(branch)}`, {
      method: 'PATCH',
      body: JSON.stringify({ sha: commit.data.sha, force: false })
    })
    if (!upd.ok) return { ok: false, error: `update ref: ${upd.error}` }
  } else {
    const create = await gh<unknown>(token, `/repos/${owner}/${repo}/git/refs`, {
      method: 'POST',
      body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: commit.data.sha })
    })
    if (!create.ok) return { ok: false, error: `create ref: ${create.error}` }
  }

  return {
    ok: true,
    commitSha: commit.data.sha,
    url: `https://github.com/${owner}/${repo}/commit/${commit.data.sha}`
  }
}

export async function createPullRequest(
  token: string,
  owner: string,
  repo: string,
  head: string,
  base: string,
  title: string,
  body?: string
): Promise<{ ok: true; pr: GhPullRequest } | { ok: false; error: string }> {
  const r = await gh<{ number: number; html_url: string; title: string; state: string }>(
    token,
    `/repos/${owner}/${repo}/pulls`,
    {
      method: 'POST',
      body: JSON.stringify({ title, head, base, body: body || '' })
    }
  )
  if (!r.ok) return { ok: false, error: r.error }
  return {
    ok: true,
    pr: {
      number: r.data.number,
      html_url: r.data.html_url,
      title: r.data.title,
      state: r.data.state
    }
  }
}

export async function listOpenPulls(
  token: string,
  owner: string,
  repo: string
): Promise<{ ok: true; prs: GhPullRequest[] } | { ok: false; error: string }> {
  const r = await gh<{ number: number; html_url: string; title: string; state: string }[]>(
    token,
    `/repos/${owner}/${repo}/pulls?state=open&per_page=20`
  )
  if (!r.ok) return { ok: false, error: r.error }
  return {
    ok: true,
    prs: (r.data || []).map((p) => ({
      number: p.number,
      html_url: p.html_url,
      title: p.title,
      state: p.state
    }))
  }
}
