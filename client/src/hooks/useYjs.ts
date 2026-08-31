import { useCallback, useEffect, useRef, useState } from 'react'
import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'
import { IndexeddbPersistence } from 'y-indexeddb'
import { isTextFile } from '../lib/fileTypes'

export interface AwarenessUser {
  name: string
  color: string
}

export interface RemoteUserState {
  clientId: number
  name: string
  color: string
  voiceChannel?: 'general' | 'editors' | null
  voiceMuted?: boolean
  cursor?: { path?: string; line?: number; column?: number } | null
  editingPath?: string | null
  screenSharing?: boolean
}

export interface FileMetaValue {
  type: 'file' | 'folder'
  binary: boolean
  mime?: string
}

/**
 * WebSocket URL for the y-websocket server.
 * - If VITE_WS_URL is set in .env, use that.
 * - Otherwise derive from the page URL so a changing LAN IP still works.
 */
function resolveWsUrl(): string {
  const fromEnv = (import.meta.env.VITE_WS_URL as string | undefined)?.trim()
  if (fromEnv) return fromEnv
  if (typeof window !== 'undefined' && window.location?.host) {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    // Same-origin: use host as-is (no forced :1234)
    return `${protocol}//${window.location.host}`
  }
  return 'ws://localhost:1234'
}

/**
 * Connects to a Yjs room after `enabled` is true (i.e. after the user joins).
 * Doc + provider are created inside the effect so React StrictMode's
 * mount→cleanup→remount cycle always gets a fresh, live document.
 * IndexedDB keeps a local copy so refresh feels instant.
 */
export function useYjs(
  roomId: string,
  user: AwarenessUser,
  roomPwd: string,
  viewKey: string,
  readonly = false,
  enabled = true
) {
  const [doc, setDoc] = useState<Y.Doc | null>(null)
  const [provider, setProvider] = useState<WebsocketProvider | null>(null)
  const [status, setStatus] = useState<'connecting' | 'connected' | 'disconnected'>('connecting')
  const [synced, setSynced] = useState(false)
  const [idbSynced, setIdbSynced] = useState(false)
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null)
  const [users, setUsers] = useState<RemoteUserState[]>([])
  const undoManagersRef = useRef<Map<string, Y.UndoManager>>(new Map())
  const idbRef = useRef<IndexeddbPersistence | null>(null)

  useEffect(() => {
    if (!enabled || !roomId) return

    const ydoc = new Y.Doc()
    const params: Record<string, string> = {}
    if (readonly) {
      if (viewKey) params.view = viewKey
    } else {
      if (roomPwd) params.pwd = roomPwd
      if (viewKey) params.view = viewKey
    }

    // Local IndexedDB persistence — survives refresh without feeling logged out of the doc.
    const idb = new IndexeddbPersistence(`collab-room:${roomId}`, ydoc)
    idbRef.current = idb
    idb.on('synced', () => {
      setIdbSynced(true)
      setLastSyncedAt(Date.now())
    })

    const wsUrl = resolveWsUrl()
    const wsProvider = new WebsocketProvider(wsUrl, roomId, ydoc, {
      params,
      // Silent reconnect: y-websocket reconnects by default; keep max backoff reasonable.
      maxBackoffTime: 10000
    })

    wsProvider.awareness.setLocalStateField('user', {
      name: user.name,
      color: user.color
    })
    wsProvider.awareness.setLocalStateField('readonly', readonly)

    const onStatus = (e: { status: 'connecting' | 'connected' | 'disconnected' }) => {
      setStatus(e.status)
      if (e.status !== 'connected') setSynced(false)
    }
    wsProvider.on('status', onStatus)

    const onSync = (isSynced: boolean) => {
      setSynced(!!isSynced)
      if (isSynced) setLastSyncedAt(Date.now())
    }
    wsProvider.on('sync', onSync)
    if ((wsProvider as unknown as { synced?: boolean }).synced) {
      setSynced(true)
      setLastSyncedAt(Date.now())
    }

    const onAwarenessChange = () => {
      const states = Array.from(wsProvider.awareness.getStates().entries())
      setUsers(
        states
          .filter(([, state]) => state.user)
          .map(([clientId, state]) => {
            const voice = state.voice as
              | { channel?: 'general' | 'editors' | null; muted?: boolean; screen?: boolean }
              | undefined
            const cursor = state.cursor as
              | { path?: string; line?: number; column?: number }
              | null
              | undefined
            return {
              clientId,
              name: (state.user as AwarenessUser).name,
              color: (state.user as AwarenessUser).color,
              voiceChannel: voice?.channel ?? null,
              voiceMuted: !!voice?.muted,
              cursor: cursor ?? null,
              editingPath: (state.editingPath as string | null | undefined) ?? null,
              screenSharing: !!voice?.screen
            }
          })
      )
    }
    wsProvider.awareness.on('change', onAwarenessChange)
    onAwarenessChange()

    setDoc(ydoc)
    setProvider(wsProvider)
    setStatus(wsProvider.wsconnected ? 'connected' : 'connecting')

    if (viewKey && !readonly) {
      const meta = ydoc.getMap('roomMeta')
      if (!meta.get('viewKey')) {
        meta.set('viewKey', viewKey)
      }
    }

    return () => {
      wsProvider.awareness.off('change', onAwarenessChange)
      wsProvider.off('status', onStatus)
      wsProvider.off('sync', onSync)
      wsProvider.destroy()
      idb.destroy()
      idbRef.current = null
      ydoc.destroy()
      undoManagersRef.current.clear()
      setDoc(null)
      setProvider(null)
      setSynced(false)
      setIdbSynced(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId, roomPwd, viewKey, readonly, enabled])

  useEffect(() => {
    if (!provider) return
    provider.awareness.setLocalStateField('user', {
      name: user.name,
      color: user.color
    })
  }, [provider, user.name, user.color])

  const filesMeta = useCallback((): Y.Map<FileMetaValue> => {
    if (!doc) throw new Error('Yjs doc not ready')
    return doc.getMap('filesMeta')
  }, [doc])

  const fileTexts = useCallback((): Y.Map<Y.Text> => {
    if (!doc) throw new Error('Yjs doc not ready')
    return doc.getMap('fileTexts')
  }, [doc])

  const fileBinaries = useCallback((): Y.Map<string> => {
    if (!doc) throw new Error('Yjs doc not ready')
    return doc.getMap('fileBinaries')
  }, [doc])

  const getUndoManager = useCallback(
    (path: string): Y.UndoManager | null => {
      if (readonly || !doc) return null
      const texts = doc.getMap<Y.Text>('fileTexts')
      const yText = texts.get(path)
      if (!yText) return null
      let um = undoManagersRef.current.get(path)
      if (!um) {
        um = new Y.UndoManager(yText)
        undoManagersRef.current.set(path, um)
      }
      return um
    },
    [doc, readonly]
  )

  const createFolder = useCallback(
    (path: string) => {
      if (readonly || !doc) return
      doc.getMap<FileMetaValue>('filesMeta').set(path, { type: 'folder', binary: false })
    },
    [doc, readonly]
  )

  const createFile = useCallback(
    (path: string, initialText = '') => {
      if (readonly || !doc) return
      const binary = !isTextFile(path)
      const meta = doc.getMap<FileMetaValue>('filesMeta')
      const texts = doc.getMap<Y.Text>('fileTexts')
      // Atomic + non-destructive: never replace an existing Y.Text (that wiped HTML on reload)
      doc.transact(() => {
        if (!meta.has(path)) {
          meta.set(path, { type: 'file', binary })
        }
        if (!binary && !texts.has(path)) {
          const yText = new Y.Text()
          if (initialText) yText.insert(0, initialText)
          texts.set(path, yText)
        }
      })
    },
    [doc, readonly]
  )

  const uploadFile = useCallback(
    (path: string, file: File) => {
      if (readonly || !doc) return
      const binary = !isTextFile(path)
      doc.getMap<FileMetaValue>('filesMeta').set(path, {
        type: 'file',
        binary,
        mime: file.type
      })

      const reader = new FileReader()
      if (binary) {
        reader.onload = () => {
          doc.getMap<string>('fileBinaries').set(path, reader.result as string)
        }
        reader.readAsDataURL(file)
      } else {
        reader.onload = () => {
          const text = reader.result as string
          const yText = new Y.Text()
          if (text) yText.insert(0, text)
          doc.getMap<Y.Text>('fileTexts').set(path, yText)
        }
        reader.readAsText(file)
      }
    },
    [doc, readonly]
  )

  const deletePath = useCallback(
    (path: string) => {
      if (readonly || !doc) return
      const meta = doc.getMap<FileMetaValue>('filesMeta')
      const texts = doc.getMap<Y.Text>('fileTexts')
      const binaries = doc.getMap<string>('fileBinaries')
      const isFolder = meta.get(path)?.type === 'folder'

      meta.delete(path)
      texts.delete(path)
      binaries.delete(path)
      undoManagersRef.current.delete(path)

      if (isFolder) {
        const prefix = path + '/'
        Array.from(meta.keys())
          .filter((p) => p.startsWith(prefix))
          .forEach((p) => {
            meta.delete(p)
            texts.delete(p)
            binaries.delete(p)
            undoManagersRef.current.delete(p)
          })
      }
    },
    [doc, readonly]
  )

  const renamePath = useCallback(
    (oldPath: string, newPath: string): { from: string; to: string }[] => {
      if (readonly || !doc) return []
      if (oldPath === newPath) return []
      const meta = doc.getMap<FileMetaValue>('filesMeta')
      const texts = doc.getMap<Y.Text>('fileTexts')
      const binaries = doc.getMap<string>('fileBinaries')
      const entry = meta.get(oldPath)
      if (!entry) return []
      if (meta.has(newPath)) return []

      const changes: { from: string; to: string }[] = []

      const moveOne = (from: string, to: string) => {
        const m = meta.get(from)
        if (!m) return
        meta.set(to, m)
        meta.delete(from)

        const t = texts.get(from)
        if (t) {
          texts.set(to, t)
          texts.delete(from)
          const um = undoManagersRef.current.get(from)
          if (um) {
            undoManagersRef.current.delete(from)
            undoManagersRef.current.set(to, um)
          }
        }

        const b = binaries.get(from)
        if (b !== undefined) {
          binaries.set(to, b)
          binaries.delete(from)
        }

        changes.push({ from, to })
      }

      if (entry.type === 'folder') {
        const prefix = oldPath + '/'
        const nested = Array.from(meta.keys())
          .filter((p) => p === oldPath || p.startsWith(prefix))
          .sort((a, b) => b.length - a.length)

        for (const from of nested) {
          const to = from === oldPath ? newPath : newPath + from.slice(oldPath.length)
          moveOne(from, to)
        }
      } else {
        moveOne(oldPath, newPath)
      }

      return changes
    },
    [doc, readonly]
  )

  const getOrCreateText = useCallback(
    (path: string): Y.Text | null => {
      if (!doc) return null
      const texts = doc.getMap<Y.Text>('fileTexts')
      const existing = texts.get(path)
      if (existing) return existing
      // Do NOT insert an empty Y.Text before sync completes — that raced with
      // LevelDB/IndexedDB restore and blanked HTML (and any large text file).
      if (!synced || readonly) return null
      const yText = new Y.Text()
      texts.set(path, yText)
      return yText
    },
    [doc, readonly, synced]
  )

  const getRoomViewKey = useCallback((): string => {
    if (!doc) return viewKey || ''
    const meta = doc.getMap<string>('roomMeta')
    return (meta.get('viewKey') as string) || viewKey || ''
  }, [doc, viewKey])

  const getRoomDescription = useCallback((): string => {
    if (!doc) return ''
    const meta = doc.getMap('roomMeta')
    return String(meta.get('description') || '')
  }, [doc])

  const setRoomDescriptionLocal = useCallback(
    (description: string) => {
      if (!doc || readonly) return
      const desc = description.trim().slice(0, 50)
      doc.getMap('roomMeta').set('description', desc)
    },
    [doc, readonly]
  )

  const getChatArray = useCallback(
    (channel: string) => {
      if (!doc) return null
      // general | editors | dm:nameA|nameB
      return doc.getArray<Record<string, unknown>>(`chat:${channel}`)
    },
    [doc]
  )

  const sendChatMessage = useCallback(
    (msg: Record<string, unknown>) => {
      if (!doc) return
      const channel = String(msg.channel || '')
      if (!channel) return
      if (channel === 'editors' && readonly) return
      // allow general, editors, and dm:* channels
      if (channel !== 'general' && channel !== 'editors' && !channel.startsWith('dm:')) return
      const arr = doc.getArray(`chat:${channel}`)
      arr.push([msg])
    },
    [doc, readonly]
  )

  /** Replace all files from a snapshot payload (editors only). */
  const restoreSnapshotPayload = useCallback(
    (payload: {
      filesMeta: Record<string, FileMetaValue>
      fileTexts: Record<string, string>
      fileBinaries: Record<string, string>
      description?: string
    }) => {
      if (!doc || readonly) return
      const meta = doc.getMap<FileMetaValue>('filesMeta')
      const texts = doc.getMap<Y.Text>('fileTexts')
      const binaries = doc.getMap<string>('fileBinaries')

      doc.transact(() => {
        Array.from(meta.keys()).forEach((k) => meta.delete(k))
        Array.from(texts.keys()).forEach((k) => texts.delete(k))
        Array.from(binaries.keys()).forEach((k) => binaries.delete(k))

        for (const [path, m] of Object.entries(payload.filesMeta || {})) {
          meta.set(path, m)
        }
        for (const [path, content] of Object.entries(payload.fileTexts || {})) {
          const yText = new Y.Text()
          if (content) yText.insert(0, content)
          texts.set(path, yText)
        }
        for (const [path, data] of Object.entries(payload.fileBinaries || {})) {
          binaries.set(path, data)
        }
        if (typeof payload.description === 'string') {
          doc.getMap('roomMeta').set('description', payload.description.slice(0, 50))
        }
      })
      undoManagersRef.current.clear()
    },
    [doc, readonly]
  )

  const buildSnapshotPayload = useCallback(() => {
    if (!doc) return null
    const meta = doc.getMap<FileMetaValue>('filesMeta')
    const texts = doc.getMap<Y.Text>('fileTexts')
    const binaries = doc.getMap<string>('fileBinaries')
    const filesMetaObj: Record<string, FileMetaValue> = {}
    meta.forEach((v, k) => {
      filesMetaObj[k] = v
    })
    const fileTextsObj: Record<string, string> = {}
    texts.forEach((v, k) => {
      fileTextsObj[k] = v.toString()
    })
    const fileBinariesObj: Record<string, string> = {}
    binaries.forEach((v, k) => {
      fileBinariesObj[k] = v
    })
    return {
      filesMeta: filesMetaObj,
      fileTexts: fileTextsObj,
      fileBinaries: fileBinariesObj,
      description: String(doc.getMap('roomMeta').get('description') || '')
    }
  }, [doc])

  const getCommentsArray = useCallback(() => {
    if (!doc) return null
    return doc.getArray<Record<string, unknown>>('comments')
  }, [doc])

  const setEditingPath = useCallback(
    (path: string | null) => {
      if (!provider) return
      provider.awareness.setLocalStateField('editingPath', path)
    },
    [provider]
  )

  const toggleChatPin = useCallback(
    (channel: string, messageId: string, pinned: boolean) => {
      if (!doc || readonly) return
      const arr = doc.getArray(`chat:${channel}`)
      const items = arr.toArray() as Record<string, unknown>[]
      const idx = items.findIndex((m) => m.id === messageId)
      if (idx === -1) return
      const next = { ...items[idx], pinned }
      doc.transact(() => {
        arr.delete(idx, 1)
        arr.insert(idx, [next])
      })
    },
    [doc, readonly]
  )

  return {
    doc,
    provider,
    status,
    users,
    ready: !!doc,
    synced,
    idbSynced,
    lastSyncedAt,
    wsUrl: resolveWsUrl(),
    filesMeta,
    fileTexts,
    fileBinaries,
    createFolder,
    createFile,
    uploadFile,
    deletePath,
    renamePath,
    getOrCreateText,
    getUndoManager,
    getRoomViewKey,
    getRoomDescription,
    setRoomDescriptionLocal,
    getChatArray,
    sendChatMessage,
    restoreSnapshotPayload,
    buildSnapshotPayload,
    getCommentsArray,
    setEditingPath,
    toggleChatPin,
    readonly
  }
}
