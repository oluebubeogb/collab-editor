# Phase 2 — GitHub remote + PR workflow

Builds on Phase 1 (local Git + Terminal).

## Features

1. **Connect GitHub** (Personal Access Token, browser-local)
2. **Link repository** per room (`owner/repo` + default branch)
3. **`git pull`** — fetch tree from GitHub into the room (merge with conflict markers)
4. **`git push -m "msg"`** — push room working tree to the linked branch
5. **`git pr create`** — push head branch + open a Pull Request
6. **`git remote -v`** / **`git branch -r`**
7. Git menu entries + Changes tab shows linked remote

## Token setup

1. GitHub → Settings → Developer settings → Personal access tokens  
2. Classic: enable **`repo`**  
   Fine-grained: **Contents** (read/write) + **Pull requests** (read/write)
3. In the editor: **Git → Connect GitHub…** → paste token → link `owner/repo`

Token is stored only in this browser (`localStorage`). It is never sent to the collab-editor server.

## Commands

```text
# Phase 1 (local)
git init | status | add | commit | log | diff | branch | switch | restore

# Phase 2 (GitHub)
git remote -v
git branch -r
git pull
git push -m "message"
git pr create
```

## Typical flow

1. Connect GitHub + link `yourname/your-repo`  
2. `git pull` — load remote files into the room  
3. Edit collaboratively  
4. `git add .` && `git commit -m "wip"` (local history)  
5. `git push -m "Sync from collab room"`  
6. Optional: `git branch feature/x` → `git switch feature/x` → edit → `git pr create`

## Conflicts on pull

If a room file differs from GitHub, pull writes:

```text
<<<<<<< LOCAL (room)
…room content…
=======
…github content…
>>>>>>> GITHUB
```

Resolve in the editor, then push.

## Files added / updated

| Path | Role |
|------|------|
| `client/src/lib/github.ts` | GitHub REST (auth, tree, push, PR) |
| `client/src/lib/localGit.ts` | Phase 1 engine + Phase 2 help/autocomplete |
| `client/src/components/GitHubConnectModal.tsx` | Token + repo link UI |
| `client/src/components/BottomConsole.tsx` | Pull/Push/PR menu + remote label |
| `client/src/pages/Room.tsx` | Wire remote commands + modal |

## Limits (honest)

- Text files only (binaries skipped on pull; push sends current text tree)
- Push uses Git Data API (creates a commit on the target branch)
- No full `git merge` / rebase machinery yet
- Token is per-browser, not per-account on the server
- Rate limits apply (GitHub API)

## Security notes

- Prefer a fine-grained token limited to one repository  
- Sign out from the Connect modal when done on a shared machine  
- Never commit tokens into the room files
