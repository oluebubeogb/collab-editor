import { useEffect, useState } from 'react'
import {
  createSnapshot,
  deleteSnapshot,
  fetchActivity,
  getSnapshot,
  listSnapshots,
  type ActivityEntry,
  type SnapshotMeta,
  type SnapshotPayload
} from '../lib/api'

interface SnapshotsPanelProps {
  roomId: string
  displayName: string
  readonly: boolean
  buildPayload: () => SnapshotPayload | null
  onRestore: (payload: SnapshotPayload) => void
  onClose: () => void
}

export default function SnapshotsPanel({
  roomId,
  displayName,
  readonly,
  buildPayload,
  onRestore,
  onClose
}: SnapshotsPanelProps) {
  const [tab, setTab] = useState<'snapshots' | 'activity'>('snapshots')
  const [snapshots, setSnapshots] = useState<SnapshotMeta[]>([])
  const [activity, setActivity] = useState<ActivityEntry[]>([])
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const reload = async () => {
    const [s, a] = await Promise.all([listSnapshots(roomId), fetchActivity(roomId)])
    if (s.snapshots) setSnapshots(s.snapshots)
    if (a.activity) setActivity(a.activity)
  }

  useEffect(() => {
    void reload()
  }, [roomId])

  const save = async () => {
    const payload = buildPayload()
    if (!payload) {
      setError('Nothing to snapshot yet.')
      return
    }
    setBusy(true)
    setError('')
    const r = await createSnapshot(roomId, name.trim() || 'Snapshot', payload, displayName)
    setBusy(false)
    if (r.error) setError(r.error)
    else {
      setName('')
      await reload()
    }
  }

  const restore = async (id: string) => {
    const r = await getSnapshot(roomId, id)
    if (r.error || !r.snapshot?.payload) {
      setError(r.error || 'Failed to load snapshot')
      return
    }
    if (!window.confirm('Restore this snapshot? Current files will be overwritten.')) return
    onRestore(r.snapshot.payload)
    onClose()
  }

  const remove = async (id: string) => {
    if (!window.confirm('Delete this snapshot?')) return
    await deleteSnapshot(roomId, id)
    await reload()
  }

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.55)' }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        className="flex w-full max-w-md max-h-[80vh] flex-col rounded-xl border shadow-2xl"
        style={{ background: 'var(--surface-1)', borderColor: 'var(--line)' }}
      >
        <div
          className="flex items-center justify-between border-b px-4 py-3"
          style={{ borderColor: 'var(--line)' }}
        >
          <div className="flex gap-2 text-sm">
            <button
              type="button"
              className="rounded px-2 py-1 transition-colors"
              style={{
                background: tab === 'snapshots' ? 'var(--surface-3)' : 'transparent',
                color: tab === 'snapshots' ? 'var(--ink)' : 'var(--ink-soft)'
              }}
              onClick={() => setTab('snapshots')}
            >
              Snapshots
            </button>
            <button
              type="button"
              className="rounded px-2 py-1 transition-colors"
              style={{
                background: tab === 'activity' ? 'var(--surface-3)' : 'transparent',
                color: tab === 'activity' ? 'var(--ink)' : 'var(--ink-soft)'
              }}
              onClick={() => setTab('activity')}
            >
              Activity
            </button>
          </div>
          <button type="button" onClick={onClose} className="icon-btn h-7 w-7" aria-label="Close">
            <i className="fa-solid fa-xmark text-[12px]" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {tab === 'snapshots' ? (
            <div className="space-y-4">
              {!readonly && (
                <div className="flex gap-2">
                  <input
                    className="flex-1 rounded-lg border px-2 py-1.5 text-sm outline-none focus:border-[var(--accent)]"
                    style={{
                      background: 'var(--surface-2)',
                      borderColor: 'var(--line)',
                      color: 'var(--ink)'
                    }}
                    placeholder="Snapshot name"
                    value={name}
                    maxLength={80}
                    onChange={(e) => setName(e.target.value)}
                  />
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void save()}
                    className="rounded-lg px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
                    style={{ background: 'var(--accent)' }}
                  >
                    Save
                  </button>
                </div>
              )}
              {error && (
                <p className="text-xs" style={{ color: 'var(--danger)' }}>
                  {error}
                </p>
              )}
              {snapshots.length === 0 ? (
                <p className="text-xs text-ink-faint">No snapshots yet.</p>
              ) : (
                <ul className="space-y-2">
                  {snapshots.map((s) => (
                    <li
                      key={s.id}
                      className="flex items-center justify-between gap-2 rounded-lg border px-2 py-2"
                      style={{ borderColor: 'var(--line)', background: 'var(--surface-2)' }}
                    >
                      <div className="min-w-0">
                        <div className="truncate text-sm text-ink">{s.name}</div>
                        <div className="text-[10px] text-ink-faint">
                          {s.createdBy || 'anon'} · {new Date(s.createdAt).toLocaleString()}
                        </div>
                      </div>
                      <div className="flex shrink-0 gap-1">
                        {!readonly && (
                          <button
                            type="button"
                            onClick={() => void restore(s.id)}
                            className="rounded border px-2 py-1 text-[10px] text-ink-soft hover:bg-[var(--surface-3)]"
                            style={{ borderColor: 'var(--line)' }}
                          >
                            Restore
                          </button>
                        )}
                        {!readonly && (
                          <button
                            type="button"
                            onClick={() => void remove(s.id)}
                            className="rounded border px-2 py-1 text-[10px] hover:bg-[var(--surface-3)]"
                            style={{ borderColor: 'var(--line)', color: 'var(--danger)' }}
                          >
                            Del
                          </button>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : (
            <ul className="space-y-2">
              {activity.length === 0 ? (
                <p className="text-xs text-ink-faint">No activity yet.</p>
              ) : (
                activity.map((a) => (
                  <li
                    key={a.id}
                    className="border-b pb-2 text-xs"
                    style={{ borderColor: 'var(--line)' }}
                  >
                    <span className="text-ink-muted">{a.displayName || 'anon'}</span>
                    <span className="text-ink-faint"> · {a.action}</span>
                    {a.detail && <span className="text-ink-soft"> — {a.detail}</span>}
                    <div className="text-[10px] text-ink-faint">
                      {new Date(a.createdAt).toLocaleString()}
                    </div>
                  </li>
                ))
              )}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}
