import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels'
import Editor, { EditorHandle } from '../components/Editor'
import Preview from '../components/Preview'
import FileExplorer, { FileEntry } from '../components/FileExplorer'
import Tabs from '../components/Tabs'
import ChatPanel from '../components/ChatPanel'
import SnapshotsPanel from '../components/SnapshotsPanel'
import AuthModal from '../components/AuthModal'
import PasswordInput from '../components/PasswordInput'
import IconRail, { type RailPanel } from '../components/IconRail'
import TopBar from '../components/TopBar'
import SidebarExtras from '../components/SidebarExtras'
import BottomConsole, { type ConsoleLine } from '../components/BottomConsole'
import { useYjs } from '../hooks/useYjs'
import { useVoice } from '../hooks/useVoice'
import { useAuth } from '../hooks/useAuth'
import { randomDisplayName, randomColor } from '../lib/id'
import { getFileName, isTextFile } from '../lib/fileTypes'
import { downloadFile, exportRoomAsZip } from '../lib/export'
import { copyToClipboard } from '../lib/clipboard'
import {
  ChatMessage,
  CHAT_EDITORS,
  CHAT_GENERAL,
  channelFromTab,
  isChatTab,
  tabFromChannel,
  dmChannelId,
  isDmChannel
} from '../lib/chat'
import { getRememberedPassword, rememberRoomPassword } from '../lib/roomSecrets'
import {
  getRoomMeta,
  postActivity,
  setRoomDescription as apiSetRoomDescription,
  touchRoom,
  saveRoomAccess,
  getRoomAccess,
  inviteEditor,
  rotateRoomSecrets,
  fetchActivity,
  type ActivityEntry,
  type SnapshotPayload
} from '../lib/api'
import SearchPanel from '../components/SearchPanel'
import CommentsPanel from '../components/CommentsPanel'
import {
  loadRoomTabs,
  saveRoomTabs,
  loadUserPrefs,
  saveUserPrefs,
  loadVoiceRejoin,
  saveVoiceRejoin,
  ROOM_TEMPLATES,
  type LineComment
} from '../lib/workspace'
import { nanoid } from '../lib/id'

const DEFAULT_FILES: Record<string, string> = {
  'index.html': `<!DOCTYPE html>
<html>
  <head>
    <link rel="stylesheet" href="style.css">
  </head>
  <body>
    <h1>Hello, collaborators!</h1>
    <p>Edit any file in the explorer. Link CSS/JS/other pages with normal relative paths.</p>
    <script src="script.js"></script>
  </body>
</html>`,
  'style.css': `body { font-family: sans-serif; padding: 24px; }`,
  'script.js': `console.log('ready')`
}

const SESSION_KEY = 'collab-editor-session'
const CHAT_SEEN_KEY = 'collab-editor-chat-seen'

function loadSession(roomId: string): { name: string; pwd?: string } | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY)
    if (!raw) return null
    const data = JSON.parse(raw) as Record<string, { name: string; pwd?: string }>
    return data[roomId] || null
  } catch {
    return null
  }
}

function saveSession(roomId: string, name: string, pwd?: string) {
  try {
    const raw = localStorage.getItem(SESSION_KEY)
    const data = raw ? JSON.parse(raw) : {}
    data[roomId] = { name, pwd: pwd || data[roomId]?.pwd, ts: Date.now() }
    localStorage.setItem(SESSION_KEY, JSON.stringify(data))
  } catch {
    // ignore
  }
}

function loadChatSeen(roomId: string): {
  general: number
  editors: number
  dms: Record<string, number>
} {
  try {
    const raw = localStorage.getItem(CHAT_SEEN_KEY)
    if (!raw) return { general: 0, editors: 0, dms: {} }
    const data = JSON.parse(raw) as Record<
      string,
      { general?: number; editors?: number; dms?: Record<string, number> }
    >
    const e = data[roomId]
    return { general: e?.general || 0, editors: e?.editors || 0, dms: e?.dms || {} }
  } catch {
    return { general: 0, editors: 0, dms: {} }
  }
}

function saveChatSeen(
  roomId: string,
  general: number,
  editors: number,
  dms: Record<string, number> = {}
) {
  try {
    const raw = localStorage.getItem(CHAT_SEEN_KEY)
    const data = raw ? JSON.parse(raw) : {}
    data[roomId] = { general, editors, dms }
    localStorage.setItem(CHAT_SEEN_KEY, JSON.stringify(data))
  } catch {
    // ignore
  }
}

/** Three short beeps for a new message notification. */
function beepMessageAlert() {
  try {
    const ctx = new AudioContext()
    const now = ctx.currentTime
    ;[0, 0.14, 0.28].forEach((offset) => {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.value = 920
      gain.gain.setValueAtTime(0.0001, now + offset)
      gain.gain.exponentialRampToValueAtTime(0.1, now + offset + 0.015)
      gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.1)
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.start(now + offset)
      osc.stop(now + offset + 0.12)
    })
    window.setTimeout(() => void ctx.close().catch(() => {}), 800)
  } catch {
    /* ignore */
  }
}

function formatSynced(ts: number | null): string {
  if (!ts) return 'never'
  const sec = Math.floor((Date.now() - ts) / 1000)
  if (sec < 5) return 'just now'
  if (sec < 60) return `${sec}s ago`
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`
  return new Date(ts).toLocaleTimeString()
}

export default function Room() {
  const { roomId = '' } = useParams()
  const [searchParams] = useSearchParams()
  const { user } = useAuth()
  const requiredPwd = searchParams.get('pwd') || ''
  const viewKey = searchParams.get('view') || ''
  const urlReadonly =
    (!!viewKey && !requiredPwd) ||
    (searchParams.get('readonly') === '1' && !!viewKey)
  const [joinReadonly, setJoinReadonly] = useState(false)
  const isReadonly = urlReadonly || joinReadonly

  const saved = loadSession(roomId)
  const [joined, setJoined] = useState(false)
  const [displayName, setDisplayName] = useState(
    () => user?.displayName || saved?.name || ''
  )
  const [sessionPwd, setSessionPwd] = useState(() => {
    const remembered = user?.id ? getRememberedPassword(user.id, roomId) : ''
    return requiredPwd || saved?.pwd || remembered || ''
  })
  const [roomDescription, setRoomDescription] = useState('')
  const [descDraft, setDescDraft] = useState('')
  const [editingDesc, setEditingDesc] = useState(false)
  const [isPublic, setIsPublic] = useState(false)
  const [showAuth, setShowAuth] = useState(false)
  const [showSnapshots, setShowSnapshots] = useState(false)
  const [followingClientId, setFollowingClientId] = useState<number | null>(null)

  // Prefer account display name when signed in
  useEffect(() => {
    if (user?.displayName && !displayName) {
      setDisplayName(user.displayName)
    }
  }, [user, displayName])

  const prefs = loadUserPrefs()
  const stickyColor = user?.color || prefs.color || randomColor()
  const userAwareness = useMemo(
    () => ({ name: displayName || randomDisplayName(), color: stickyColor }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [displayName, stickyColor]
  )

  useEffect(() => {
    saveUserPrefs({ color: stickyColor, displayName: displayName || undefined })
    if (user && stickyColor && user.color !== stickyColor) {
      // best-effort persist color on account
    }
  }, [stickyColor, displayName, user])

  const {
    doc,
    provider,
    status,
    users,
    filesMeta,
    fileTexts,
    fileBinaries,
    createFolder,
    createFile,
    uploadFile,
    deletePath,
    renamePath,
    getOrCreateText,
    getRoomViewKey,
    setRoomDescriptionLocal,
    getChatArray,
    sendChatMessage,
    restoreSnapshotPayload,
    buildSnapshotPayload,
    getCommentsArray,
    setEditingPath,
    toggleChatPin,
    readonly,
    ready,
    synced,
    idbSynced,
    lastSyncedAt,
    wsUrl
  } = useYjs(roomId, userAwareness, sessionPwd, viewKey, isReadonly, joined)

  const voice = useVoice({
    doc,
    provider,
    enabled: joined && ready,
    readonly,
    localName: userAwareness.name,
    localColor: userAwareness.color
  })

  const [entries, setEntries] = useState<FileEntry[]>([])
  const [texts, setTexts] = useState<Record<string, string>>({})
  const [binaries, setBinaries] = useState<Record<string, string>>({})
  const restoredTabs = loadRoomTabs(roomId)
  const [openTabs, setOpenTabs] = useState<string[]>(() => restoredTabs?.openTabs || [])
  const [activeTab, setActiveTab] = useState<string | null>(() => restoredTabs?.activeTab || null)
  const [previewEntryPath, setPreviewEntryPath] = useState<string | null>(
    () => restoredTabs?.previewEntryPath || null
  )
  const [wordWrap, setWordWrap] = useState<'on' | 'off'>(() => restoredTabs?.wordWrap || 'off')
  const [showSearch, setShowSearch] = useState(false)
  const [showComments, setShowComments] = useState(false)
  const [explorerOpen, setExplorerOpen] = useState(true)
  const [railPanel, setRailPanel] = useState<RailPanel>('files')
  const [consoleCollapsed, setConsoleCollapsed] = useState(false)
  const [editorConsole, setEditorConsole] = useState<ConsoleLine[]>([
    { level: 'success', text: 'Workspace ready — all changes are live when connected.' }
  ])
  const [activity, setActivity] = useState<ActivityEntry[]>([])
  const [shareOpen, setShareOpen] = useState(false)
  const [filesTouched, setFilesTouched] = useState(0)
  const [comments, setComments] = useState<LineComment[]>([])
  const [pendingReveal, setPendingReveal] = useState<{ path: string; line: number } | null>(null)
  const [exportOpen, setExportOpen] = useState(false)
  const [generalMessages, setGeneralMessages] = useState<ChatMessage[]>([])
  const [editorsMessages, setEditorsMessages] = useState<ChatMessage[]>([])
  const [dmMessages, setDmMessages] = useState<Record<string, ChatMessage[]>>({})
  const chatSeenInit = useRef(loadChatSeen(roomId))
  const [generalSeen, setGeneralSeen] = useState(chatSeenInit.current.general)
  const [editorsSeen, setEditorsSeen] = useState(chatSeenInit.current.editors)
  const [dmSeen, setDmSeen] = useState<Record<string, number>>(() => chatSeenInit.current.dms || {})
  const prevUnreadRef = useRef(0)
  /** Channel key(s) the user declined; hide banner until that call ends */
  const [dismissedIncoming, setDismissedIncoming] = useState<string | null>(null)
  const [inviteUsername, setInviteUsername] = useState('')
  const [inviteStatus, setInviteStatus] = useState('')
  const [inviteBusy, setInviteBusy] = useState(false)
  const [showUnlock, setShowUnlock] = useState(false)
  const [unlockPwd, setUnlockPwd] = useState('')
  const [unlockError, setUnlockError] = useState('')
  const [unlockBusy, setUnlockBusy] = useState(false)
  const editorHandleRef = useRef<EditorHandle>(null)
  const [, setTick] = useState(0)

  // Refresh "last synced" label periodically
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 5000)
    return () => clearInterval(id)
  }, [])

  // Load room description / visibility from API + Yjs + session fallback (create flow)
  useEffect(() => {
    try {
      const cached = sessionStorage.getItem(`collab-desc:${roomId}`)
      if (cached) {
        setRoomDescription(cached)
        setDescDraft(cached)
      }
      const pub = sessionStorage.getItem(`collab-public:${roomId}`)
      if (pub != null) setIsPublic(pub === '1')
    } catch {
      /* ignore */
    }
    getRoomMeta(roomId).then((r) => {
      if (r.room?.description) {
        setRoomDescription(r.room.description)
        setDescDraft(r.room.description)
      }
      if (r.room && r.room.isPublic != null) setIsPublic(!!r.room.isPublic)
    })
  }, [roomId])

  useEffect(() => {
    if (!joined || !ready || !doc) return
    const meta = doc.getMap('roomMeta')
    // Seed description from create-flow cache if Yjs is empty
    try {
      const cached = sessionStorage.getItem(`collab-desc:${roomId}`)
      if (cached && !meta.get('description')) {
        meta.set('description', cached.slice(0, 50))
        sessionStorage.removeItem(`collab-desc:${roomId}`)
      }
    } catch {
      /* ignore */
    }
    const syncDesc = () => {
      const d = String(meta.get('description') || '')
      if (d) {
        setRoomDescription(d)
        if (!editingDesc) setDescDraft(d)
      }
    }
    syncDesc()
    meta.observe(syncDesc)
    return () => meta.unobserve(syncDesc)
  }, [joined, ready, doc, editingDesc, roomId])

  // Persist chat unread across reconnect
  useEffect(() => {
    saveChatSeen(roomId, generalSeen, editorsSeen, dmSeen)
  }, [roomId, generalSeen, editorsSeen, dmSeen])

  // Persist editor tabs across reboot (localStorage / IndexedDB-adjacent)
  useEffect(() => {
    if (!joined) return
    saveRoomTabs(roomId, { openTabs, activeTab, previewEntryPath, wordWrap })
  }, [joined, roomId, openTabs, activeTab, previewEntryPath, wordWrap])

  // Soft file lock
  useEffect(() => {
    if (!joined || !ready) return
    const path = activeTab && !isChatTab(activeTab) ? activeTab : null
    setEditingPath(path)
  }, [joined, ready, activeTab, setEditingPath])

  // Touch recent room when signed in
  useEffect(() => {
    if (joined && user) void touchRoom(roomId)
  }, [joined, user, roomId])

  useEffect(() => {
    if (!joined) return
    fetchActivity(roomId).then((r) => {
      if (r.activity) setActivity(r.activity)
    })
    const id = window.setInterval(() => {
      fetchActivity(roomId).then((r) => {
        if (r.activity) setActivity(r.activity)
      })
    }, 15000)
    return () => window.clearInterval(id)
  }, [joined, roomId])

  // Comments from Yjs
  useEffect(() => {
    if (!joined || !ready) return
    const arr = getCommentsArray()
    if (!arr) return
    const sync = () => {
      setComments(arr.toArray() as unknown as LineComment[])
    }
    sync()
    arr.observe(sync)
    return () => arr.unobserve(sync)
  }, [joined, ready, getCommentsArray])

  // Ctrl+Shift+F search
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'f') {
        e.preventDefault()
        setShowSearch(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Voice rejoin after disconnect
  useEffect(() => {
    if (!joined || !ready || voice.channel) return
    const last = loadVoiceRejoin(roomId)
    if (!last) return
    if (last === 'editors' && readonly) return
    // soft prompt once
    const key = `collab-rejoin-asked:${roomId}`
    if (sessionStorage.getItem(key)) return
    sessionStorage.setItem(key, '1')
    if (window.confirm(`Rejoin ${last} voice call?`)) {
      void voice.join(last)
    }
  }, [joined, ready]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    saveVoiceRejoin(roomId, voice.channel)
  }, [roomId, voice.channel])

  useEffect(() => {
    if (!joined || !ready) return

    const meta = filesMeta()
    const texts_ = fileTexts()
    const binaries_ = fileBinaries()

    const syncEntries = () => {
      setEntries(Array.from(meta.entries()).map(([path, m]) => ({ path, meta: m })))
    }
    const syncTexts = () => {
      const snapshot: Record<string, string> = {}
      texts_.forEach((yText, path) => {
        snapshot[path] = yText.toString()
      })
      setTexts(snapshot)
    }
    const syncBinaries = () => {
      const snapshot: Record<string, string> = {}
      binaries_.forEach((val, path) => {
        snapshot[path] = val
      })
      setBinaries(snapshot)
    }

    syncEntries()
    syncTexts()
    syncBinaries()

    meta.observeDeep(syncEntries)
    texts_.observeDeep(syncTexts)
    binaries_.observeDeep(syncBinaries)

    return () => {
      meta.unobserveDeep(syncEntries)
      texts_.unobserveDeep(syncTexts)
      binaries_.unobserveDeep(syncBinaries)
    }
  }, [joined, ready, filesMeta, fileTexts, fileBinaries])

  useEffect(() => {
    if (!joined || !ready) return
    const general = getChatArray('general')
    if (!general) return

    const syncGeneral = () => {
      setGeneralMessages(general.toArray() as unknown as ChatMessage[])
    }
    syncGeneral()
    general.observe(syncGeneral)

    let editors = null as ReturnType<typeof getChatArray>
    let syncEditors: (() => void) | null = null
    if (!readonly) {
      editors = getChatArray('editors')
      if (editors) {
        syncEditors = () => {
          setEditorsMessages(editors!.toArray() as unknown as ChatMessage[])
        }
        syncEditors()
        editors.observe(syncEditors)
      }
    } else {
      setEditorsMessages([])
    }

    return () => {
      general.unobserve(syncGeneral)
      if (editors && syncEditors) editors.unobserve(syncEditors)
    }
  }, [joined, ready, getChatArray, readonly])

  // Sync DM channels for online peers (+ active DM tab)
  useEffect(() => {
    if (!joined || !ready) return
    const channels = new Set<string>()
    for (const u of users) {
      if (u.clientId === provider?.awareness?.clientID) continue
      channels.add(dmChannelId(userAwareness.name, u.name))
    }
    if (activeTab && isChatTab(activeTab)) {
      const ch = channelFromTab(activeTab)
      if (ch && isDmChannel(ch)) channels.add(ch)
    }
    if (channels.size === 0) return
    const unsubs: Array<() => void> = []
    channels.forEach((ch) => {
      const arr = getChatArray(ch)
      if (!arr) return
      const sync = () => {
        setDmMessages((prev) => ({ ...prev, [ch]: arr.toArray() as unknown as ChatMessage[] }))
      }
      sync()
      arr.observe(sync)
      unsubs.push(() => arr.unobserve(sync))
    })
    return () => unsubs.forEach((fn) => fn())
  }, [joined, ready, users, activeTab, getChatArray, userAwareness.name, provider])

  useEffect(() => {
    // Wait for both websocket sync AND local IndexedDB restore so we never
    // seed defaults over (or before) persisted room content — especially HTML.
    if (!joined || !ready || !synced || !idbSynced || readonly) return
    const meta = filesMeta()
    const texts = fileTexts()
    if (meta.size > 0 || texts.size > 0) return
    let files: Record<string, string> = DEFAULT_FILES
    try {
      const tid = sessionStorage.getItem(`collab-template:${roomId}`)
      if (tid) {
        const tpl = ROOM_TEMPLATES.find((t) => t.id === tid)
        if (tpl) files = { ...tpl.files }
        sessionStorage.removeItem(`collab-template:${roomId}`)
      }
    } catch {
      /* ignore */
    }
    Object.entries(files).forEach(([path, content]) => {
      createFile(path, content)
    })
    const first = Object.keys(files)[0]
    if (first && openTabs.length === 0) {
      setOpenTabs([first])
      setActiveTab(first)
      setPreviewEntryPath(first)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [joined, ready, synced, idbSynced])

  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (e.data && e.data.type === 'vfs-navigate' && typeof e.data.path === 'string') {
        setPreviewEntryPath(e.data.path)
      }
    }
    window.addEventListener('message', handler)
    return () => window.removeEventListener('message', handler)
  }, [])

  // Follow mode: open the followed user's current file path from awareness cursor
  useEffect(() => {
    if (followingClientId == null) return
    const target = users.find((u) => u.clientId === followingClientId)
    const path = target?.cursor?.path
    if (path && isTextFile(path)) {
      setOpenTabs((prev) => (prev.includes(path) ? prev : [...prev, path]))
      setActiveTab(path)
    }
  }, [followingClientId, users])

  const applyPathChanges = useCallback((changes: { from: string; to: string }[]) => {
    if (changes.length === 0) return

    const mapPath = (p: string | null): string | null => {
      if (!p) return p
      for (const { from, to } of changes) {
        if (p === from) return to
        if (p.startsWith(from + '/')) return to + p.slice(from.length)
      }
      return p
    }

    setOpenTabs((prev) => prev.map((p) => mapPath(p) || p))
    setActiveTab((prev) => mapPath(prev))
    setPreviewEntryPath((prev) => mapPath(prev))
  }, [])

  const openFile = useCallback(
    (path: string) => {
      const meta = filesMeta().get(path)
      if (!meta || meta.type !== 'file') return
      if (meta.binary) {
        window.alert(
          `"${path}" is a binary file and can't be opened in the text editor, but you can reference it from HTML/CSS (e.g. <img src="${path}">).`
        )
        return
      }
      setOpenTabs((prev) => (prev.includes(path) ? prev : [...prev, path]))
      setActiveTab(path)
      // Publish cursor path for follow mode
      if (provider) {
        provider.awareness.setLocalStateField('cursor', { path })
      }
    },
    [filesMeta, provider]
  )

  const openChat = useCallback(
    (channel: string) => {
      if (channel === 'editors' && readonly) return
      const path = tabFromChannel(channel)
      setOpenTabs((prev) => (prev.includes(path) ? prev : [...prev, path]))
      setActiveTab(path)
      if (channel === 'general') setGeneralSeen(generalMessages.length)
      else if (channel === 'editors') setEditorsSeen(editorsMessages.length)
    },
    [readonly, generalMessages.length, editorsMessages.length]
  )

  const openDm = useCallback(
    (peerName: string) => {
      const ch = dmChannelId(userAwareness.name, peerName)
      openChat(ch)
      const msgs = dmMessages[ch] || []
      setDmSeen((prev) => ({ ...prev, [ch]: msgs.length }))
    },
    [userAwareness.name, openChat, dmMessages]
  )

  useEffect(() => {
    if (activeTab === CHAT_GENERAL) setGeneralSeen(generalMessages.length)
    if (activeTab === CHAT_EDITORS) setEditorsSeen(editorsMessages.length)
    if (activeTab && isChatTab(activeTab)) {
      const ch = channelFromTab(activeTab)
      if (ch && isDmChannel(ch)) {
        const n = (dmMessages[ch] || []).length
        setDmSeen((prev) => (prev[ch] === n ? prev : { ...prev, [ch]: n }))
      }
    }
  }, [activeTab, generalMessages.length, editorsMessages.length, dmMessages])

  useEffect(() => {
    if (!readonly) return
    setOpenTabs((prev) => prev.filter((p) => p !== CHAT_EDITORS))
    setActiveTab((prev) => (prev === CHAT_EDITORS ? null : prev))
  }, [readonly])

  const closeTab = useCallback(
    (path: string) => {
      setOpenTabs((prev) => {
        const next = prev.filter((p) => p !== path)
        if (activeTab === path) {
          setActiveTab(next.length > 0 ? next[next.length - 1] : null)
        }
        return next
      })
    },
    [activeTab]
  )

  const handleCreateFile = useCallback(
    (parentFolder: string | null) => {
      if (readonly) return
      const name = window.prompt(
        parentFolder ? `New file name inside "${parentFolder}":` : 'New file name:',
        'untitled.html'
      )
      if (!name) return
      const path = parentFolder ? `${parentFolder}/${name}` : name
      if (filesMeta().has(path)) {
        window.alert('A file with that path already exists.')
        return
      }
      createFile(path)
      if (isTextFile(path)) openFile(path)
    },
    [filesMeta, createFile, openFile, readonly]
  )

  const handleCreateFolder = useCallback(
    (parentFolder: string | null) => {
      if (readonly) return
      const name = window.prompt(
        parentFolder ? `New folder name inside "${parentFolder}":` : 'New folder name:',
        'New Folder'
      )
      if (!name) return
      const path = parentFolder ? `${parentFolder}/${name}` : name
      if (filesMeta().has(path)) {
        window.alert('A folder with that path already exists.')
        return
      }
      createFolder(path)
    },
    [filesMeta, createFolder, readonly]
  )

  const handleUpload = useCallback(
    (parentFolder: string | null, fileList: FileList) => {
      if (readonly) return
      Array.from(fileList).forEach((file) => {
        const relative =
          (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name
        const path = parentFolder ? `${parentFolder}/${relative}` : relative
        // Ensure parent folders exist for nested uploads (folder select)
        const parts = path.split('/')
        if (parts.length > 1) {
          let current = ''
          for (let i = 0; i < parts.length - 1; i++) {
            current = current ? `${current}/${parts[i]}` : parts[i]
            if (!filesMeta().has(current)) {
              createFolder(current)
            }
          }
        }
        uploadFile(path, file)
      })
    },
    [uploadFile, createFolder, filesMeta, readonly]
  )

  const handleDownload = useCallback(
    (path: string) => {
      downloadFile(path, fileTexts(), fileBinaries())
    },
    [fileTexts, fileBinaries]
  )

  const handleDelete = useCallback(
    (path: string) => {
      if (readonly) return
      deletePath(path)
      setOpenTabs((prev) => prev.filter((p) => p !== path && !p.startsWith(path + '/')))
      if (activeTab === path || activeTab?.startsWith(path + '/')) {
        setActiveTab(null)
      }
      if (previewEntryPath === path || previewEntryPath?.startsWith(path + '/')) {
        setPreviewEntryPath(null)
      }
      void postActivity(roomId, 'delete', path, userAwareness.name)
    },
    [deletePath, activeTab, previewEntryPath, readonly, roomId, userAwareness.name]
  )

  const handleRename = useCallback(
    (oldPath: string, newPath: string) => {
      if (readonly) return
      if (filesMeta().has(newPath)) {
        window.alert('A file or folder with that name already exists.')
        return
      }
      const changes = renamePath(oldPath, newPath)
      applyPathChanges(changes)
      void postActivity(roomId, 'rename', `${oldPath} → ${newPath}`, userAwareness.name)
    },
    [renamePath, applyPathChanges, filesMeta, readonly, roomId, userAwareness.name]
  )

  const handleMove = useCallback(
    (oldPath: string, newParentFolder: string | null) => {
      if (readonly) return
      if (newParentFolder === oldPath || newParentFolder?.startsWith(oldPath + '/')) {
        return
      }
      const name = getFileName(oldPath)
      const newPath = newParentFolder ? `${newParentFolder}/${name}` : name
      if (newPath === oldPath) return
      if (filesMeta().has(newPath)) {
        window.alert('A file or folder already exists at the destination.')
        return
      }
      const changes = renamePath(oldPath, newPath)
      applyPathChanges(changes)
    },
    [renamePath, applyPathChanges, filesMeta, readonly]
  )

  const saveDescription = async () => {
    const d = descDraft.trim().slice(0, 50)
    setRoomDescriptionLocal(d)
    setRoomDescription(d)
    setEditingDesc(false)
    await apiSetRoomDescription(roomId, d)
    try {
      const { setRoomVisibility } = await import('../lib/api')
      await setRoomVisibility(roomId, isPublic)
    } catch {
      /* ignore */
    }
    void postActivity(roomId, 'description', d, userAwareness.name)
  }

  const inviteLink = `${window.location.origin}/room/${roomId}?pwd=${sessionPwd || requiredPwd || saved?.pwd || ''}`

  const copyInvite = async () => {
    const result = await copyToClipboard(inviteLink)
    if (result === 'copied') {
      window.alert('Invite link copied to clipboard.')
    }
  }

  const copyReadonly = async () => {
    const key = getRoomViewKey()
    if (!key) {
      window.alert(
        'No view key for this room yet. Create a new room from the home page (it generates pwd + view), open that full link once as editor, then try again.'
      )
      return
    }
    const link = `${window.location.origin}/room/${roomId}?view=${key}`
    const result = await copyToClipboard(link)
    if (result === 'copied') {
      window.alert('Read-only link copied to clipboard.')
    }
  }

  const handleJoin = (name: string, opts: { readonly: boolean; password?: string }) => {
    setDisplayName(name)
    if (opts.readonly) {
      setJoinReadonly(true)
      setSessionPwd('')
      saveSession(roomId, name, undefined)
    } else {
      setJoinReadonly(false)
      const pwd = opts.password || requiredPwd || ''
      setSessionPwd(pwd)
      saveSession(roomId, name, pwd || undefined)
      if (user?.id && pwd) {
        rememberRoomPassword(user.id, roomId, pwd)
        void saveRoomAccess(roomId, { role: 'editor', roomPwd: pwd })
      }
    }
    setJoined(true)
    void postActivity(roomId, 'join', opts.readonly ? 'readonly' : undefined, name)
    if (user?.id) {
      void touchRoom(roomId)
    }
  }




  // Enter room immediately — no JoinModal.
  // Password from URL / autojoin / memory / server access → editor; otherwise read-only.
  useEffect(() => {
    if (joined) return
    let cancelled = false

    const enter = async () => {
      let name =
        displayName ||
        user?.displayName ||
        loadSession(roomId)?.name ||
        randomDisplayName()
      let pwd = (requiredPwd || sessionPwd || '').trim()
      let asReadonly = false

      try {
        const raw = sessionStorage.getItem(`collab-autojoin:${roomId}`)
        if (raw) {
          sessionStorage.removeItem(`collab-autojoin:${roomId}`)
          const data = JSON.parse(raw) as { readonly?: boolean; pwd?: string; name?: string }
          if (data.name?.trim()) name = data.name.trim()
          if (data.pwd?.trim()) pwd = data.pwd.trim()
          if (data.readonly) asReadonly = true
        }
      } catch {
        /* ignore */
      }

      if (!pwd && user?.id) {
        pwd = getRememberedPassword(user.id, roomId) || ''
      }

      if (user?.id) {
        try {
          const r = await getRoomAccess(roomId)
          if (cancelled) return
          if (r.isOwner) {
            pwd = pwd || r.access?.roomPwd || requiredPwd || ''
            asReadonly = !pwd
          } else if (r.access?.role === 'editor' && r.access.roomPwd) {
            pwd = pwd || r.access.roomPwd
            asReadonly = false
            if (r.access.isNew) {
              void import('../lib/api').then(({ markAccessSeen }) => markAccessSeen(roomId))
            }
          }
        } catch {
          /* ignore */
        }
      }

      if (!pwd) asReadonly = true

      if (cancelled) return
      setDisplayName(name)
      if (asReadonly) {
        setJoinReadonly(true)
        setSessionPwd('')
        saveSession(roomId, name, undefined)
      } else {
        setJoinReadonly(false)
        setSessionPwd(pwd)
        saveSession(roomId, name, pwd)
        if (user?.id && pwd) {
          rememberRoomPassword(user.id, roomId, pwd)
          void saveRoomAccess(roomId, { role: 'editor', roomPwd: pwd })
        }
      }
      setJoined(true)
      void postActivity(roomId, 'join', asReadonly ? 'readonly' : undefined, name)
      if (user?.id) void touchRoom(roomId)
    }

    void enter()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId, user?.id])

  const activeText =
    activeTab && ready && !isChatTab(activeTab) && activeTab !== '__invite__' && activeTab !== '__phone__' && activeTab !== '__messages__' && activeTab !== '__collaborators__' ? getOrCreateText(activeTab) : null
  const localClientId = provider?.awareness?.clientID

  const incomingCall = useMemo(() => {
    if (voice.channel) return null
    const localId = provider?.awareness?.clientID
    const myName = userAwareness.name.trim().toLowerCase()
    let found: { label: string; channel: string } | null = null
    for (const u of users) {
      if (u.clientId === localId || !u.voiceChannel) continue
      const ch = u.voiceChannel
      if (ch.startsWith('dm:')) {
        const pair = ch.slice(3).split('|').map((s) => s.trim().toLowerCase())
        if (pair.includes(myName)) {
          found = { label: u.name, channel: ch }
          break
        }
      }
    }
    if (!found) {
      for (const u of users) {
        if (u.clientId === localId || !u.voiceChannel) continue
        if (u.voiceChannel === 'general') {
          found = { label: `General · ${u.name}`, channel: 'general' }
          break
        }
        if (u.voiceChannel === 'editors' && !readonly) {
          found = { label: `Editors · ${u.name}`, channel: 'editors' }
          break
        }
      }
    }
    if (!found) return null
    if (dismissedIncoming && dismissedIncoming === found.channel) return null
    return found
  }, [voice.channel, users, provider, userAwareness.name, readonly, dismissedIncoming])

  // Clear decline flag once that remote call is no longer active
  useEffect(() => {
    if (!dismissedIncoming) return
    const stillRinging = users.some(
      (u) => u.clientId !== provider?.awareness?.clientID && u.voiceChannel === dismissedIncoming
    )
    if (!stillRinging) setDismissedIncoming(null)
  }, [users, dismissedIncoming, provider])

  const dmUnreadTotal = useMemo(() => {
    let n = 0
    for (const [ch, msgs] of Object.entries(dmMessages)) {
      const seen = dmSeen[ch] || 0
      n += Math.max(0, msgs.length - seen)
    }
    return n
  }, [dmMessages, dmSeen])

  const totalUnreadMessages = useMemo(() => {
    return (
      Math.max(0, generalMessages.length - generalSeen) +
      Math.max(0, editorsMessages.length - editorsSeen) +
      dmUnreadTotal
    )
  }, [generalMessages.length, generalSeen, editorsMessages.length, editorsSeen, dmUnreadTotal])

  // 3 beeps when total unread increases (new incoming message)
  useEffect(() => {
    if (!joined) {
      prevUnreadRef.current = totalUnreadMessages
      return
    }
    if (totalUnreadMessages > prevUnreadRef.current) {
      beepMessageAlert()
    }
    prevUnreadRef.current = totalUnreadMessages
  }, [totalUnreadMessages, joined])

  const unreadByPath = useMemo(() => {
    const map: Record<string, number> = {}
    const g = Math.max(0, generalMessages.length - generalSeen)
    const e = Math.max(0, editorsMessages.length - editorsSeen)
    if (g) map['__chat__/general'] = g
    if (e) map['__chat__/editors'] = e
    for (const [ch, msgs] of Object.entries(dmMessages)) {
      const u = Math.max(0, msgs.length - (dmSeen[ch] || 0))
      if (u) map[`__chat__/dm:${ch.slice(3)}`] = u
    }
    return map
  }, [generalMessages.length, generalSeen, editorsMessages.length, editorsSeen, dmMessages, dmSeen])

  if (!joined) {
    return (
      <div className="flex h-screen items-center justify-center text-sm text-ink-faint" style={{ background: 'var(--surface-0)' }}>
        Entering room…
      </div>
    )
  }

if (!ready) {
    return (
      <div className="h-screen flex flex-col items-center justify-center bg-neutral-900 text-neutral-400 text-sm gap-2">
        <div>Connecting to room…</div>
        <div className="w-48 h-1 bg-neutral-800 rounded overflow-hidden">
          <div className="h-full bg-blue-500 animate-pulse w-2/3" />
        </div>
        <div className="text-[11px] text-neutral-500">
          {wsUrl} · room/{roomId} · {status}
          {idbSynced ? ' · local cache ready' : ' · loading local cache'}
          {synced ? ' · synced' : ' · waiting for sync'}
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-screen flex-col" style={{ background: 'var(--surface-0)', color: 'var(--ink)' }}>
      <TopBar
        roomId={roomId}
        roomDescription={roomDescription}
        locked={!isReadonly && !!(requiredPwd || saved?.pwd)}
        isPublic={isPublic}
        readonly={readonly}
        onUnlockEditor={() => {
          setUnlockPwd('')
          setUnlockError('')
          setShowUnlock(true)
        }}
        users={users}
        status={status}
        followingClientId={followingClientId}
        localClientId={localClientId}
        onFollow={setFollowingClientId}
        onSearch={() => setShowSearch(true)}
        onShare={() => setShareOpen((v) => !v)}
        profileName={userAwareness.name}
        profileColor={userAwareness.color}
        onProfileClick={() => setShowAuth(!user)}
        onSaveMeta={(desc, pub) => {
          setDescDraft(desc)
          setIsPublic(pub)
          setRoomDescriptionLocal(desc)
          setRoomDescription(desc)
          void apiSetRoomDescription(roomId, desc)
          void import('../lib/api').then(({ setRoomVisibility }) => setRoomVisibility(roomId, pub))
          void postActivity(roomId, 'description', desc, userAwareness.name)
        }}
      />

      {shareOpen && (
        <div
          className="absolute right-4 top-12 z-30 w-56 rounded-xl border p-2 shadow-xl"
          style={{ background: 'var(--surface-1)', borderColor: 'var(--line)' }}
        >
          {!readonly && (
            <>
              <button type="button" className="w-full rounded-lg px-3 py-2 text-left text-xs hover:bg-[var(--surface-3)]" onClick={() => { void copyInvite(); setShareOpen(false) }}>
                Copy invite link
              </button>
              <button type="button" className="w-full rounded-lg px-3 py-2 text-left text-xs hover:bg-[var(--surface-3)]" onClick={() => { void copyReadonly(); setShareOpen(false) }}>
                Copy read-only link
              </button>
              <button
                type="button"
                className="w-full rounded-lg px-3 py-2 text-left text-xs hover:bg-[var(--surface-3)]"
                onClick={async () => {
                  const key = getRoomViewKey()
                  if (!key) return window.alert('No view key yet.')
                  const link = `${window.location.origin}/preview/${roomId}?view=${key}&entry=${encodeURIComponent(previewEntryPath || 'index.html')}`
                  await copyToClipboard(link)
                  setShareOpen(false)
                }}
              >
                Copy preview link
              </button>
            </>
          )}
          <button type="button" className="w-full rounded-lg px-3 py-2 text-left text-xs hover:bg-[var(--surface-3)]" onClick={() => { setShowSnapshots(true); setShareOpen(false) }}>
            Snapshots & activity
          </button>
          <button type="button" className="w-full rounded-lg px-3 py-2 text-left text-xs hover:bg-[var(--surface-3)]" onClick={() => { setShowComments(true); setShareOpen(false) }}>
            Comments
          </button>
          <button
            type="button"
            className="w-full rounded-lg px-3 py-2 text-left text-xs hover:bg-[var(--surface-3)]"
            onClick={() => {
              void exportRoomAsZip(entries, fileTexts(), fileBinaries(), roomId)
              setShareOpen(false)
            }}
          >
            Export ZIP
          </button>
        </div>
      )}

      {status !== 'connected' && (
        <div className="flex items-center gap-3 border-b px-4 py-1.5 text-xs text-amber-200" style={{ background: 'rgba(245,158,11,0.12)', borderColor: 'rgba(245,158,11,0.25)' }}>
          <div className="flex-1 min-w-0">
            {status === 'connecting' ? 'Reconnecting…' : 'Disconnected — retrying…'}
            {' · last synced '}{formatSynced(lastSyncedAt)}
          </div>
          <div className="h-1 w-24 overflow-hidden rounded bg-amber-900/40 shrink-0">
            <div className="h-full w-1/2 animate-pulse bg-amber-400" />
          </div>
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <IconRail
          active={railPanel}
          showInvite={!!user && !readonly}
          onOpenInvite={() => {
            setRailPanel('invite')
            setExplorerOpen(true)
            const path = '__invite__'
            setOpenTabs((prev) => (prev.includes(path) ? prev : [...prev, path]))
            setActiveTab(path)
          }}
          explorerOpen={explorerOpen}
          onToggleExplorer={() => setExplorerOpen((v) => !v)}
          onSelect={setRailPanel}
          onOpenSearch={() => setShowSearch(true)}
          onOpenChat={() => {
            setRailPanel('chat')
            const path = '__messages__'
            setOpenTabs((prev) => (prev.includes(path) ? prev : [...prev, path]))
            setActiveTab(path)
          }}
          onOpenVoice={() => {
            setRailPanel('voice')
            const path = '__phone__'
            setOpenTabs((prev) => (prev.includes(path) ? prev : [...prev, path]))
            setActiveTab(path)
          }}
          onOpenCollaborators={() => {
            const path = '__collaborators__'
            setOpenTabs((prev) => (prev.includes(path) ? prev : [...prev, path]))
            setActiveTab(path)
          }}
          onOpenSettings={() => setShowSnapshots(true)}
          unreadMessages={totalUnreadMessages}
        />

        {/* Collapsible explorer + activity column */}
        <div
          className="flex shrink-0 flex-col overflow-hidden border-r transition-all duration-[220ms] ease-out"
          style={{
            width: explorerOpen ? 240 : 0,
            opacity: explorerOpen ? 1 : 0,
            borderColor: 'var(--line)',
            background: 'var(--surface-1)'
          }}
        >
          <div className="min-h-0 flex-1 overflow-hidden" style={{ width: 240 }}>
            <FileExplorer
              entries={entries}
              activePath={activeTab}
              previewEntryPath={previewEntryPath}
              readonly={readonly}
              generalUnread={Math.max(0, generalMessages.length - generalSeen)}
              editorsUnread={Math.max(0, editorsMessages.length - editorsSeen)}
              voiceChannel={voice.channel}
              voiceJoining={voice.joining}
              onOpen={openFile}
              onOpenChat={openChat}
              onJoinVoice={(ch) => {
                setDismissedIncoming(null)
                void voice.join(ch)
              }}
              onLeaveVoice={() => voice.leave()}
              onCreateFile={handleCreateFile}
              onCreateFolder={handleCreateFolder}
              onUpload={handleUpload}
              onDelete={handleDelete}
              onRename={handleRename}
              onMove={handleMove}
              onSetPreviewEntry={setPreviewEntryPath}
              onDownload={handleDownload}
            />
          </div>
          <div style={{ width: 240 }}>
            <SidebarExtras
              activity={activity}
              voiceChannel={voice.channel}
              voiceMuted={voice.muted}
              voiceJoining={voice.joining}
              voicePeers={voice.peers}
              voiceError={voice.error}
              localName={userAwareness.name}
              localColor={userAwareness.color}
              readonly={readonly}
              incomingCall={incomingCall}
              onDismissIncoming={() => {
                if (incomingCall) setDismissedIncoming(incomingCall.channel)
              }}
              connectionStatus={status}
              synced={synced}
              onJoinVoice={(ch) => {
                setDismissedIncoming(null)
                void voice.join(ch)
              }}
              onLeaveVoice={() => voice.leave()}
              onToggleMute={() => voice.toggleMute()}
              onToggleScreen={() => voice.toggleScreenShare?.()}
              screenSharing={voice.screenSharing}
            />
          </div>
        </div>

        {/* Center + Preview */}
        <div className="flex min-w-0 flex-1">
          <PanelGroup direction="horizontal" className="min-w-0 flex-1">
            <Panel defaultSize={55} minSize={25}>
              <div className="flex h-full min-h-0 flex-col" style={{ background: 'var(--surface-0)' }}>
                <Tabs
                  openPaths={openTabs}
                  activePath={activeTab}
                  unreadByPath={unreadByPath}
                  onSelect={(p) => {
                    setActiveTab(p)
                    if (provider && !isChatTab(p) && p !== '__collaborators__') {
                      provider.awareness.setLocalStateField('cursor', { path: p })
                    }
                  }}
                  onClose={closeTab}
                />

                <div className="min-h-0 flex-1">
                  {activeTab === '__collaborators__' ? (
                    <div className="h-full overflow-y-auto p-4" style={{ background: 'var(--surface-1)' }}>
                      <div className="panel-label mb-3">Collaborators</div>
                      <ul className="space-y-2">
                        {users.map((u) => (
                          <li
                            key={u.clientId}
                            className="flex items-center gap-3 rounded-lg border px-3 py-2"
                            style={{ borderColor: 'var(--line)' }}
                          >
                            <span
                              className="flex h-8 w-8 items-center justify-center rounded-full text-[11px] font-semibold text-white"
                              style={{ backgroundColor: u.color }}
                            >
                              {u.name.slice(0, 2).toUpperCase()}
                            </span>
                            <div className="min-w-0 flex-1">
                              <div className="text-sm font-medium text-ink">{u.name}</div>
                              <div className="text-[11px] text-ink-soft">
                                {u.editingPath
                                  ? `Editing ${u.editingPath}`
                                  : u.voiceChannel
                                  ? `In ${u.voiceChannel} call`
                                  : 'Online'}
                              </div>
                            </div>
                            {u.clientId !== localClientId && (
                              <button
                                type="button"
                                className="text-[11px] text-brand hover:underline"
                                onClick={() =>
                                  setFollowingClientId(
                                    followingClientId === u.clientId ? null : u.clientId
                                  )
                                }
                              >
                                {followingClientId === u.clientId ? 'Unfollow' : 'Follow'}
                              </button>
                            )}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : activeTab === '__messages__' ? (
                    <div className="h-full overflow-y-auto p-4" style={{ background: 'var(--surface-1)' }}>
                      <div className="panel-label mb-3">Messages</div>
                      <p className="mb-4 text-xs text-ink-soft">
                        Open a channel: everyone, editors only, or a direct message with a collaborator.
                      </p>
                      <div className="space-y-2">
                        <button
                          type="button"
                          onClick={() => openChat('general')}
                          className="flex w-full items-center gap-3 rounded-xl border px-3 py-3 text-left transition-colors hover:bg-[var(--surface-3)]"
                          style={{ borderColor: 'var(--line)' }}
                        >
                          <span className="flex h-9 w-9 items-center justify-center rounded-full text-white" style={{ background: 'var(--accent)' }}>
                            <i className="fa-solid fa-users text-[13px]" />
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="text-sm font-medium text-ink">General</div>
                            <div className="text-[11px] text-ink-faint">Everyone in the room</div>
                          </div>
                          {Math.max(0, generalMessages.length - generalSeen) > 0 && (
                            <span className="flex h-5 min-w-[20px] items-center justify-center rounded-full px-1.5 text-[10px] font-semibold text-white" style={{ background: 'var(--accent)' }}>
                              {Math.max(0, generalMessages.length - generalSeen)}
                            </span>
                          )}
                        </button>
                        {!readonly && (
                          <button
                            type="button"
                            onClick={() => openChat('editors')}
                            className="flex w-full items-center gap-3 rounded-xl border px-3 py-3 text-left transition-colors hover:bg-[var(--surface-3)]"
                            style={{ borderColor: 'var(--line)' }}
                          >
                            <span className="flex h-9 w-9 items-center justify-center rounded-full text-white" style={{ background: 'var(--accent)' }}>
                              <i className="fa-solid fa-code text-[13px]" />
                            </span>
                            <div className="min-w-0 flex-1">
                              <div className="text-sm font-medium text-ink">Editors</div>
                              <div className="text-[11px] text-ink-faint">Edit-access only</div>
                            </div>
                            {Math.max(0, editorsMessages.length - editorsSeen) > 0 && (
                              <span className="flex h-5 min-w-[20px] items-center justify-center rounded-full px-1.5 text-[10px] font-semibold text-white" style={{ background: 'var(--accent)' }}>
                                {Math.max(0, editorsMessages.length - editorsSeen)}
                              </span>
                            )}
                          </button>
                        )}
                        {users.filter((u) => u.clientId !== localClientId).map((u) => {
                          const ch = dmChannelId(userAwareness.name, u.name)
                          const unread = Math.max(0, (dmMessages[ch] || []).length - (dmSeen[ch] || 0))
                          return (
                          <button
                            key={u.clientId}
                            type="button"
                            onClick={() => openDm(u.name)}
                            className="flex w-full items-center gap-3 rounded-xl border px-3 py-3 text-left transition-colors hover:bg-[var(--surface-3)]"
                            style={{ borderColor: 'var(--line)' }}
                          >
                            <span className="flex h-9 w-9 items-center justify-center rounded-full text-[11px] font-semibold text-white" style={{ backgroundColor: u.color }}>
                              {u.name.slice(0, 2).toUpperCase()}
                            </span>
                            <div className="min-w-0 flex-1">
                              <div className="text-sm font-medium text-ink">{u.name}</div>
                              <div className="text-[11px] text-ink-faint">Direct message</div>
                            </div>
                            {unread > 0 && (
                              <span
                                className="flex h-5 min-w-[20px] items-center justify-center rounded-full px-1.5 text-[10px] font-semibold text-white"
                                style={{ background: 'var(--accent)' }}
                              >
                                {unread > 99 ? '99+' : unread}
                              </span>
                            )}
                          </button>
                          )
                        })}
                      </div>
                    </div>
                  
                  ) : activeTab === '__invite__' ? (
                    <div className="h-full overflow-y-auto p-6" style={{ background: 'var(--surface-1)' }}>
                      <div className="mx-auto max-w-md">
                        <div className="panel-label mb-1">Invite editor</div>
                        <p className="mb-4 text-xs text-ink-soft">
                          Invite a signed-up user by their email. They get editor access and the room password under Editor access on their homepage.
                        </p>
                        <label className="mb-1.5 block text-xs font-medium text-ink-muted">Email</label>
                        <input
                          type="email"
                          className="mb-3 w-full rounded-lg border px-3 py-2.5 text-sm outline-none focus:border-[var(--accent)]"
                          style={{ background: 'var(--surface-2)', borderColor: 'var(--line)', color: 'var(--ink)' }}
                          value={inviteUsername}
                          onChange={(e) => setInviteUsername(e.target.value)}
                          placeholder="user@example.com"
                        />
                        <button
                          type="button"
                          disabled={inviteBusy || !inviteUsername.trim()}
                          onClick={async () => {
                            setInviteBusy(true)
                            setInviteStatus('')
                            const r = await inviteEditor(roomId, inviteUsername.trim(), sessionPwd || requiredPwd || undefined)
                            setInviteBusy(false)
                            if (r.error) setInviteStatus(r.error)
                            else {
                              setInviteStatus(`Invited ${r.invited || inviteUsername} as editor`)
                              setInviteUsername('')
                            }
                          }}
                          className="w-full rounded-lg py-2.5 text-sm font-medium text-white disabled:opacity-50"
                          style={{ background: 'var(--accent)' }}
                        >
                          {inviteBusy ? 'Sending…' : 'Send invite'}
                        </button>
                        {inviteStatus && (
                          <p className="mt-3 text-xs text-ink-soft">{inviteStatus}</p>
                        )}
                      </div>
                    </div>

                  ) : activeTab === '__phone__' ? (
                    <div className="h-full overflow-y-auto p-4" style={{ background: 'var(--surface-1)' }}>
                      <div className="panel-label mb-3">Phone</div>
                      <p className="mb-4 text-xs text-ink-soft">
                        Start a voice call with everyone, editors only, or a single collaborator.
                      </p>
                      <div className="space-y-2">
                        <button
                          type="button"
                          disabled={voice.joining || !!voice.channel}
                          onClick={() => void voice.join('general')}
                          className="flex w-full items-center gap-3 rounded-xl border px-3 py-3 text-left transition-colors hover:bg-[var(--surface-3)] disabled:opacity-50"
                          style={{ borderColor: 'var(--line)' }}
                        >
                          <span className="flex h-9 w-9 items-center justify-center rounded-full text-white" style={{ background: 'var(--accent)' }}>
                            <i className="fa-solid fa-users text-[13px]" />
                          </span>
                          <div>
                            <div className="text-sm font-medium text-ink">General</div>
                            <div className="text-[11px] text-ink-faint">Everyone in the room</div>
                          </div>
                        </button>
                        {!readonly && (
                          <button
                            type="button"
                            disabled={voice.joining || !!voice.channel}
                            onClick={() => void voice.join('editors')}
                            className="flex w-full items-center gap-3 rounded-xl border px-3 py-3 text-left transition-colors hover:bg-[var(--surface-3)] disabled:opacity-50"
                            style={{ borderColor: 'var(--line)' }}
                          >
                            <span className="flex h-9 w-9 items-center justify-center rounded-full text-white" style={{ background: 'var(--accent)' }}>
                              <i className="fa-solid fa-code text-[13px]" />
                            </span>
                            <div>
                              <div className="text-sm font-medium text-ink">Editors</div>
                              <div className="text-[11px] text-ink-faint">Edit-access only</div>
                            </div>
                          </button>
                        )}
                        {users.filter((u) => u.clientId !== localClientId).map((u) => {
                          const dmCh = dmChannelId(userAwareness.name, u.name)
                          const inCall = voice.channel === dmCh
                          return (
                          <button
                            key={u.clientId}
                            type="button"
                            disabled={voice.joining || (!!voice.channel && !inCall)}
                            onClick={() => {
                              if (inCall) voice.leave()
                              else void voice.join(dmCh)
                            }}
                            className="flex w-full items-center gap-3 rounded-xl border px-3 py-3 text-left transition-colors hover:bg-[var(--surface-3)] disabled:opacity-50"
                            style={{ borderColor: 'var(--line)' }}
                          >
                            <span className="flex h-9 w-9 items-center justify-center rounded-full text-[11px] font-semibold text-white" style={{ backgroundColor: u.color }}>
                              {u.name.slice(0, 2).toUpperCase()}
                            </span>
                            <div className="min-w-0 flex-1">
                              <div className="text-sm font-medium text-ink">{u.name}</div>
                              <div className="text-[11px] text-ink-faint">
                                {inCall ? 'In call — click to leave' : u.voiceChannel ? `In ${u.voiceChannel}` : 'Start 1:1 call'}
                              </div>
                            </div>
                            <i className={`fa-solid ${inCall ? 'fa-phone-slash' : 'fa-phone'} text-[12px]`} style={{ color: inCall ? 'var(--danger)' : undefined }} />
                          </button>
                          )
                        })}
                      </div>
                    </div>
                  ) : activeTab && isChatTab(activeTab) ? (
                    <ChatPanel
                      channel={channelFromTab(activeTab)!}
                      messages={(() => {
                        const ch = channelFromTab(activeTab!)
                        if (!ch) return []
                        if (ch === 'editors') return editorsMessages
                        if (ch === 'general') return generalMessages
                        if (isDmChannel(ch)) return dmMessages[ch] || []
                        return generalMessages
                      })()}
                      canPost={(() => {
                        const ch = channelFromTab(activeTab!)
                        if (!ch) return false
                        if (ch === 'editors') return !readonly
                        return true
                      })()}
                      author={userAwareness.name}
                      color={userAwareness.color}
                      onlineNames={users.map((u) => u.name)}
                      onSend={(msg) => sendChatMessage(msg as unknown as Record<string, unknown>)}
                      onTogglePin={(id, pinned) => {
                        const ch = channelFromTab(activeTab!)
                        if (ch) toggleChatPin(ch, id, pinned)
                      }}
                    />
                  ) : activeTab && activeText ? (
                    <Editor
                      key={activeTab}
                      ref={editorHandleRef}
                      path={activeTab}
                      yText={activeText}
                      awareness={provider?.awareness}
                      wordWrap={wordWrap}
                      readonly={readonly}
                      undoManager={null}
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center text-xs text-ink-faint">
                      No file open
                    </div>
                  )}
                </div>

                <BottomConsole
                  lines={editorConsole}
                  changeCount={filesTouched}
                  onClear={() => setEditorConsole([])}
                  collapsed={consoleCollapsed}
                  onToggleCollapse={() => setConsoleCollapsed((v) => !v)}
                />
              </div>
            </Panel>

            <PanelResizeHandle className="w-1 transition-colors hover:bg-brand" style={{ background: 'var(--line)' }} />

            <Panel defaultSize={45} minSize={20}>
              <Preview texts={texts} binaries={binaries} entryPath={previewEntryPath} />
            </Panel>
          </PanelGroup>
        </div>
      </div>

      {showSnapshots && (
        <SnapshotsPanel
          roomId={roomId}
          displayName={userAwareness.name}
          readonly={readonly}
          buildPayload={() => buildSnapshotPayload() as SnapshotPayload | null}
          onRestore={(payload) => {
            restoreSnapshotPayload(payload)
            void postActivity(roomId, 'restore', undefined, userAwareness.name)
          }}
          onClose={() => setShowSnapshots(false)}
        />
      )}
      {showSearch && (
        <SearchPanel
          texts={texts}
          onOpenHit={(path, line) => {
            openFile(path)
            setPendingReveal({ path, line })
          }}
          onClose={() => setShowSearch(false)}
        />
      )}
      {showComments && (
        <CommentsPanel
          comments={comments}
          pathFilter={activeTab && !isChatTab(activeTab) ? activeTab : null}
          readonly={readonly}
          currentAuthor={userAwareness.name}
          currentColor={userAwareness.color}
          onAdd={(c) => {
            const arr = getCommentsArray()
            if (!arr) return
            arr.push([{ ...c, id: nanoid(12), ts: Date.now() }])
          }}
          onResolve={(id, resolved) => {
            const arr = getCommentsArray()
            if (!arr) return
            const items = arr.toArray() as unknown as LineComment[]
            const idx = items.findIndex((x) => x.id === id)
            if (idx === -1) return
            const next = { ...items[idx], resolved }
            arr.delete(idx, 1)
            arr.insert(idx, [next])
          }}
          onDelete={(id) => {
            const arr = getCommentsArray()
            if (!arr) return
            const items = arr.toArray() as unknown as LineComment[]
            const toRemove = new Set([id])
            for (const x of items) {
              if (x.parentId && toRemove.has(x.parentId)) toRemove.add(x.id)
            }
            for (let i = items.length - 1; i >= 0; i--) {
              if (toRemove.has(items[i].id)) arr.delete(i, 1)
            }
          }}
          onJump={(path, line) => {
            openFile(path)
            setPendingReveal({ path, line })
            setShowComments(false)
          }}
          onClose={() => setShowComments(false)}
        />
      )}
      
      {showUnlock && readonly && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(6px)' }}
          onClick={() => setShowUnlock(false)}
        >
          <div
            className="w-full max-w-sm rounded-2xl border p-5 shadow-dropdown"
            style={{ background: 'var(--surface-1)', borderColor: 'var(--line)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-ink">Unlock editor access</h2>
              <button type="button" className="icon-btn h-8 w-8" onClick={() => setShowUnlock(false)}>
                <i className="fa-solid fa-xmark text-[13px]" />
              </button>
            </div>
            <p className="mb-3 text-[12px] text-ink-soft">
              Enter the room password to switch from read-only to full editor access.
            </p>
            <div className="mb-2">
              <PasswordInput
                autoFocus
                placeholder="Room password"
                value={unlockPwd}
                onChange={setUnlockPwd}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    ;(document.getElementById('unlock-submit-btn') as HTMLButtonElement | null)?.click()
                  }
                }}
              />
            </div>
            {unlockError && (
              <p className="mb-2 text-xs" style={{ color: 'var(--danger)' }}>
                {unlockError}
              </p>
            )}
            <button
              id="unlock-submit-btn"
              type="button"
              disabled={unlockBusy || !unlockPwd.trim()}
              className="w-full rounded-lg py-2.5 text-sm font-medium text-white disabled:opacity-50"
              style={{ background: 'var(--accent)' }}
              onClick={async () => {
                const pwd = unlockPwd.trim()
                if (!pwd) return
                setUnlockBusy(true)
                setUnlockError('')
                // Validate by probing websocket upgrade is hard client-side; optimistically apply and reconnect via state.
                // Wrong password → server rejects WS; user stays disconnected until corrected.
                setSessionPwd(pwd)
                setJoinReadonly(false)
                saveSession(roomId, displayName || userAwareness.name, pwd)
                if (user?.id) {
                  rememberRoomPassword(user.id, roomId, pwd)
                  void saveRoomAccess(roomId, { role: 'editor', roomPwd: pwd })
                }
                setUnlockBusy(false)
                setShowUnlock(false)
                // Force a clean reload into editor mode with pwd in URL so Yjs reconnects reliably
                const url = new URL(window.location.href)
                url.searchParams.set('pwd', pwd)
                url.searchParams.delete('readonly')
                window.location.replace(url.pathname + url.search)
              }}
            >
              {unlockBusy ? 'Checking…' : 'Become editor'}
            </button>
          </div>
        </div>
      )}

      {showAuth && <AuthModal onClose={() => setShowAuth(false)} />}

      {editingDesc && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center px-4"
          style={{ background: 'rgba(0,0,0,0.45)' }}
          onClick={(e) => {
            if (e.target === e.currentTarget) setEditingDesc(false)
          }}
        >
          <div
            className="w-full max-w-sm rounded-2xl border p-5 shadow-dropdown"
            style={{ background: 'var(--surface-1)', borderColor: 'var(--line)' }}
          >
            <h3 className="mb-3 text-sm font-semibold text-ink">Edit room title</h3>
            <input
              autoFocus
              className="mb-3 w-full rounded-lg border px-3 py-2.5 text-sm outline-none focus:border-[var(--accent)]"
              style={{ background: 'var(--surface-2)', borderColor: 'var(--line)', color: 'var(--ink)' }}
              value={descDraft}
              maxLength={50}
              onChange={(e) => setDescDraft(e.target.value.slice(0, 50))}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void saveDescription()
                if (e.key === 'Escape') setEditingDesc(false)
              }}
            />
            <div className="mb-3 flex items-center justify-between text-[10px] text-ink-faint">
              <span>{descDraft.trim().length}/50</span>
              <button
                type="button"
                className="text-ink-soft hover:text-ink"
                onClick={() => setIsPublic((v) => !v)}
              >
                {isPublic ? (
                  <><i className="fa-solid fa-globe mr-1" /> Public</>
                ) : (
                  <><i className="fa-solid fa-lock mr-1" /> Private</>
                )}
              </button>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setEditingDesc(false)}
                className="flex-1 rounded-lg border py-2 text-xs text-ink-muted"
                style={{ borderColor: 'var(--line)' }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void saveDescription()}
                className="flex-1 rounded-lg py-2 text-xs font-medium text-white"
                style={{ background: 'var(--accent)' }}
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
