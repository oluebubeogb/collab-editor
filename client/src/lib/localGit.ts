/**
 * Phase 1 — Client-side local Git for collab rooms.
 * Treats the room file tree as a normal working directory.
 * No remote operations (Phase 2). Persists per-room in localStorage.
 */

export type GitFileStatus = 'modified' | 'added' | 'deleted' | 'untracked' | 'staged'

export interface GitStatusEntry {
  path: string
  status: GitFileStatus
  staged: boolean
}

export interface GitCommit {
  hash: string
  message: string
  author: string
  timestamp: number
  /** path -> content at commit time */
  tree: Record<string, string>
  parent: string | null
}

export interface GitBranch {
  name: string
  tip: string // commit hash
}

export interface LocalGitState {
  initialized: boolean
  head: string | null // commit hash
  branch: string
  branches: GitBranch[]
  commits: GitCommit[]
  /** staged paths -> content snapshot at stage time (or null if staged delete) */
  index: Record<string, string | null>
  /** last known working tree snapshot used for dirty detection helpers */
  lastWorkingSnapshot?: Record<string, string>
}

const STORAGE_PREFIX = 'collab-editor-local-git:'

function emptyState(): LocalGitState {
  return {
    initialized: false,
    head: null,
    branch: 'main',
    branches: [{ name: 'main', tip: '' }],
    commits: [],
    index: {}
  }
}

function shortHash(full: string): string {
  return full.slice(0, 7)
}

function makeHash(parts: string[]): string {
  // Simple non-crypto hash for local use
  let h = 0
  const s = parts.join('\0') + '|' + Date.now().toString(36) + '|' + Math.random().toString(36).slice(2)
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(31, h) + s.charCodeAt(i)) | 0
  }
  const hex = (h >>> 0).toString(16).padStart(8, '0')
  return hex + Math.random().toString(16).slice(2, 10) + Date.now().toString(16).slice(-4)
}

export function loadLocalGit(roomId: string): LocalGitState {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + roomId)
    if (!raw) return emptyState()
    const data = JSON.parse(raw) as LocalGitState
    if (!data || typeof data !== 'object') return emptyState()
    return {
      ...emptyState(),
      ...data,
      branches: data.branches?.length ? data.branches : emptyState().branches,
      commits: data.commits || [],
      index: data.index || {}
    }
  } catch {
    return emptyState()
  }
}

export function saveLocalGit(roomId: string, state: LocalGitState) {
  try {
    localStorage.setItem(STORAGE_PREFIX + roomId, JSON.stringify(state))
  } catch {
    /* quota / private mode */
  }
}

/** Build working-tree map from room texts (folders omitted). */
export function workingTreeFromTexts(texts: Record<string, string>): Record<string, string> {
  const tree: Record<string, string> = {}
  for (const [path, content] of Object.entries(texts)) {
    if (path && content !== undefined) tree[path] = content
  }
  return tree
}

function treeAtHead(state: LocalGitState): Record<string, string> {
  if (!state.head) return {}
  const c = state.commits.find((x) => x.hash === state.head)
  return c ? { ...c.tree } : {}
}

/** Compute status against HEAD + index. */
export function computeStatus(
  state: LocalGitState,
  working: Record<string, string>
): GitStatusEntry[] {
  const headTree = treeAtHead(state)
  const paths = new Set([
    ...Object.keys(headTree),
    ...Object.keys(working),
    ...Object.keys(state.index)
  ])
  const entries: GitStatusEntry[] = []

  for (const path of [...paths].sort()) {
    const inHead = path in headTree
    const inWork = path in working
    const staged = path in state.index
    const stagedContent = staged ? state.index[path] : undefined
    const workContent = inWork ? working[path] : undefined
    const headContent = inHead ? headTree[path] : undefined

    if (staged) {
      // staged add / modify / delete
      if (stagedContent === null) {
        entries.push({ path, status: 'deleted', staged: true })
      } else if (!inHead) {
        entries.push({ path, status: 'added', staged: true })
      } else if (stagedContent !== headContent) {
        entries.push({ path, status: 'modified', staged: true })
      }
      // also unstaged changes relative to index
      if (stagedContent === null) {
        if (inWork) entries.push({ path, status: 'added', staged: false }) // re-added after staged delete
      } else if (!inWork) {
        entries.push({ path, status: 'deleted', staged: false })
      } else if (workContent !== stagedContent) {
        entries.push({ path, status: 'modified', staged: false })
      }
      continue
    }

    if (!inHead && inWork) {
      entries.push({ path, status: 'untracked', staged: false })
      continue
    }
    if (inHead && !inWork) {
      entries.push({ path, status: 'deleted', staged: false })
      continue
    }
    if (inHead && inWork && workContent !== headContent) {
      entries.push({ path, status: 'modified', staged: false })
    }
  }

  return entries
}

export interface GitExecResult {
  ok: boolean
  lines: string[]
  state: LocalGitState
  /** optional structured status for UI */
  status?: GitStatusEntry[]
}

export interface GitExecContext {
  roomId: string
  author: string
  working: Record<string, string>
  /** optional: apply restored file content back into the room */
  onRestoreFile?: (path: string, content: string | null) => void
}

/**
 * Execute a single git (or helper) command string against local state.
 * Supports Phase 1 local commands only.
 */
export function execGitCommand(raw: string, ctx: GitExecContext): GitExecResult {
  let state = loadLocalGit(ctx.roomId)
  const working = ctx.working
  const parts = tokenize(raw.trim())
  if (parts.length === 0) {
    return { ok: true, lines: [], state }
  }

  const cmd = parts[0]
  const args = parts.slice(1)

  // Allow bare "git ..." or direct subcommands
  let sub = cmd
  let subArgs = args
  if (cmd === 'git') {
    if (args.length === 0) {
      return helpResult(state)
    }
    sub = args[0]
    subArgs = args.slice(1)
  }

  switch (sub) {
    case 'help':
    case '--help':
      return helpResult(state)

    case 'init':
      return cmdInit(state, ctx)

    case 'status':
    case 'st':
      return cmdStatus(state, working, subArgs)

    case 'add':
      return cmdAdd(state, working, subArgs, ctx)

    case 'restore':
    case 'checkout':
      return cmdRestoreOrCheckout(state, working, subArgs, ctx)

    case 'reset':
      return cmdReset(state, working, subArgs, ctx)

    case 'commit':
      return cmdCommit(state, working, subArgs, ctx)

    case 'log':
      return cmdLog(state, subArgs)

    case 'diff':
      return cmdDiff(state, working, subArgs)

    case 'branch':
      return cmdBranch(state, subArgs, ctx)

    case 'switch':
      return cmdSwitch(state, working, subArgs, ctx)

    case 'stash':
      return {
        ok: false,
        lines: ['stash: not fully implemented in Phase 1 (coming in a later update).'],
        state
      }

    case 'remote':
    case 'push':
    case 'pull':
    case 'fetch':
    case 'clone':
      return {
        ok: false,
        lines: [
          `${sub}: remote operations are Phase 2.`,
          'Connect GitHub in Phase 2 to push / pull / create PRs.'
        ],
        state
      }

    default:
      return {
        ok: false,
        lines: [
          `git: '${sub}' is not a Phase 1 command. Try: status, add, commit, log, diff, branch, switch, restore, init`,
          "Type 'git help' for the list."
        ],
        state
      }
  }
}

function helpResult(state: LocalGitState): GitExecResult {
  return {
    ok: true,
    lines: [
      'Phase 1 local Git — room files act as the working tree.',
      '',
      '  git init                 Initialize local repo for this room',
      '  git status               Show staged / unstaged / untracked',
      '  git add <path>| .        Stage files',
      '  git commit -m "msg"      Create commit from index',
      '  git diff [--staged]      Diff working tree or index vs HEAD',
      '  git log [--oneline]      Commit history',
      '  git branch [name]        List or create branches',
      '  git switch <branch>      Switch branch (Phase 1: same tree)',
      '  git restore <path>       Discard working changes (to HEAD)',
      '  git restore --staged <p> Unstage',
      '  git reset HEAD <path>    Unstage (alias)',
      '',
      'Remote (push/pull/PR) arrives in Phase 2.'
    ],
    state
  }
}

function cmdInit(state: LocalGitState, ctx: GitExecContext): GitExecResult {
  if (state.initialized && state.head) {
    return { ok: true, lines: ['Reinitialized existing local Git repository for this room.'], state }
  }
  const next: LocalGitState = {
    ...emptyState(),
    initialized: true,
    branch: 'main',
    branches: [{ name: 'main', tip: '' }],
    commits: [],
    head: null,
    index: {}
  }
  // Optional initial commit of current tree
  const working = ctx.working
  if (Object.keys(working).length > 0) {
    const hash = makeHash(['init', ctx.author])
    const commit: GitCommit = {
      hash,
      message: 'Initial commit',
      author: ctx.author || 'collaborator',
      timestamp: Date.now(),
      tree: { ...working },
      parent: null
    }
    next.commits = [commit]
    next.head = hash
    next.branches = [{ name: 'main', tip: hash }]
  }
  saveLocalGit(ctx.roomId, next)
  return {
    ok: true,
    lines: [
      'Initialized local Git repository for this room.',
      next.head ? `Created initial commit ${shortHash(next.head)} on main.` : 'Working tree empty — commit after adding files.'
    ],
    state: next
  }
}

function ensureInit(state: LocalGitState, ctx: GitExecContext): { state: LocalGitState; lines: string[] } {
  if (state.initialized) return { state, lines: [] }
  const r = cmdInit(state, ctx)
  return { state: r.state, lines: r.lines }
}

function cmdStatus(state: LocalGitState, working: Record<string, string>, _args: string[]): GitExecResult {
  if (!state.initialized) {
    return {
      ok: true,
      lines: [
        'Not a local git repository yet. Run: git init',
        '(Room files are still collaborative — init enables status/commit.)'
      ],
      state
    }
  }
  const status = computeStatus(state, working)
  const lines: string[] = [
    `On branch ${state.branch}`,
    state.head ? `HEAD ${shortHash(state.head)}` : 'No commits yet'
  ]

  const staged = status.filter((s) => s.staged)
  const unstaged = status.filter((s) => !s.staged && s.status !== 'untracked')
  const untracked = status.filter((s) => s.status === 'untracked')

  if (staged.length) {
    lines.push('', 'Changes to be committed:')
    for (const e of staged) {
      lines.push(`  ${padStatus(e.status)} ${e.path}`)
    }
  }
  if (unstaged.length) {
    lines.push('', 'Changes not staged for commit:')
    for (const e of unstaged) {
      lines.push(`  ${padStatus(e.status)} ${e.path}`)
    }
  }
  if (untracked.length) {
    lines.push('', 'Untracked files:')
    for (const e of untracked) {
      lines.push(`  ${e.path}`)
    }
  }
  if (!staged.length && !unstaged.length && !untracked.length) {
    lines.push('', 'nothing to commit, working tree clean')
  }

  return { ok: true, lines, state, status }
}

function padStatus(s: GitFileStatus): string {
  return (s + ':').padEnd(10)
}

function cmdAdd(
  state: LocalGitState,
  working: Record<string, string>,
  args: string[],
  ctx: GitExecContext
): GitExecResult {
  const ensured = ensureInit(state, ctx)
  state = ensured.state
  if (args.length === 0) {
    return { ok: false, lines: [...ensured.lines, 'usage: git add <pathspec> | git add .'], state }
  }

  const index = { ...state.index }
  const headTree = treeAtHead(state)
  const addAll = args.includes('.') || args.includes('-A') || args.includes('--all')
  const paths = addAll
    ? [...new Set([...Object.keys(working), ...Object.keys(headTree)])]
    : args.filter((a) => !a.startsWith('-'))

  let n = 0
  for (const path of paths) {
    if (path in working) {
      index[path] = working[path]
      n++
    } else if (path in headTree) {
      // stage deletion
      index[path] = null
      n++
    }
  }

  const next = { ...state, index }
  saveLocalGit(ctx.roomId, next)
  return {
    ok: true,
    lines: [...ensured.lines, n ? `Staged ${n} path(s).` : 'Nothing matched to stage.'],
    state: next
  }
}

function cmdRestoreOrCheckout(
  state: LocalGitState,
  working: Record<string, string>,
  args: string[],
  ctx: GitExecContext
): GitExecResult {
  if (!state.initialized) {
    return { ok: false, lines: ['Not a repository. Run git init first.'], state }
  }

  const stagedFlag = args.includes('--staged') || args.includes('--staged=true')
  const paths = args.filter((a) => !a.startsWith('-'))

  // git checkout -b / git checkout <branch> handled lightly
  if (args[0] === '-b' && args[1]) {
    return cmdBranch(state, [args[1]], ctx)
  }
  if (paths.length === 1 && state.branches.some((b) => b.name === paths[0]) && !stagedFlag) {
    return cmdSwitch(state, working, paths, ctx)
  }

  if (paths.length === 0) {
    return {
      ok: false,
      lines: ['usage: git restore [--staged] <path>', '       git checkout -- <path>'],
      state
    }
  }

  if (stagedFlag) {
    const index = { ...state.index }
    for (const p of paths) delete index[p]
    const next = { ...state, index }
    saveLocalGit(ctx.roomId, next)
    return { ok: true, lines: [`Unstaged ${paths.join(', ')}`], state: next }
  }

  // restore working tree from HEAD
  const headTree = treeAtHead(state)
  const restored: string[] = []
  for (const p of paths) {
    if (p in headTree) {
      ctx.onRestoreFile?.(p, headTree[p])
      restored.push(p)
    } else {
      // file not in HEAD → delete from working if present
      ctx.onRestoreFile?.(p, null)
      restored.push(p)
    }
  }
  return {
    ok: true,
    lines: restored.length
      ? [`Restored ${restored.join(', ')} from HEAD.`]
      : ['No matching paths in HEAD.'],
    state
  }
}

function cmdReset(
  state: LocalGitState,
  working: Record<string, string>,
  args: string[],
  ctx: GitExecContext
): GitExecResult {
  // git reset HEAD <path> → unstage
  const paths = args.filter((a) => a !== 'HEAD' && !a.startsWith('-'))
  if (args.includes('--hard')) {
    return {
      ok: false,
      lines: ['git reset --hard is disabled in Phase 1 for safety. Use git restore <path> instead.'],
      state
    }
  }
  if (paths.length === 0) {
    return { ok: false, lines: ['usage: git reset HEAD <path>'], state }
  }
  return cmdRestoreOrCheckout(state, working, ['--staged', ...paths], ctx)
}

function cmdCommit(
  state: LocalGitState,
  working: Record<string, string>,
  args: string[],
  ctx: GitExecContext
): GitExecResult {
  const ensured = ensureInit(state, ctx)
  state = ensured.state

  let message = ''
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '-m' && args[i + 1]) {
      message = args[i + 1]
      break
    }
  }
  if (!message) {
    // allow: git commit -m"msg"
    const m = args.find((a) => a.startsWith('-m'))
    if (m && m.length > 2) message = m.slice(2)
  }
  if (!message) {
    return {
      ok: false,
      lines: [...ensured.lines, 'usage: git commit -m "your message"'],
      state
    }
  }

  const status = computeStatus(state, working)
  const staged = status.filter((s) => s.staged)
  if (staged.length === 0 && Object.keys(state.index).length === 0) {
    // convenience: if nothing staged but working dirty, suggest add
    const dirty = status.filter((s) => !s.staged)
    if (dirty.length === 0) {
      return { ok: false, lines: [...ensured.lines, 'nothing to commit, working tree clean'], state }
    }
    return {
      ok: false,
      lines: [
        ...ensured.lines,
        'No changes staged. Run: git add .',
        `Then: git commit -m "${message}"`
      ],
      state
    }
  }

  const headTree = treeAtHead(state)
  const newTree = { ...headTree }
  for (const [path, content] of Object.entries(state.index)) {
    if (content === null) delete newTree[path]
    else newTree[path] = content
  }

  const hash = makeHash([message, ctx.author, JSON.stringify(Object.keys(newTree))])
  const commit: GitCommit = {
    hash,
    message,
    author: ctx.author || 'collaborator',
    timestamp: Date.now(),
    tree: newTree,
    parent: state.head
  }

  const branches = state.branches.map((b) =>
    b.name === state.branch ? { ...b, tip: hash } : b
  )
  if (!branches.some((b) => b.name === state.branch)) {
    branches.push({ name: state.branch, tip: hash })
  }

  const next: LocalGitState = {
    ...state,
    initialized: true,
    head: hash,
    commits: [...state.commits, commit],
    branches,
    index: {}
  }
  saveLocalGit(ctx.roomId, next)
  return {
    ok: true,
    lines: [
      ...ensured.lines,
      `[${state.branch} ${shortHash(hash)}] ${message}`,
      `${Object.keys(state.index).length} file(s) committed.`
    ],
    state: next
  }
}

function cmdLog(state: LocalGitState, args: string[]): GitExecResult {
  if (!state.initialized || state.commits.length === 0) {
    return { ok: true, lines: ['No commits yet.'], state }
  }
  const oneline = args.includes('--oneline') || args.includes('-1') || args.includes('-n')
  const lines: string[] = []
  // Walk from HEAD
  const byHash = new Map(state.commits.map((c) => [c.hash, c]))
  let cur: string | null = state.head
  let count = 0
  const limit = 50
  while (cur && count < limit) {
    const c = byHash.get(cur)
    if (!c) break
    if (oneline) {
      lines.push(`${shortHash(c.hash)} ${c.message}`)
    } else {
      lines.push(`commit ${c.hash}`)
      lines.push(`Author: ${c.author}`)
      lines.push(`Date:   ${new Date(c.timestamp).toLocaleString()}`)
      lines.push('')
      lines.push(`    ${c.message}`)
      lines.push('')
    }
    cur = c.parent
    count++
  }
  return { ok: true, lines, state }
}

function cmdDiff(
  state: LocalGitState,
  working: Record<string, string>,
  args: string[]
): GitExecResult {
  if (!state.initialized) {
    return { ok: false, lines: ['Not a repository. Run git init first.'], state }
  }
  const staged = args.includes('--staged') || args.includes('--cached')
  const headTree = treeAtHead(state)
  const lines: string[] = []

  if (staged) {
    for (const [path, content] of Object.entries(state.index)) {
      const before = headTree[path]
      const after = content
      if (before === after) continue
      lines.push(`diff --git a/${path} b/${path}`)
      if (after === null) {
        lines.push(`deleted file`)
        lines.push(...unifiedDiff(before || '', ''))
      } else if (before === undefined) {
        lines.push(`new file`)
        lines.push(...unifiedDiff('', after))
      } else {
        lines.push(...unifiedDiff(before, after))
      }
      lines.push('')
    }
  } else {
    const status = computeStatus(state, working)
    for (const e of status) {
      if (e.staged && !args.includes('--staged')) {
        // show unstaged portion only when not requesting staged
      }
      const before =
        e.path in state.index
          ? state.index[e.path] === null
            ? ''
            : state.index[e.path] ?? headTree[e.path] ?? ''
          : headTree[e.path] ?? ''
      const after = working[e.path] ?? ''
      if (before === after && e.status !== 'deleted') continue
      lines.push(`diff --git a/${e.path} b/${e.path}`)
      if (e.status === 'deleted' || !(e.path in working)) {
        lines.push(...unifiedDiff(typeof before === 'string' ? before : '', ''))
      } else if (e.status === 'untracked' || e.status === 'added') {
        lines.push(...unifiedDiff('', after))
      } else {
        lines.push(...unifiedDiff(typeof before === 'string' ? before : '', after))
      }
      lines.push('')
    }
  }

  if (lines.length === 0) lines.push('(no differences)')
  return { ok: true, lines, state }
}

function unifiedDiff(a: string, b: string): string[] {
  const al = a.split('\n')
  const bl = b.split('\n')
  const out: string[] = ['--- a', '+++ b']
  const max = Math.max(al.length, bl.length)
  // Simple line-by-line (not full LCS) for Phase 1
  for (let i = 0; i < max; i++) {
    const L = al[i]
    const R = bl[i]
    if (L === R) {
      if (L !== undefined) out.push(' ' + L)
    } else {
      if (L !== undefined) out.push('-' + L)
      if (R !== undefined) out.push('+' + R)
    }
  }
  if (out.length > 40) {
    return [...out.slice(0, 40), `... (${out.length - 40} more lines truncated)`]
  }
  return out
}

function cmdBranch(state: LocalGitState, args: string[], ctx: GitExecContext): GitExecResult {
  const ensured = ensureInit(state, ctx)
  state = ensured.state
  if (args.length === 0) {
    const lines = state.branches.map((b) => {
      const mark = b.name === state.branch ? '*' : ' '
      return `${mark} ${b.name}`
    })
    return { ok: true, lines: [...ensured.lines, ...lines], state }
  }
  const name = args[0]
  if (state.branches.some((b) => b.name === name)) {
    return { ok: false, lines: [`branch '${name}' already exists`], state }
  }
  const next: LocalGitState = {
    ...state,
    branches: [...state.branches, { name, tip: state.head || '' }]
  }
  saveLocalGit(ctx.roomId, next)
  return { ok: true, lines: [...ensured.lines, `Created branch ${name}`], state: next }
}

function cmdSwitch(
  state: LocalGitState,
  working: Record<string, string>,
  args: string[],
  ctx: GitExecContext
): GitExecResult {
  if (!state.initialized) {
    return { ok: false, lines: ['Not a repository. Run git init first.'], state }
  }
  if (args[0] === '-c' && args[1]) {
    const created = cmdBranch(state, [args[1]], ctx)
    if (!created.ok) return created
    state = created.state
    args = [args[1]]
  }
  const name = args[0]
  if (!name) {
    return { ok: false, lines: ['usage: git switch <branch>'], state }
  }
  const branch = state.branches.find((b) => b.name === name)
  if (!branch) {
    return { ok: false, lines: [`branch '${name}' not found. Create with: git branch ${name}`], state }
  }
  // Phase 1: switch HEAD pointer; working tree stays (collaborative). Warn if dirty.
  const status = computeStatus(state, working)
  const dirty = status.length > 0
  const next: LocalGitState = {
    ...state,
    branch: name,
    head: branch.tip || null,
    index: {}
  }
  saveLocalGit(ctx.roomId, next)
  return {
    ok: true,
    lines: [
      `Switched to branch '${name}'`,
      dirty
        ? 'Note: Phase 1 keeps the collaborative working tree; uncommitted changes remain visible.'
        : ''
    ].filter(Boolean),
    state: next
  }
}

function tokenize(input: string): string[] {
  const tokens: string[] = []
  let cur = ''
  let quote: '"' | "'" | null = null
  for (let i = 0; i < input.length; i++) {
    const ch = input[i]
    if (quote) {
      if (ch === quote) {
        quote = null
      } else {
        cur += ch
      }
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      continue
    }
    if (ch === ' ' || ch === '\t') {
      if (cur) {
        tokens.push(cur)
        cur = ''
      }
      continue
    }
    cur += ch
  }
  if (cur) tokens.push(cur)
  return tokens
}

/** Autocomplete suggestions for the Git dropdown / terminal. */
export function gitAutocomplete(
  partial: string,
  filePaths: string[],
  branches: string[]
): string[] {
  const p = partial.trim()
  const lower = p.toLowerCase()
  const commands = [
    'git status',
    'git add .',
    'git add ',
    'git commit -m ""',
    'git log --oneline',
    'git diff',
    'git diff --staged',
    'git branch',
    'git switch ',
    'git restore ',
    'git restore --staged ',
    'git init',
    'git help'
  ]

  if (!p || p === 'g' || p === 'gi' || p === 'git') {
    return commands
  }

  if (lower.startsWith('git add ') || lower === 'git add') {
    const prefix = p.endsWith(' ') ? p : 'git add '
    return [
      prefix + '.',
      ...filePaths.slice(0, 30).map((f) => prefix + f)
    ]
  }

  if (lower.startsWith('git restore ') || lower.startsWith('git restore --staged ')) {
    const base = lower.includes('--staged') ? 'git restore --staged ' : 'git restore '
    return filePaths.slice(0, 30).map((f) => base + f)
  }

  if (lower.startsWith('git switch ') || lower === 'git switch') {
    const prefix = 'git switch '
    return branches.map((b) => prefix + b)
  }

  if (lower.startsWith('git branch ') || lower === 'git branch') {
    return ['git branch', 'git branch feature/']
  }

  if (lower.startsWith('git commit')) {
    return ['git commit -m ""']
  }

  return commands.filter((c) => c.toLowerCase().startsWith(lower) || c.toLowerCase().includes(lower))
}

export function getBranchNames(state: LocalGitState): string[] {
  return state.branches.map((b) => b.name)
}
