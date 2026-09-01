import { useMemo, useRef, useState } from 'react'
import type { FileMetaValue } from '../hooks/useYjs'
import { getFileName, getParentFolder, isHtmlFile, stripQueryAndHash } from '../lib/fileTypes'

export interface FileEntry {
  path: string
  meta: FileMetaValue
}

interface TreeNode {
  name: string
  path: string
  isFolder: boolean
  children: TreeNode[]
}

function buildTree(entries: FileEntry[]): TreeNode[] {
  const root: TreeNode[] = []
  const byPath = new Map<string, TreeNode>()

  const sorted = [...entries].sort((a, b) => a.path.localeCompare(b.path))

  for (const { path, meta } of sorted) {
    const parts = path.split('/')
    let currentPath = ''
    let siblings = root

    parts.forEach((part, i) => {
      currentPath = currentPath ? `${currentPath}/${part}` : part
      const isLast = i === parts.length - 1
      let node = byPath.get(currentPath)

      if (!node) {
        node = {
          name: part,
          path: currentPath,
          isFolder: isLast ? meta.type === 'folder' : true,
          children: []
        }
        byPath.set(currentPath, node)
        siblings.push(node)
      }
      siblings = node.children
    })
  }

  const sortTree = (nodes: TreeNode[]) => {
    nodes.sort((a, b) => {
      if (a.isFolder !== b.isFolder) return a.isFolder ? -1 : 1
      return a.name.localeCompare(b.name)
    })
    nodes.forEach((n) => sortTree(n.children))
  }
  sortTree(root)
  return root
}

interface FileExplorerProps {
  entries: FileEntry[]
  activePath: string | null
  previewEntryPath: string | null
  readonly?: boolean
  generalUnread?: number
  editorsUnread?: number
  voiceChannel?: string | null
  voiceJoining?: boolean
  onOpen: (path: string) => void
  onOpenChat: (channel: string) => void
  onJoinVoice?: (channel: string) => void
  onLeaveVoice?: () => void
  onCreateFile: (parentFolder: string | null) => void
  onCreateFolder: (parentFolder: string | null) => void
  onUpload: (parentFolder: string | null, files: FileList) => void
  onDelete: (path: string) => void
  onRename: (oldPath: string, newPath: string) => void
  onMove: (oldPath: string, newParentFolder: string | null) => void
  onSetPreviewEntry: (path: string) => void
  onDownload: (path: string) => void
}

export default function FileExplorer({
  entries,
  activePath,
  previewEntryPath,
  readonly = false,
  generalUnread = 0,
  editorsUnread = 0,
  voiceChannel = null,
  voiceJoining = false,
  onOpen,
  onOpenChat,
  onJoinVoice,
  onLeaveVoice,
  onCreateFile,
  onCreateFolder,
  onUpload,
  onDelete,
  onRename,
  onMove,
  onSetPreviewEntry,
  onDownload
}: FileExplorerProps) {
  const tree = useMemo(() => buildTree(entries), [entries])
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null)
  const [dragPath, setDragPath] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<string | null>(null)
  const uploadInputRef = useRef<HTMLInputElement>(null)

  const triggerUpload = () => uploadInputRef.current?.click()

  return (
    <div className="h-full flex flex-col text-ink" style={{ background: "var(--surface-1)" }}>
      <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--line)]">
        <span className="text-xs font-semibold text-ink-soft uppercase tracking-wide">
          Files{readonly ? ' (read-only)' : ''}
        </span>
        {!readonly && (
          <div className="flex gap-1">
            <button
              title="New file"
              onClick={() => onCreateFile(selectedFolder)}
              className="w-6 h-6 rounded hover:bg-[var(--surface-3)] text-ink-soft hover:text-ink"
            >
              +f
            </button>
            <button
              title="New folder"
              onClick={() => onCreateFolder(selectedFolder)}
              className="w-6 h-6 rounded hover:bg-[var(--surface-3)] text-ink-soft hover:text-ink"
            >
              +d
            </button>
            <button
              title="Upload file or folder"
              onClick={triggerUpload}
              className="w-6 h-6 rounded hover:bg-[var(--surface-3)] text-ink-soft hover:text-ink"
            >
              ↑
            </button>
            <input
              ref={uploadInputRef}
              type="file"
              multiple
              // Enable folder selection (preserves structure via webkitRelativePath)
              {...({ webkitdirectory: '', directory: '' } as Record<string, string>)}
              className="hidden"
              onChange={(e) => {
                if (e.target.files && e.target.files.length > 0) {
                  onUpload(selectedFolder, e.target.files)
                }
                e.target.value = ''
              }}
            />
          </div>
        )}
      </div>

      <div
        className="flex-1 overflow-y-auto py-1"
        onDragOver={(e) => {
          if (readonly) return
          e.preventDefault()
          setDropTarget(null) // root
        }}
        onDrop={(e) => {
          if (readonly) return
          e.preventDefault()
          if (dragPath) {
            onMove(dragPath, null)
            setDragPath(null)
            setDropTarget(null)
          }
        }}
      >
        {tree.length === 0 && (
          <p className="text-xs text-ink-faint px-3 py-4">
            No files yet. Use +f / +d above, or upload files / a folder.
          </p>
        )}
        {tree.map((node) => (
          <TreeRow
            key={node.path}
            node={node}
            depth={0}
            activePath={activePath}
            previewEntryPath={previewEntryPath}
            selectedFolder={selectedFolder}
            readonly={readonly}
            dragPath={dragPath}
            dropTarget={dropTarget}
            onSelectFolder={setSelectedFolder}
            onOpen={onOpen}
            onDelete={onDelete}
            onRename={onRename}
            onSetPreviewEntry={onSetPreviewEntry}
            onDragStart={setDragPath}
            onDragOverTarget={(p) => setDropTarget(p)}
            onDropOnFolder={(folder) => {
              if (dragPath) {
                onMove(dragPath, folder)
                setDragPath(null)
                setDropTarget(null)
              }
            }}
            onDownload={onDownload}
          />
        ))}
      </div>
    </div>
  )
}

interface TreeRowProps {
  node: TreeNode
  depth: number
  activePath: string | null
  previewEntryPath: string | null
  selectedFolder: string | null
  readonly: boolean
  dragPath: string | null
  dropTarget: string | null
  onSelectFolder: (path: string | null) => void
  onOpen: (path: string) => void
  onDelete: (path: string) => void
  onRename: (oldPath: string, newPath: string) => void
  onSetPreviewEntry: (path: string) => void
  onDragStart: (path: string | null) => void
  onDragOverTarget: (path: string | null) => void
  onDropOnFolder: (folder: string) => void
  onDownload: (path: string) => void
}

function TreeRow({
  node,
  depth,
  activePath,
  previewEntryPath,
  selectedFolder,
  readonly,
  dragPath,
  dropTarget,
  onSelectFolder,
  onOpen,
  onDelete,
  onRename,
  onSetPreviewEntry,
  onDragStart,
  onDragOverTarget,
  onDropOnFolder,
  onDownload
}: TreeRowProps) {
  const [expanded, setExpanded] = useState(true)
  const [editing, setEditing] = useState(false)
  const [editName, setEditName] = useState(node.name)
  const isActive = activePath === node.path
  const isPreviewEntry =
    previewEntryPath !== null && stripQueryAndHash(previewEntryPath) === node.path
  const isSelectedFolder = selectedFolder === node.path
  const isDropTarget = dropTarget === node.path && node.isFolder

  const commitRename = () => {
    setEditing(false)
    const trimmed = editName.trim()
    if (!trimmed || trimmed === node.name) {
      setEditName(node.name)
      return
    }
    if (trimmed.includes('/')) {
      window.alert('Name cannot contain "/"')
      setEditName(node.name)
      return
    }
    const parent = getParentFolder(node.path)
    const newPath = parent ? `${parent}/${trimmed}` : trimmed
    onRename(node.path, newPath)
  }

  return (
    <div>
      <div
        draggable={!readonly}
        onDragStart={(e) => {
          if (readonly) return
          e.dataTransfer.effectAllowed = 'move'
          onDragStart(node.path)
        }}
        onDragEnd={() => {
          onDragStart(null)
          onDragOverTarget(null)
        }}
        onDragOver={(e) => {
          if (readonly || !node.isFolder) return
          e.preventDefault()
          e.stopPropagation()
          onDragOverTarget(node.path)
        }}
        onDrop={(e) => {
          if (readonly || !node.isFolder) return
          e.preventDefault()
          e.stopPropagation()
          onDropOnFolder(node.path)
        }}
        className={`group flex items-center gap-1 px-2 py-1 cursor-pointer hover:bg-[var(--surface-3)] ${
          isActive ? 'bg-brand-dim text-ink' : 'text-ink-muted'
        } ${isSelectedFolder ? 'ring-1 ring-inset ring-blue-600/40' : ''} ${
          isDropTarget ? 'bg-brand-dim ring-1 ring-brand' : ''
        } ${dragPath === node.path ? 'opacity-50' : ''}`}
        style={{ paddingLeft: 8 + depth * 14 }}
        onClick={() => {
          if (editing) return
          if (node.isFolder) {
            setExpanded((v) => !v)
            onSelectFolder(node.path)
          } else {
            onOpen(node.path)
          }
        }}
        onDoubleClick={(e) => {
          if (readonly) return
          e.stopPropagation()
          setEditing(true)
          setEditName(node.name)
        }}
      >
        <span className="text-xs w-3 text-ink-faint">
          {node.isFolder ? (expanded ? '▾' : '▸') : ''}
        </span>

        {editing ? (
          <input
            autoFocus
            className="flex-1 text-xs bg-[var(--surface-1)] border border-brand rounded px-1 py-0.5 outline-none"
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitRename()
              if (e.key === 'Escape') {
                setEditing(false)
                setEditName(node.name)
              }
            }}
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <span className="truncate flex-1 text-xs">{getFileName(node.path)}</span>
        )}

        {!node.isFolder && isHtmlFile(node.path) && (
          <button
            title="Set as live preview entry point"
            onClick={(e) => {
              e.stopPropagation()
              onSetPreviewEntry(node.path)
            }}
            className={`opacity-0 group-hover:opacity-100 text-[10px] px-1 rounded border ${
              isPreviewEntry
                ? 'opacity-100 border-[var(--accent)] text-brand'
                : 'border-[var(--line)] text-ink-faint'
            }`}
          >
            {isPreviewEntry ? '● preview' : 'preview'}
          </button>
        )}
        {!node.isFolder && (
          <button
            title="Download"
            onClick={(e) => {
              e.stopPropagation()
              onDownload(node.path)
            }}
            className="opacity-0 group-hover:opacity-100 text-ink-faint hover:text-brand text-xs px-1"
          >
            ↓
          </button>
        )}
        {!readonly && (
          <>
            <button
              title="Rename"
              onClick={(e) => {
                e.stopPropagation()
                setEditing(true)
                setEditName(node.name)
              }}
              className="opacity-0 group-hover:opacity-100 text-ink-faint hover:text-brand text-xs px-1"
            >
              ✎
            </button>
            <button
              title="Delete"
              onClick={(e) => {
                e.stopPropagation()
                if (confirm(`Delete "${node.path}"?`)) onDelete(node.path)
              }}
              className="opacity-0 group-hover:opacity-100 text-ink-faint hover:text-red-400 text-xs px-1"
            >
              ✕
            </button>
          </>
        )}
      </div>

      {node.isFolder && expanded && (
        <div>
          {node.children.map((child) => (
            <TreeRow
              key={child.path}
              node={child}
              depth={depth + 1}
              activePath={activePath}
              previewEntryPath={previewEntryPath}
              selectedFolder={selectedFolder}
              readonly={readonly}
              dragPath={dragPath}
              dropTarget={dropTarget}
              onSelectFolder={onSelectFolder}
              onOpen={onOpen}
              onDelete={onDelete}
              onRename={onRename}
              onSetPreviewEntry={onSetPreviewEntry}
              onDragStart={onDragStart}
              onDragOverTarget={onDragOverTarget}
              onDropOnFolder={onDropOnFolder}
              onDownload={onDownload}
            />
          ))}
        </div>
      )}
    </div>
  )
}
