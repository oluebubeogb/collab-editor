# Phase 1 — Terminal + Local Git

## What's included

1. **Terminal tab** (between Console and Changes)
   - Interactive `$` prompt
   - Command history (↑↓)
   - Git autocomplete (Tab / click suggestions)

2. **Git dropdown** in the bottom bar
   - Status, Stage all, Commit…, Log, Diff, Init, Help

3. **Changes tab**
   - Live staged / unstaged / untracked list
   - Branch name + short HEAD

4. **Local Git engine** (`client/src/lib/localGit.ts`)
   - Room files = working tree
   - State persisted in `localStorage` key `collab-editor-local-git:<roomId>`
   - No server process required

## Supported commands

```
git init
git status
git add . | git add <path>
git commit -m "message"
git log [--oneline]
git diff [--staged]
git branch [name]
git switch <branch>
git restore <path>
git restore --staged <path>
git reset HEAD <path>
git help
```

Remote commands (`push`, `pull`, `fetch`, `clone`, `remote`) reply with a Phase 2 notice.

## Try it

1. Open a room and edit a file
2. Open **Terminal** tab → `git init`
3. `git status` → see untracked / modified files
4. `git add .` then `git commit -m "first"`
5. Switch to **Changes** tab to confirm clean tree
6. Use the **Git** dropdown for one-click actions

## Files touched

- `client/src/lib/localGit.ts` (new)
- `client/src/components/BottomConsole.tsx` (Console | Terminal | Changes + Git menu)
- `client/src/pages/Room.tsx` (wire working tree, restore, status)
- `README.md`, `client/package.json` version bump

## Phase 2 (not in this zip)

- GitHub OAuth / PAT
- Real `git push` / `pull` / PR creation
- Conflict UI
- Server-side isomorphic-git or sandboxed `git` binary
