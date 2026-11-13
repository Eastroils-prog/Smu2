import { useState, type ReactNode } from 'react'
import { BrowserRouter, NavLink, Navigate, Outlet, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query'
import { LogOut, Sprout, User, Users } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { formatDate } from '../lib/data'
import { Avatar, Button, Card, Field, PageTitle, inputClass } from '../features/shared/ui'
import { AuthProvider, useAuth } from './auth'
import { ForgotPage, SetPasswordPage, SignInPage, WelcomePage } from './AuthPages'
import { OwnerPeople, OwnerPerson, useStages } from './OwnerPeople'

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: true } } })

export function RealApp() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <BrowserRouter>
          <Gate />
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  )
}

/**
 * Decides which pages a visitor may open. This is for convenience only:
 * the real locks are in the database, which checks every single request.
 */
function Gate() {
  const { loading, session, profile, recovering } = useAuth()

  if (loading) return <Centered>Loading…</Centered>

  if (!session) {
    return (
      <Routes>
        <Route path="/sign-in" element={<SignInPage />} />
        <Route path="/forgot" element={<ForgotPage />} />
        <Route path="*" element={<Navigate to="/sign-in" replace />} />
      </Routes>
    )
  }

  if (recovering) return <SetPasswordPage />
  if (!profile) return <Centered>Loading…</Centered>
  if (profile.status === 'invited') return <WelcomePage />

  const home = profile.role === 'admin' ? '/admin/people' : '/app/profile'
  return (
    <Routes>
      {profile.role === 'admin' ? (
        <Route element={<RealShell />}>
          <Route path="/admin/people" element={<OwnerPeople />} />
          <Route path="/admin/people/:id" element={<OwnerPerson />} />
          <Route path="/admin/profile" element={<MyProfilePage />} />
        </Route>
      ) : (
        <Route element={<RealShell />}>
          <Route path="/app/profile" element={<MyProfilePage />} />
        </Route>
      )}
      <Route path="*" element={<Navigate to={home} replace />} />
    </Routes>
  )
}

function Centered({ children }: { children: ReactNode }) {
  return <div className="flex min-h-full items-center justify-center text-muted">{children}</div>
}

function RealShell() {
  const { profile, signOut } = useAuth()
  const client = useQueryClient()
  if (!profile) return null
  const isAdmin = profile.role === 'admin'
  const items = isAdmin
    ? [
        { to: '/admin/people', label: 'People', icon: <Users size={19} /> },
        { to: '/admin/profile', label: 'My account', icon: <User size={19} /> },
      ]
    : [{ to: '/app/profile', label: 'My profile', icon: <User size={19} /> }]

  const leave = async () => {
    await signOut()
    client.clear()
  }

  return (
    <div className="gutter min-h-full">
      <div className="mx-auto grid max-w-6xl grid-cols-1 gap-6 py-5 md:grid-cols-[13rem_minmax(0,1fr)] md:py-8">
        <aside className="flex flex-wrap items-center justify-between gap-3 md:sticky md:top-8 md:flex-col md:flex-nowrap md:items-stretch md:justify-start md:self-start">
          <div className="flex items-center gap-2 px-1">
            <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-accent text-on-accent">
              <Sprout size={20} />
            </span>
            <div className="min-w-0 leading-tight">
              <p className="font-display text-lg font-bold">VentureTrack</p>
              <p className="truncate text-xs text-muted">@{profile.username}{isAdmin ? ' · owner' : ''}</p>
            </div>
          </div>
          <button
            onClick={() => void leave()}
            className="flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium text-muted hover:bg-sunken hover:text-ink md:order-last md:mt-4"
          >
            <LogOut size={17} />
            Sign out
          </button>
          <nav aria-label="Main" className="flex w-full gap-1 md:mt-4 md:flex-col">
            {items.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  `flex items-center gap-3 rounded-xl px-3 py-2.5 font-medium ${
                    isActive ? 'bg-accent-soft text-accent-strong' : 'text-muted hover:bg-sunken hover:text-ink'
                  }`
                }
              >
                {item.icon}
                {item.label}
              </NavLink>
            ))}
          </nav>
        </aside>
        <main className="flex min-w-0 flex-col gap-5 pb-10">
          <Outlet />
        </main>
      </div>
    </div>
  )
}

function MyProfilePage() {
  const { profile, reloadProfile } = useAuth()
  const stages = useStages()
  const [name, setName] = useState(profile?.full_name ?? '')
  const [idea, setIdea] = useState(profile?.business_idea ?? '')
  const [goals, setGoals] = useState(profile?.current_goals ?? '')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null)
  if (!profile) return null

  const isAdmin = profile.role === 'admin'
  const readOnly = !!profile.archived_at
  const stage = stages.data?.find((s) => s.id === profile.current_stage_id)
  const changed =
    name !== profile.full_name || idea !== (profile.business_idea ?? '') || goals !== (profile.current_goals ?? '')

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) {
      setNote({ ok: false, text: 'Your name cannot be empty.' })
      return
    }
    setBusy(true)
    const { error } = await supabase
      .from('profiles')
      .update({ full_name: name.trim(), business_idea: idea.trim() || null, current_goals: goals.trim() || null })
      .eq('id', profile.id)
    await reloadProfile()
    setBusy(false)
    if (error) {
      setNote({ ok: false, text: 'We could not save your changes. Please try again.' })
    } else {
      setName(name.trim())
      setIdea(idea.trim())
      setGoals(goals.trim())
      setNote({ ok: true, text: 'Saved' })
    }
  }

  return (
    <>
      <PageTitle title={isAdmin ? 'My account' : 'My profile'} />
      <Card>
        <div className="mb-5 flex items-center gap-4">
          <Avatar name={profile.full_name} size="lg" />
          <div className="min-w-0 text-sm text-muted">
            <p className="font-semibold text-ink">@{profile.username}</p>
            <p className="break-all">{profile.email}</p>
            {!isAdmin && (
              <p>
                {profile.joined_at ? `Joined ${formatDate(profile.joined_at)}` : ''}
                {stage ? ` · Stage ${stage.position}: ${stage.name}` : ''}
              </p>
            )}
          </div>
        </div>
        {readOnly && (
          <p className="mb-4 rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn">
            Your account is archived. You can read everything, but you cannot change it.
          </p>
        )}
        <form className="flex flex-col gap-4" onSubmit={save} noValidate>
          <Field label="Your name" htmlFor="profile-name">
            <input id="profile-name" value={name} disabled={readOnly} onChange={(e) => { setName(e.target.value); setNote(null) }} className={inputClass} />
          </Field>
          {!isAdmin && (
            <>
              <Field label="Your business idea" htmlFor="profile-idea">
                <textarea id="profile-idea" rows={3} maxLength={5000} value={idea} disabled={readOnly} onChange={(e) => { setIdea(e.target.value); setNote(null) }} className={inputClass} />
              </Field>
              <Field label="Your goals" htmlFor="profile-goals">
                <textarea id="profile-goals" rows={3} maxLength={5000} value={goals} disabled={readOnly} onChange={(e) => { setGoals(e.target.value); setNote(null) }} className={inputClass} />
              </Field>
            </>
          )}
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" disabled={busy || !changed || readOnly}>{busy ? 'Saving…' : 'Save changes'}</Button>
            {note && (
              <span role={note.ok ? 'status' : 'alert'} className={`text-sm font-medium ${note.ok ? 'text-accent-strong' : 'text-danger'}`}>
                {note.text}
              </span>
            )}
          </div>
        </form>
        {!isAdmin && <p className="mt-4 text-sm text-muted">Your username and e-mail cannot be changed here. Only the owner can change your stage.</p>}
      </Card>
    </>
  )
}
