import { useEffect, useMemo, useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { useTheme } from '../hooks/useTheme'
import AuthModal from '../components/AuthModal'
import BrandLogo from '../components/BrandLogo'
import Footer from '../components/Footer'
import PasswordInput from '../components/PasswordInput'
import {
  createRoomMeta,
  listMyRooms,
  listRecentRooms,
  listEditorialRooms,
  getRoomMeta,
  searchRooms,
  markAccessSeen,
  type RoomMeta,
  type EditorialRoom
} from '../lib/api'
import { nanoid } from '../lib/id'
import { ROOM_TEMPLATES, type TemplateId } from '../lib/workspace'
import { getRememberedPassword } from '../lib/roomSecrets'

const HERO_EXTS = /\.(png|jpe?g|webp|gif|avif)$/i
const PAGE_SIZE = 10

type OverlayKind = 'join' | 'search' | 'create' | 'room' | null

interface FeaturedRoom {
  id: string
  /** Line 2+ text from featured-rooms.txt */
  blurb: string
  /** Resolved live room title (description field on server) */
  name: string
}

function parseFeaturedRooms(raw: string): { id: string; blurb: string }[] {
  const blocks = raw.split(/!next!/i)
  const out: { id: string; blurb: string }[] = []
  for (const block of blocks) {
    const lines = block
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0)
    if (lines.length >= 1) {
      out.push({
        id: lines[0],
        // Line 2+ kept as the manual blurb from the txt
        blurb: lines.slice(1).join(' ').trim() || ''
      })
    }
  }
  return out.slice(0, 3)
}


function useHeroImages(): string[] {
  const [images, setImages] = useState<string[]>([
    '/hero-images/homepage-hero.png',
    '/hero-images/homie.png',
    '/hero-images/background.png',
    '/hero-images/webman.png'
  ])

  useEffect(() => {
    const extrasRaw = localStorage.getItem('collab-hero-extra') || ''
    const extras = extrasRaw
      .split(',')
      .map((s) => s.trim())
      .filter((s) => HERO_EXTS.test(s))
      .map((s) => (s.startsWith('/') ? s : `/hero-images/${s}`))
    const base = [
      '/hero-images/homepage-hero.png',
      '/hero-images/homie.png',
      '/hero-images/background.png',
      '/hero-images/webman.png',
      ...extras
    ]
    const unique = Array.from(new Set(base))
    let cancelled = false
    ;(async () => {
      const ok: string[] = []
      await Promise.all(
        unique.map(
          (src) =>
            new Promise<void>((resolve) => {
              const img = new Image()
              img.onload = () => {
                ok.push(src)
                resolve()
              }
              img.onerror = () => resolve()
              img.src = src
            })
        )
      )
      if (!cancelled && ok.length) setImages(ok)
    })()
    return () => {
      cancelled = true
    }
  }, [])

  return images
}

function pickHero(images: string[]): string {
  if (!images.length) return '/hero-images/homepage-hero.png'
  let seed = 0
  try {
    const key = 'collab-hero-seed'
    const existing = sessionStorage.getItem(key)
    if (existing) seed = parseInt(existing, 10) || 0
    else {
      seed = Math.floor(Math.random() * 100000)
      sessionStorage.setItem(key, String(seed))
    }
  } catch {
    seed = Date.now()
  }
  return images[Math.abs(seed) % images.length]
}

function useCountUp(target: number, active: boolean, duration = 1600) {
  const [value, setValue] = useState(0)
  useEffect(() => {
    if (!active) return
    let start: number | null = null
    let raf = 0
    const tick = (ts: number) => {
      if (start == null) start = ts
      const p = Math.min(1, (ts - start) / duration)
      const eased = 1 - Math.pow(1 - p, 3)
      setValue(Math.round(target * eased))
      if (p < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [target, active, duration])
  return value
}

function RoomListPager({
  rooms,
  label,
  icon,
  userId,
  onOpen,
  emptyText,
  badgeNewIds
}: {
  rooms: RoomMeta[]
  label: string
  icon: string
  userId?: string
  onOpen: (id: string) => void
  emptyText: string
  badgeNewIds?: Set<string>
}) {
  const [open, setOpen] = useState(true)
  const [page, setPage] = useState(0)
  const totalPages = Math.max(1, Math.ceil(rooms.length / PAGE_SIZE))
  const slice = rooms.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE)

  useEffect(() => {
    if (page > totalPages - 1) setPage(Math.max(0, totalPages - 1))
  }, [rooms.length, page, totalPages])

  return (
    <div className="rounded-xl border" style={{ borderColor: 'var(--line)', background: 'var(--surface-2)' }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left transition-colors hover:bg-[var(--surface-3)]"
      >
        <span
          className="flex h-7 w-7 items-center justify-center rounded-lg text-[12px]"
          style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}
        >
          <i className={`fa-solid ${icon}`} />
        </span>
        <span className="flex-1 text-[13px] font-semibold text-ink">{label}</span>
        <span className="text-[11px] text-ink-faint">{rooms.length}</span>
        <i className={`fa-solid ${open ? 'fa-chevron-up' : 'fa-chevron-down'} text-[10px] text-ink-faint`} />
      </button>
      {open && (
        <div className="border-t px-2 pb-2 pt-1" style={{ borderColor: 'var(--line)' }}>
          {slice.length === 0 ? (
            <p className="px-2 py-3 text-[12px] text-ink-faint">{emptyText}</p>
          ) : (
            <ul className="space-y-0.5">
              {slice.map((r) => (
                <li key={r.id}>
                  <button
                    type="button"
                    onClick={() => onOpen(r.id)}
                    className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-[var(--surface-3)]"
                  >
                    <i
                      className={`fa-solid ${r.isPublic ? 'fa-globe' : 'fa-lock'} text-[10px] text-ink-faint`}
                    />
                    <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink">
                      {r.description || <span className="italic text-ink-faint">Untitled</span>}
                    </span>
                    {badgeNewIds?.has(r.id) && (
                      <span
                        className="rounded px-1.5 py-0.5 text-[9px] font-semibold text-white"
                        style={{ background: 'var(--accent)' }}
                      >
                        New invite
                      </span>
                    )}
                    {userId && getRememberedPassword(userId, r.id) ? (
                      <i className="fa-solid fa-key text-[9px] text-ink-faint" title="Saved password" />
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {rooms.length > PAGE_SIZE && (
            <div className="mt-1 flex items-center justify-between px-1 pt-1">
              <button
                type="button"
                disabled={page === 0}
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                className="icon-btn h-7 w-7 disabled:opacity-30"
                aria-label="Previous page"
              >
                <i className="fa-solid fa-chevron-left text-[11px]" />
              </button>
              <span className="text-[11px] text-ink-faint">
                {page + 1} / {totalPages}
              </span>
              <button
                type="button"
                disabled={page >= totalPages - 1}
                onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                className="icon-btn h-7 w-7 disabled:opacity-30"
                aria-label="Next page"
              >
                <i className="fa-solid fa-chevron-right text-[11px]" />
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default function Home() {
  const { user, loading, logout } = useAuth()
  const { theme, toggle } = useTheme()
  const navigate = useNavigate()
  const [showAuth, setShowAuth] = useState<'signin' | 'signup' | null>(null)
  const [description, setDescription] = useState('')
  const [isPublic, setIsPublic] = useState(false)
  const [template, setTemplate] = useState<TemplateId>('html')
  const [rooms, setRooms] = useState<RoomMeta[]>([])
  const [recent, setRecent] = useState<RoomMeta[]>([])
  const [searchQ, setSearchQ] = useState('')
  const [searchResults, setSearchResults] = useState<RoomMeta[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [joinId, setJoinId] = useState('')
  const [joinPwd, setJoinPwd] = useState('')
  const [joinDisplayName, setJoinDisplayName] = useState('')
  const [joinMode, setJoinMode] = useState<'id' | 'link'>('id')
  const [overlay, setOverlay] = useState<OverlayKind>(null)
  const [statsVisible, setStatsVisible] = useState(false)
  const [editorial, setEditorial] = useState<EditorialRoom[]>([])
  const [featured, setFeatured] = useState<FeaturedRoom[]>([])
  const [pickedRoom, setPickedRoom] = useState<{
    id: string
    description?: string
    source: 'owned' | 'recent' | 'editorial' | 'featured'
    roomPwd?: string
    isNew?: boolean
  } | null>(null)
  const statsRef = useRef<HTMLDivElement>(null)
  const heroImages = useHeroImages()
  const heroSrc = useMemo(() => pickHero(heroImages), [heroImages])

  const c1 = useCountUp(1280, statsVisible, 2400)
  const c2 = useCountUp(46, statsVisible, 2400)
  const c3 = useCountUp(99, statsVisible, 2400)

  useEffect(() => {
    if (user?.displayName) setJoinDisplayName(user.displayName)
  }, [user?.displayName])

  useEffect(() => {
    if (!user) {
      setRooms([])
      setRecent([])
      setEditorial([])
      return
    }
    listMyRooms().then((r) => {
      if (r.rooms) setRooms(r.rooms)
    })
    listRecentRooms().then((r) => {
      if (r.rooms) setRecent(r.rooms)
    })
    listEditorialRooms().then((r) => {
      if (r.rooms) setEditorial(r.rooms)
    })
  }, [user])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/featured-rooms.txt')
        const txt = res.ok ? await res.text() : ''
        const parsed = parseFeaturedRooms(txt || '')
        const resolved: FeaturedRoom[] = []
        for (const item of parsed) {
          const id = item.id.trim()
          if (!id) continue
          const meta = await getRoomMeta(id)
          if (cancelled) return
          // Only keep rooms whose id exists
          if (meta.room && meta.room.id) {
            const name = (meta.room.description || '').trim() || meta.room.id
            resolved.push({
              id: meta.room.id,
              name,
              blurb: item.blurb // keep line 2+ text from the txt file
            })
          }
        }
        if (!cancelled) setFeatured(resolved)
      } catch {
        if (!cancelled) setFeatured([])
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!searchQ.trim()) {
      setSearchResults(null)
      return
    }
    const t = window.setTimeout(() => {
      searchRooms(searchQ.trim()).then((r) => {
        if (r.rooms) setSearchResults(r.rooms)
      })
    }, 200)
    return () => window.clearTimeout(t)
  }, [searchQ])

  useEffect(() => {
    const el = statsRef.current
    if (!el) return
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) setStatsVisible(true)
      },
      { threshold: 0.25 }
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])

  useEffect(() => {
    const nodes = Array.from(document.querySelectorAll('.home-reveal'))
    if (!nodes.length) return
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-visible')
            io.unobserve(entry.target)
          }
        })
      },
      { threshold: 0.18, rootMargin: '0px 0px -8% 0px' }
    )
    nodes.forEach((n) => io.observe(n))
    return () => io.disconnect()
  }, [user, featured.length, rooms.length])

  const navigateToRoom = (roomId: string, pwd?: string, asReadonly = false) => {
    const local = user?.id ? getRememberedPassword(user.id, roomId) : ''
    const usePwd = asReadonly ? '' : pwd || local
    try {
      sessionStorage.setItem(
        `collab-autojoin:${roomId}`,
        JSON.stringify({
          readonly: asReadonly || !usePwd,
          pwd: usePwd || '',
          name: user?.displayName || ''
        })
      )
    } catch {
      /* ignore */
    }
    const qs = usePwd ? `?pwd=${encodeURIComponent(usePwd)}` : ''
    navigate(`/room/${roomId}${qs}`)
  }

  const openRoom = (roomId: string) => navigateToRoom(roomId)

  const openWorkspaceRoom = (
    r: { id: string; description?: string; roomPwd?: string | null; isNew?: boolean },
    source: 'owned' | 'recent' | 'editorial' | 'featured'
  ) => {
    setPickedRoom({
      id: r.id,
      description: r.description || '',
      source,
      roomPwd: r.roomPwd || undefined,
      isNew: !!r.isNew
    })
    setOverlay('room')
    if (r.isNew && user) {
      void markAccessSeen(r.id)
      setEditorial((prev) => prev.map((x) => (x.id === r.id ? { ...x, isNew: false } : x)))
    }
  }

  const createRoom = async () => {
    setError('')
    const desc = description.trim().slice(0, 50)
    setBusy(true)
    try {
      const roomId = nanoid()
      const pwd = nanoid(8)
      const view = nanoid(12)
      const meta = await createRoomMeta(roomId, desc, isPublic)
      if (meta.error) console.warn('createRoomMeta:', meta.error)
      try {
        sessionStorage.setItem(`collab-template:${roomId}`, template)
        sessionStorage.setItem(`collab-desc:${roomId}`, desc)
        sessionStorage.setItem(`collab-public:${roomId}`, isPublic ? '1' : '0')
      } catch {
        /* ignore */
      }
      try {
        sessionStorage.setItem(
          `collab-autojoin:${roomId}`,
          JSON.stringify({
            readonly: false,
            pwd,
            name: user?.displayName || joinDisplayName || ''
          })
        )
      } catch {
        /* ignore */
      }
      navigate(`/room/${roomId}?pwd=${pwd}&view=${view}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create room')
    } finally {
      setBusy(false)
    }
  }

  const joinById = () => {
    const id = joinId.trim()
    if (!id) return
    const name = joinDisplayName.trim() || user?.displayName || ''
    const pwd = joinPwd.trim()
    const stash = (roomId: string, search: string) => {
      try {
        const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search)
        const urlPwd = params.get('pwd') || pwd
        sessionStorage.setItem(
          `collab-autojoin:${roomId}`,
          JSON.stringify({
            readonly: !urlPwd,
            pwd: urlPwd || '',
            name
          })
        )
      } catch {
        /* ignore */
      }
    }
    if (joinMode === 'link' || id.includes('/room/') || id.startsWith('http')) {
      try {
        if (id.includes('/room/')) {
          const u = new URL(id, window.location.origin)
          const roomId = u.pathname.split('/room/')[1]?.split('/')[0] || ''
          if (roomId) stash(roomId, u.search)
          navigate(u.pathname + u.search)
          return
        }
      } catch {
        /* fall through */
      }
    }
    stash(id, pwd ? `?pwd=${encodeURIComponent(pwd)}` : '')
    const qs = pwd ? `?pwd=${encodeURIComponent(pwd)}` : ''
    navigate(`/room/${encodeURIComponent(id)}${qs}`)
  }

  const fieldStyle = {
    background: 'var(--surface-2)',
    borderColor: 'var(--line)',
    color: 'var(--ink)'
  } as const

  const cardStyle = {
    background: 'var(--surface-1)',
    borderColor: 'var(--line)'
  } as const

  const closeOverlay = () => {
    setOverlay(null)
    setError('')
  }

  return (
    <div className="relative flex min-h-screen flex-col text-ink" style={{ background: 'var(--surface-0)' }}>
      {/* Ambient tech grid / glow — theme aware */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
        <div
          className="absolute inset-0 opacity-[0.35] dark:opacity-[0.5]"
          style={{
            backgroundImage: `
              linear-gradient(var(--line) 1px, transparent 1px),
              linear-gradient(90deg, var(--line) 1px, transparent 1px)
            `,
            backgroundSize: '48px 48px',
            maskImage: 'radial-gradient(ellipse 80% 60% at 50% 20%, black 20%, transparent 75%)'
          }}
        />
        <div
          className="home-orb absolute -left-24 top-40 h-72 w-72 rounded-full blur-3xl"
          style={{ background: 'var(--accent-soft)' }}
        />
        <div
          className="home-orb-delayed absolute -right-16 top-[520px] h-64 w-64 rounded-full blur-3xl"
          style={{ background: 'var(--accent-soft)' }}
        />
      </div>

      {/* ── Header (intact) ── */}
      <header
        className="relative z-10 flex items-center justify-between border-b px-6 py-3.5"
        style={{ borderColor: 'var(--line)', background: 'var(--surface-1)' }}
      >
        <div className="flex items-center gap-3">
          <BrandLogo />
          <span className="text-xs text-ink-faint"> a CISTECH workspace</span>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <div className="tooltip-wrap">
            <button
              type="button"
              onClick={toggle}
              className="icon-btn h-8 w-8"
              aria-label={theme === 'dark' ? 'Light mode' : 'Dark mode'}
            >
              <i className={`fa-solid ${theme === 'dark' ? 'fa-sun' : 'fa-moon'} text-[13px]`} />
            </button>
            <span className="tooltip">{theme === 'dark' ? 'Light mode' : 'Dark mode'}</span>
          </div>
          {loading ? (
            <span className="text-xs text-ink-faint">…</span>
          ) : user ? (
            <>
              <span className="flex items-center gap-2 text-xs text-ink-soft">
                {user.color && (
                  <span
                    className="inline-block h-3 w-3 rounded-full"
                    style={{ backgroundColor: user.color }}
                  />
                )}
                {user.displayName}
                <span className="text-ink-faint">({user.email})</span>
              </span>
              <button
                type="button"
                onClick={() => void logout()}
                className="rounded-lg border px-3 py-1.5 text-xs text-ink-muted transition-colors hover:bg-[var(--surface-3)]"
                style={{ borderColor: 'var(--line)' }}
              >
                Sign out
              </button>
            </>
          ) : (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setShowAuth('signin')}
                className="rounded-lg border px-3.5 py-1.5 text-xs font-medium text-ink-muted transition-colors hover:bg-[var(--surface-3)]"
                style={{ borderColor: 'var(--line)' }}
              >
                Sign in
              </button>
              <button
                type="button"
                onClick={() => setShowAuth('signup')}
                className="rounded-lg px-3.5 py-1.5 text-xs font-medium text-white"
                style={{ background: 'var(--accent)' }}
              >
                Sign up
              </button>
            </div>
          )}
        </div>
      </header>

      {/* ── Hero (intact) ── */}
      <section className="relative z-10 overflow-hidden border-b" style={{ borderColor: 'var(--line)' }}>
        <div className="absolute inset-0">
          <img
            src={heroSrc}
            alt=""
            className="h-full w-full object-cover"
            style={{ minHeight: 280, maxHeight: 360 }}
          />
          <div
            className="absolute inset-0"
            style={{
              background:
                'linear-gradient(to right, rgba(10,10,12,0.88) 0%, rgba(10,10,12,0.55) 55%, rgba(10,10,12,0.25) 100%)'
            }}
          />
        </div>
        <div className="relative mx-auto flex max-w-5xl flex-col gap-4 px-6 py-14 md:py-16">
          <h1 className="font-mono text-3xl font-semibold tracking-tight md:text-4xl">
            <span className="text-brand">{'</'}</span>
            <span className="text-white">Collab</span>
            <span className="text-white/55">Editor</span>
            <span className="text-brand">{'>'}</span>
          </h1>
          <p className="max-w-xl text-sm leading-relaxed text-white/95 md:text-base">
            A better way for teams to build together.
          </p>
          <p className="max-w-lg text-xs text-white/80">
            Work on code in real time, see every change as it happens, and stay connected from first idea to final release.
          </p>
          <div className="mt-1 flex flex-wrap gap-2">
            {!user && (
              <>
                <button
                  type="button"
                  onClick={() => setShowAuth('signup')}
                  className="rounded-lg px-4 py-2 text-sm font-medium text-white"
                  style={{ background: 'var(--accent)' }}
                >
                  Get started free
                </button>
                <button
                  type="button"
                  onClick={() => setShowAuth('signin')}
                  className="rounded-lg border border-white/25 bg-white/10 px-4 py-2 text-sm font-medium text-white backdrop-blur transition hover:bg-white/15"
                >
                  Sign in
                </button>
              </>
            )}
          </div>
        </div>
      </section>

      {/* ── Logged-in: rooms + image ── */}
      {user && (
        <section className="relative z-10 mx-auto w-full max-w-5xl px-4 py-10 md:px-6">
          <div className="home-grid-2">
            <div
              className="flex flex-col gap-3 rounded-2xl border p-4 md:p-5"
              style={cardStyle}
            >
              <div className="mb-1 flex items-center gap-2">
                <span className="flex -space-x-1.5">
                  {['fa-folder', 'fa-clock-rotate-left', 'fa-code'].map((ic) => (
                    <span
                      key={ic}
                      className="flex h-7 w-7 items-center justify-center rounded-full border text-[11px]"
                      style={{
                        background: 'var(--surface-2)',
                        borderColor: 'var(--line)',
                        color: 'var(--accent)'
                      }}
                    >
                      <i className={`fa-solid ${ic}`} />
                    </span>
                  ))}
                </span>
                <div>
                  <div className="text-sm font-semibold text-ink">Your workspace</div>
                  <div className="text-[11px] text-ink-faint">Owned & recent rooms</div>
                </div>
              </div>
              <RoomListPager
                rooms={rooms}
                label="Your rooms"
                icon="fa-crown"
                userId={user.id}
                onOpen={(id) => {
                  const r = rooms.find((x) => x.id === id)
                  openWorkspaceRoom({ id, description: r?.description }, 'owned')
                }}
                emptyText="No owned rooms yet — create one below."
              />
              <RoomListPager
                rooms={recent}
                label="Recent rooms"
                icon="fa-clock-rotate-left"
                userId={user.id}
                onOpen={(id) => {
                  const r = recent.find((x) => x.id === id)
                  openWorkspaceRoom({ id, description: r?.description }, 'recent')
                }}
                emptyText="Rooms you visit will show up here."
              />
              <RoomListPager
                rooms={editorial.map((e) => ({
                  id: e.id,
                  description: e.description,
                  isPublic: e.isPublic,
                  ownerId: e.ownerId ?? null,
                  ownerName: e.ownerName ?? null,
                  createdAt: 0,
                  updatedAt: e.updatedAt ?? 0
                }))}
                label="Editor access"
                icon="fa-user-pen"
                userId={user.id}
                onOpen={(id) => {
                  const r = editorial.find((x) => x.id === id)
                  openWorkspaceRoom(
                    { id, description: r?.description, roomPwd: r?.roomPwd, isNew: r?.isNew },
                    'editorial'
                  )
                }}
                emptyText="Rooms shared with you as an editor appear here."
                badgeNewIds={new Set(editorial.filter((e) => e.isNew).map((e) => e.id))}
              />
            </div>

            <div
              className="flex flex-col overflow-hidden rounded-2xl border"
              style={{ borderColor: 'var(--line)', background: 'var(--surface-1)' }}
            >
              <div className="relative aspect-video w-full bg-[var(--surface-2)]">
                <img
                  src="/images/collab-tab.webp"
                  alt="Collaborative editor tabs"
                  className="h-full w-full object-cover"
                  onError={(e) => {
                    ;(e.target as HTMLImageElement).style.display = 'none'
                  }}
                />
              </div>
              {featured.length > 0 && (
                <div className="border-t p-3" style={{ borderColor: 'var(--line)' }}>
                  <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
                    Featured
                  </div>
                  <ul className="space-y-2">
                    {featured.map((f) => (
                      <li key={f.id}>
                        <button
                          type="button"
                          onClick={() =>
                            openWorkspaceRoom(
                              {
                                id: f.id,
                                description: f.name
                              },
                              'featured'
                            )
                          }
                          className="w-full rounded-lg border px-3 py-2 text-left transition-colors hover:bg-[var(--surface-3)]"
                          style={{ borderColor: 'var(--line)' }}
                        >
                          <div className="truncate text-[13px] font-medium text-ink">
                            {f.name}
                          </div>
                          {f.blurb ? (
                            <div className="mt-0.5 line-clamp-2 text-[11px] text-ink-soft">
                              {f.blurb}
                            </div>
                          ) : null}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>
        </section>
      )}

      {/* ── Stats counters (everyone) ── */}
      <section
        ref={statsRef}
        className="relative z-10 border-y px-4 py-12"
        style={{ borderColor: 'var(--line)', background: 'var(--surface-1)' }}
      >
        <div className="home-grid-3 mx-auto max-w-5xl">
          {[
            { icon: 'fa-bolt', value: c1, suffix: '+', label: 'Live sessions spun up' },
            { icon: 'fa-users', value: c2, suffix: 'k', label: 'Collaborators connected' },
            { icon: 'fa-code-branch', value: c3, suffix: '%', label: 'Changes synced in real time' }
          ].map((s) => (
            <div
              key={s.label}
              className="flex flex-col items-center gap-2 rounded-2xl border px-4 py-6 text-center"
              style={cardStyle}
            >
              <span
                className="flex h-10 w-10 items-center justify-center rounded-xl text-[16px]"
                style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}
              >
                <i className={`fa-solid ${s.icon}`} />
              </span>
              <div className="font-mono text-3xl font-semibold tracking-tight text-ink">
                {s.value}
                <span className="text-brand">{s.suffix}</span>
              </div>
              <p className="max-w-[12rem] text-[12px] text-ink-soft">{s.label}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Group image + action card ── */}
      <section className="relative z-10 mx-auto w-full max-w-5xl px-4 py-14 md:px-6">
        <div className="home-grid-2 home-grid-2-center">
          <div
            className="overflow-hidden rounded-2xl border"
            style={{ borderColor: 'var(--line)', background: 'var(--surface-1)' }}
          >
            <div className="relative aspect-video w-full bg-[var(--surface-2)]">
              <img
                src="/images/collab-group.webp"
                alt="Team collaborating"
                className="h-full w-full object-cover"
                onError={(e) => {
                  ;(e.target as HTMLImageElement).style.display = 'none'
                }}
              />
            </div>
          </div>

          <div className="rounded-2xl border p-5 md:p-6" style={cardStyle}>
            <div className="mb-4 flex items-center gap-2">
              <span className="flex -space-x-1.5">
                {['fa-right-to-bracket', 'fa-magnifying-glass', 'fa-plus'].map((ic) => (
                  <span
                    key={ic}
                    className="flex h-7 w-7 items-center justify-center rounded-full border text-[11px]"
                    style={{
                      background: 'var(--surface-2)',
                      borderColor: 'var(--line)',
                      color: 'var(--accent)'
                    }}
                  >
                    <i className={`fa-solid ${ic}`} />
                  </span>
                ))}
              </span>
              <div>
                <div className="text-sm font-semibold text-ink">Get into a room</div>
                <div className="text-[11px] text-ink-faint">Join, discover, or start fresh</div>
              </div>
            </div>

            <div className="space-y-2">
              {(
                [
                  {
                    kind: 'join' as const,
                    icon: 'fa-right-to-bracket',
                    title: 'Join a room',
                    desc: 'Enter a room id or paste an invite link'
                  },
                  {
                    kind: 'search' as const,
                    icon: 'fa-magnifying-glass',
                    title: 'Find public rooms',
                    desc: 'Search discoverable workspaces by title or id'
                  },
                  {
                    kind: 'create' as const,
                    icon: 'fa-plus',
                    title: 'Create a room',
                    desc: 'Spin up a live workspace with a template'
                  }
                ] as const
              ).map((item) => (
                <button
                  key={item.kind}
                  type="button"
                  onClick={() => setOverlay(item.kind)}
                  className="flex w-full items-center gap-3 rounded-xl border px-3.5 py-3 text-left transition-colors hover:bg-[var(--surface-3)]"
                  style={{ borderColor: 'var(--line)' }}
                >
                  <span
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-[13px]"
                    style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}
                  >
                    <i className={`fa-solid ${item.icon}`} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13px] font-semibold text-ink">{item.title}</span>
                    <span className="block text-[11px] text-ink-faint">{item.desc}</span>
                  </span>
                  <i className="fa-solid fa-chevron-right text-[10px] text-ink-faint" />
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Feature story — 1 column, scroll-reveal */}
      <section className="relative z-10 mx-auto w-full max-w-5xl px-4 py-16 md:px-6">
        <div className="home-reveal rounded-2xl border p-8 md:p-10" style={cardStyle}>
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-brand">Why CollabEditor</p>
          <h2 className="mb-4 max-w-2xl text-2xl font-semibold tracking-tight text-ink md:text-3xl">
            Build in the same room, not in separate threads
          </h2>
          <p className="max-w-2xl text-sm leading-relaxed text-ink-soft md:text-[15px]">
            Most tools treat collaboration as an afterthought — comments on a finished file,
            or merges after the fact. CollabEditor puts everyone in one live workspace:
            the same files, the same preview, the same conversation. Changes appear as they
            happen, so teams stay aligned from first sketch to ship-ready code without the
            usual handoff friction.
          </p>
        </div>
      </section>

      {/* Feature grid — 3 columns, scroll-reveal */}
      <section className="relative z-10 mx-auto w-full max-w-5xl px-4 pb-8 md:px-6">
        <div className="home-grid-3">
          {[
            {
              img: '/images/feature-live.webp',
              title: 'Live by default',
              body: 'Edits sync the moment they land. Cursors, presence, and preview stay in lockstep so nobody works on a stale copy.'
            },
            {
              img: '/images/feature-rooms.webp',
              title: 'Rooms that fit the work',
              body: 'Private for sensitive builds, public when you want discovery. Invite editors by email or share a read-only link in one click.'
            },
            {
              img: '/images/feature-voice.webp',
              title: 'Talk where you code',
              body: 'Messages, DMs, and voice sit beside the editor — context stays with the project instead of scattered across apps.'
            }
          ].map((f) => (
            <article
              key={f.title}
              className="home-reveal flex flex-col overflow-hidden rounded-2xl border"
              style={cardStyle}
            >
              <div className="aspect-[16/10] w-full bg-[var(--surface-2)]">
                <img
                  src={f.img}
                  alt=""
                  className="h-full w-full object-cover"
                  onError={(e) => {
                    ;(e.target as HTMLImageElement).style.display = 'none'
                  }}
                />
              </div>
              <div className="flex flex-1 flex-col gap-2 p-5">
                <h3 className="text-[15px] font-semibold text-ink">{f.title}</h3>
                <p className="text-[13px] leading-relaxed text-ink-soft">{f.body}</p>
              </div>
            </article>
          ))}
        </div>
      </section>

      <div className="relative z-10" style={{ marginTop: 100, marginBottom: 100 }}>
        <Footer />
      </div>

      {/* Overlay panels */}
      {overlay && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(8px)' }}
          onClick={closeOverlay}
        >
          <div
            className="w-full max-w-md rounded-2xl border p-5 shadow-dropdown"
            style={{ background: 'var(--surface-1)', borderColor: 'var(--line)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-ink">
                {overlay === 'join' && 'Join a room'}
                {overlay === 'search' && 'Find public rooms'}
                {overlay === 'create' && 'Create a room'}
              </h2>
              <button type="button" className="icon-btn h-8 w-8" onClick={closeOverlay} aria-label="Close">
                <i className="fa-solid fa-xmark text-[13px]" />
              </button>
            </div>

            
            {overlay === 'room' && pickedRoom && (
              <div className="space-y-3">
                <div>
                  <div className="text-sm font-semibold text-ink">
                    {(pickedRoom.description || 'Untitled room') + ' — ' + pickedRoom.id}
                  </div>
                  {pickedRoom.description && (
                    <p className="mt-1 text-[12px] text-ink-soft">{pickedRoom.description}</p>
                  )}
                  <p className="mt-1 font-mono text-[11px] text-ink-faint">{pickedRoom.id}</p>
                  {pickedRoom.isNew && (
                    <span
                      className="mt-2 inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold text-white"
                      style={{ background: 'var(--accent)' }}
                    >
                      New invite
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-ink-faint">
                  {pickedRoom.source === 'owned'
                    ? 'You own this room — open as editor without re-entering the password when it is saved on your account.'
                    : pickedRoom.source === 'editorial'
                    ? 'You have editor access. Open with the shared password, or view read-only.'
                    : 'Open with a saved password as editor, or continue read-only without one.'}
                </p>
                <button
                  type="button"
                  onClick={() => {
                    // Owned / editor-access / saved pwd → editor; else still try editor path with any saved pwd
                    navigateToRoom(pickedRoom.id, pickedRoom.roomPwd, false)
                    closeOverlay()
                  }}
                  className="w-full rounded-lg py-2.5 text-sm font-medium text-white"
                  style={{ background: 'var(--accent)' }}
                >
                  {pickedRoom.source === 'owned' || pickedRoom.roomPwd || (user?.id && getRememberedPassword(user.id, pickedRoom.id))
                    ? 'Open as editor'
                    : 'Open room'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    navigateToRoom(pickedRoom.id, undefined, true)
                    closeOverlay()
                  }}
                  className="w-full rounded-lg border py-2.5 text-sm font-medium text-ink-muted"
                  style={{ borderColor: 'var(--line)' }}
                >
                  Open read-only
                </button>
              </div>
            )}

            {overlay === 'join' && (
              <div className="space-y-3">
                <div
                  className="flex gap-1 rounded-lg border p-0.5"
                  style={{ borderColor: 'var(--line)', background: 'var(--surface-2)' }}
                >
                  <button
                    type="button"
                    onClick={() => setJoinMode('id')}
                    className="flex-1 rounded-md py-1.5 text-xs font-medium transition-colors"
                    style={{
                      background: joinMode === 'id' ? 'var(--surface-1)' : 'transparent',
                      color: joinMode === 'id' ? 'var(--ink)' : 'var(--ink-soft)'
                    }}
                  >
                    Room ID
                  </button>
                  <button
                    type="button"
                    onClick={() => setJoinMode('link')}
                    className="flex-1 rounded-md py-1.5 text-xs font-medium transition-colors"
                    style={{
                      background: joinMode === 'link' ? 'var(--surface-1)' : 'transparent',
                      color: joinMode === 'link' ? 'var(--ink)' : 'var(--ink-soft)'
                    }}
                  >
                    Invite link
                  </button>
                </div>
                <input
                  className="w-full rounded-lg border px-3 py-2.5 text-sm outline-none focus:border-[var(--accent)]"
                  style={fieldStyle}
                  placeholder="Display name"
                  value={joinDisplayName}
                  onChange={(e) => setJoinDisplayName(e.target.value)}
                />
                <input
                  className="w-full rounded-lg border px-3 py-2.5 text-sm outline-none focus:border-[var(--accent)]"
                  style={fieldStyle}
                  placeholder={joinMode === 'link' ? 'Paste full invite link…' : 'Enter room id…'}
                  value={joinId}
                  onChange={(e) => setJoinId(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') joinById()
                  }}
                />
                {joinMode === 'id' && (
                  <PasswordInput
                    placeholder="Room password (optional — leave blank for read-only)"
                    value={joinPwd}
                    onChange={setJoinPwd}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') joinById()
                    }}
                  />
                )}
                <p className="text-[11px] text-ink-faint">
                  Without the password you join in read-only mode.
                </p>
                <button
                  type="button"
                  onClick={joinById}
                  className="w-full rounded-lg py-2.5 text-sm font-medium text-white"
                  style={{ background: 'var(--accent)' }}
                >
                  Join room
                </button>
              </div>
            )}

            {overlay === 'search' && (
              <div className="space-y-3">
                <div className="relative">
                  <i className="fa-solid fa-magnifying-glass pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[12px] text-ink-faint" />
                  <input
                    className="w-full rounded-lg border py-2.5 pl-9 pr-3 text-sm outline-none focus:border-[var(--accent)]"
                    style={fieldStyle}
                    placeholder="Search by title or room id…"
                    value={searchQ}
                    onChange={(e) => setSearchQ(e.target.value)}
                    autoFocus
                  />
                </div>
                <p className="text-[11px] text-ink-faint">
                  Only public rooms appear here. Editing still needs the room password.
                </p>
                {searchResults && (
                  <ul className="max-h-56 space-y-1 overflow-y-auto">
                    {searchResults.length === 0 ? (
                      <li className="px-2 text-xs text-ink-faint">No public matches</li>
                    ) : (
                      searchResults.map((r) => (
                        <li key={r.id}>
                          <button
                            type="button"
                            onClick={() => openRoom(r.id)}
                            className="w-full rounded-lg border border-transparent px-3 py-2.5 text-left transition-colors hover:border-[var(--line)] hover:bg-[var(--surface-3)]"
                          >
                            <div className="flex items-center gap-2 truncate text-sm font-medium text-ink">
                              <i
                                className={`fa-solid ${r.isPublic ? 'fa-globe' : 'fa-lock'} text-[10px] text-ink-faint`}
                              />
                              {r.description || (
                                <span className="italic text-ink-faint">No description</span>
                              )}
                            </div>
                            <div className="mt-0.5 font-mono text-[10px] text-ink-faint">{r.id}</div>
                          </button>
                        </li>
                      ))
                    )}
                  </ul>
                )}
              </div>
            )}

            {overlay === 'create' && (
              <div className="space-y-3">
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-ink-muted">
                    Room title <span className="text-ink-faint">(max 50)</span>
                  </label>
                  <input
                    className="w-full rounded-lg border px-3 py-2.5 text-sm outline-none focus:border-[var(--accent)]"
                    style={fieldStyle}
                    value={description}
                    onChange={(e) => setDescription(e.target.value.slice(0, 50))}
                    placeholder="e.g. Landing page draft"
                    maxLength={50}
                  />
                </div>
                <div
                  className="flex items-center justify-between gap-3 rounded-xl border px-3 py-2.5"
                  style={{ borderColor: 'var(--line)' }}
                >
                  <div>
                    <div className="text-xs font-medium text-ink">
                      {isPublic ? 'Public room' : 'Private room'}
                    </div>
                    <div className="text-[11px] text-ink-faint">
                      {isPublic ? 'Discoverable in search' : 'Invite-only · default'}
                    </div>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={isPublic}
                    onClick={() => setIsPublic((v) => !v)}
                    className="relative h-6 w-11 shrink-0 rounded-full transition-colors"
                    style={{ background: isPublic ? 'var(--accent)' : 'var(--surface-3)' }}
                  >
                    <span
                      className="absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform"
                      style={{ left: isPublic ? 22 : 2 }}
                    />
                  </button>
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-ink-muted">Template</label>
                  <div className="grid max-h-40 grid-cols-1 gap-1.5 overflow-y-auto">
                    {ROOM_TEMPLATES.map((tpl) => {
                      const active = template === tpl.id
                      return (
                        <button
                          key={tpl.id}
                          type="button"
                          onClick={() => setTemplate(tpl.id)}
                          className="rounded-xl border px-3 py-2 text-left text-sm transition-colors"
                          style={{
                            borderColor: active ? 'var(--accent)' : 'var(--line)',
                            background: active ? 'var(--accent-soft)' : 'transparent',
                            color: 'var(--ink)'
                          }}
                        >
                          <div className="font-medium">{tpl.name}</div>
                          <div className="text-[11px] text-ink-soft">{tpl.description}</div>
                        </button>
                      )
                    })}
                  </div>
                </div>
                {error && (
                  <p className="text-xs" style={{ color: 'var(--danger)' }}>
                    {error}
                  </p>
                )}
                <button
                  type="button"
                  onClick={() => void createRoom()}
                  disabled={busy}
                  className="w-full rounded-lg py-2.5 text-sm font-medium text-white disabled:opacity-50"
                  style={{ background: 'var(--accent)' }}
                >
                  {busy ? 'Creating…' : 'Create room'}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {showAuth && <AuthModal onClose={() => setShowAuth(null)} initialMode={showAuth} />}

      <style>{`
        @keyframes home-orb-float {
          0%, 100% { transform: translate(0, 0); opacity: 0.7; }
          50% { transform: translate(12px, -18px); opacity: 1; }
        }
        .home-orb { animation: home-orb-float 12s ease-in-out infinite; }
        .home-orb-delayed { animation: home-orb-float 16s ease-in-out infinite reverse; }

        .home-grid-2 {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 1.25rem;
          align-items: stretch;
        }
        .home-grid-2-center { align-items: center; }
        .home-grid-3 {
          display: grid;
          grid-template-columns: 1fr 1fr 1fr;
          gap: 1.5rem;
        }
        @media (max-width: 767px) {
          .home-grid-2,
          .home-grid-3 {
            grid-template-columns: 1fr;
          }
        }

        .home-reveal {
          opacity: 0;
          transform: translateY(28px);
          transition: opacity 1.1s ease, transform 1.1s ease;
        }
        .home-reveal.is-visible {
          opacity: 1;
          transform: translateY(0);
        }
        .home-orb { animation-duration: 18s; }
        .home-orb-delayed { animation-duration: 24s; }
      `}</style>
    </div>
  )
}
