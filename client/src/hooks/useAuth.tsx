import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode
} from 'react'
import {
  AuthUser,
  fetchMe,
  logout as apiLogout,
  signin as apiSignin,
  signup as apiSignup,
  updateMe
} from '../lib/api'

interface AuthContextValue {
  user: AuthUser | null
  loading: boolean
  signin: (email: string, password: string) => Promise<string | null>
  signup: (email: string, password: string, displayName: string) => Promise<string | null>
  logout: () => Promise<void>
  refresh: () => Promise<void>
  setDisplayName: (name: string) => Promise<string | null>
  setProfile: (patch: { displayName?: string; color?: string }) => Promise<string | null>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    const r = await fetchMe()
    setUser(r.user || null)
  }, [])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      const r = await fetchMe()
      if (!cancelled) {
        setUser(r.user || null)
        setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const signin = useCallback(async (email: string, password: string) => {
    const r = await apiSignin(email, password)
    if (r.error) return r.error
    setUser(r.user || null)
    return null
  }, [])

  const signup = useCallback(async (email: string, password: string, displayName: string) => {
    const r = await apiSignup(email, password, displayName)
    if (r.error) return r.error
    setUser(r.user || null)
    return null
  }, [])

  const logout = useCallback(async () => {
    await apiLogout()
    setUser(null)
  }, [])

  const setDisplayName = useCallback(async (name: string) => {
    const r = await updateMe({ displayName: name })
    if (r.error) return r.error
    setUser(r.user || null)
    return null
  }, [])

  const setProfile = useCallback(async (patch: { displayName?: string; color?: string }) => {
    const r = await updateMe(patch)
    if (r.error) return r.error
    setUser(r.user || null)
    return null
  }, [])

  const value = useMemo(
    () => ({ user, loading, signin, signup, logout, refresh, setDisplayName, setProfile }),
    [user, loading, signin, signup, logout, refresh, setDisplayName, setProfile]
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
