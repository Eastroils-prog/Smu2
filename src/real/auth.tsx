import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { PROFILE_COLUMNS, functionsUrl, publicKey, supabase, type Profile } from '../lib/supabase'

interface Auth {
  loading: boolean
  session: Session | null
  profile: Profile | null
  /** True after someone opens a "reset my password" link: they must pick a new password. */
  recovering: boolean
  signIn: (username: string, password: string) => Promise<'ok' | 'wrong' | 'locked' | 'error'>
  signOut: () => Promise<void>
  forgotPassword: (username: string) => Promise<void>
  finishRecovery: () => void
  reloadProfile: () => Promise<void>
}

const Ctx = createContext<Auth | null>(null)

async function callFunction(name: string, body: unknown, token?: string): Promise<Response> {
  return fetch(`${functionsUrl}/${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: publicKey, Authorization: `Bearer ${token ?? publicKey}` },
    body: JSON.stringify(body),
  })
}

/** Call a server function as the signed-in person. Returns the error code, or null on success. */
export async function callAsMe(name: string, body: unknown): Promise<string | null> {
  const { data } = await supabase.auth.getSession()
  try {
    const res = await callFunction(name, body, data.session?.access_token)
    if (res.ok) return null
    const payload = await res.json().catch(() => ({}))
    return typeof payload.error === 'string' ? payload.error : 'server_error'
  } catch {
    return 'network_error'
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true)
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [recovering, setRecovering] = useState(false)

  const loadProfile = useCallback(async (userId: string | undefined) => {
    if (!userId) {
      setProfile(null)
      return
    }
    const { data } = await supabase.from('profiles').select(PROFILE_COLUMNS).eq('id', userId).maybeSingle()
    setProfile((data as Profile | null) ?? null)
  }, [])

  useEffect(() => {
    let alive = true
    supabase.auth.getSession().then(async ({ data }) => {
      if (!alive) return
      setSession(data.session)
      await loadProfile(data.session?.user.id)
      if (alive) setLoading(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((event, next) => {
      if (event === 'PASSWORD_RECOVERY') setRecovering(true)
      if (event === 'SIGNED_OUT') setRecovering(false)
      setSession(next)
      // Never call Supabase from inside this callback directly; defer it.
      setTimeout(() => {
        if (alive) void loadProfile(next?.user.id)
      }, 0)
    })
    return () => {
      alive = false
      sub.subscription.unsubscribe()
    }
  }, [loadProfile])

  // Record that this person was here (at most once every few minutes).
  const userId = session?.user.id
  useEffect(() => {
    if (userId) void supabase.rpc('touch_last_active')
  }, [userId])

  const value = useMemo<Auth>(
    () => ({
      loading,
      session,
      profile,
      recovering,
      signIn: async (username, password) => {
        try {
          const res = await callFunction('sign-in', { action: 'sign-in', username, password })
          if (res.status === 429) return 'locked'
          if (res.status === 401) return 'wrong'
          if (!res.ok) return 'error'
          const tokens = await res.json()
          const { error } = await supabase.auth.setSession(tokens)
          return error ? 'error' : 'ok'
        } catch {
          return 'error'
        }
      },
      signOut: async () => {
        await supabase.auth.signOut()
      },
      forgotPassword: async (username) => {
        await callFunction('sign-in', { action: 'forgot', username, redirect_to: window.location.origin }).catch(() => null)
      },
      finishRecovery: () => setRecovering(false),
      reloadProfile: () => loadProfile(session?.user.id),
    }),
    [loading, session, profile, recovering, loadProfile],
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useAuth(): Auth {
  const auth = useContext(Ctx)
  if (!auth) throw new Error('useAuth must be used inside AuthProvider')
  return auth
}
