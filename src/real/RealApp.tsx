import { useState, type ReactNode } from 'react'
import { BrowserRouter, NavLink, Navigate, Outlet, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query'
import { Bell, CalendarDays, CheckSquare, FileSpreadsheet, Home, LayoutDashboard, LogOut, MessageCircle, PiggyBank, Sprout, User, Users, Vote } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { formatDate } from '../lib/data'
import { Avatar, Button, Card, Field, PageTitle, inputClass } from '../features/shared/ui'
import { AuthProvider, useAuth } from './auth'
import { ForgotPage, SetPasswordPage, SignInPage, WelcomePage } from './AuthPages'
import { OwnerPeople, OwnerPerson } from './OwnerPeople'
import { MyTasks, OwnerTasks } from './Tasks'
import { MessagesPage } from './Messages'
import { MyHome } from './Home'
import { MyMoney } from './Money'
import { FilesPage } from './Files'
import { PollsPage } from './Polls'
import { OwnerDashboard } from './Dashboard'
import { CalendarPage } from './Calendar'
import { RemindersPage, useDueCount } from './Reminders'
import { unreadTotal, useMessages, useSharedFiles, useStages, useTasks } from './data'

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

  const home = profile.role === 'admin' ? '/admin' : '/app'
  return (
    <Routes>
      {profile.role === 'admin' ? (
        <Route element={<RealShell />}>
          <Route path="/admin" element={<OwnerDashboard />} />
          <Route path="/admin/people" element={<OwnerPeople />} />
          <Route path="/admin/people/:id" element={<OwnerPerson />} />
          <Route path="/admin/tasks" element={<OwnerTasks />} />
          <Route path="/admin/messages" element={<MessagesPage base="/admin/messages" />} />
          <Route path="/admin/messages/:id" element={<MessagesPage base="/admin/messages" />} />
          <Route path="/admin/files" element={<FilesPage />} />
          <Route path="/admin/polls" element={<PollsPage />} />
          <Route path="/admin/calendar" element={<CalendarPage />} />
          <Route path="/admin/reminders" element={<RemindersPage />} />
          <Route path="/admin/profile" element={<MyProfilePage />} />
        </Route>
      ) : (
        <Route element={<RealShell />}>
          <Route path="/app" element={<MyHome />} />
          <Route path="/app/tasks" element={<MyTasks />} />
          <Route path="/app/messages" element={<MessagesPage base="/app/messages" />} />
          <Route path="/app/messages/:id" element={<MessagesPage base="/app/messages" />} />
          <Route path="/app/money" element={<MyMoney />} />
          <Route path="/app/files" element={<FilesPage />} />
          <Route path="/app/polls" element={<PollsPage />} />
          <Route path="/app/calendar" element={<CalendarPage />} />
          <Route path="/app/reminders" element={<RemindersPage />} />
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
  const messages = useMessages()
  const tasks = useTasks()
  const sharedFiles = useSharedFiles()
  const remindersDue = useDueCount()
  if (!profile) return null
  const isAdmin = profile.role === 'admin'
  const unread = unreadTotal(messages.data ?? [], profile.id)
  const toCheck = isAdmin ? (tasks.data ?? []).filter((t) => t.status === 'submitted').length : 0
  const filesToCheck = isAdmin ? (sharedFiles.data ?? []).filter((f) => f.status === 'pending').length : 0
  type Item = { to: string; label: string; icon: ReactNode; end?: boolean; badge?: number }
  const groups: { title: string; items: Item[] }[] = isAdmin
    ? [
        {
          title: 'Programme',
          items: [
            { to: '/admin', label: 'Dashboard', icon: <LayoutDashboard size={18} />, end: true },
            { to: '/admin/people', label: 'People', icon: <Users size={18} /> },
            { to: '/admin/tasks', label: 'Tasks', icon: <CheckSquare size={18} />, badge: toCheck },
          ],
        },
        {
          title: 'Together',
          items: [
            { to: '/admin/messages', label: 'Messages', icon: <MessageCircle size={18} />, badge: unread },
            { to: '/admin/files', label: 'Files', icon: <FileSpreadsheet size={18} />, badge: filesToCheck },
            { to: '/admin/polls', label: 'Polls', icon: <Vote size={18} /> },
          ],
        },
        {
          title: 'Planning',
          items: [
            { to: '/admin/calendar', label: 'Calendar', icon: <CalendarDays size={18} /> },
            { to: '/admin/reminders', label: 'Reminders', icon: <Bell size={18} />, badge: remindersDue },
          ],
        },
        { title: 'You', items: [{ to: '/admin/profile', label: 'My account', icon: <User size={18} /> }] },
      ]
    : [
        {
          title: 'My work',
          items: [
            { to: '/app', label: 'Home', icon: <Home size={18} />, end: true },
            { to: '/app/tasks', label: 'Tasks', icon: <CheckSquare size={18} /> },
            { to: '/app/money', label: 'Money', icon: <PiggyBank size={18} /> },
          ],
        },
        {
          title: 'Together',
          items: [
            { to: '/app/messages', label: 'Messages', icon: <MessageCircle size={18} />, badge: unread },
            { to: '/app/files', label: 'Files', icon: <FileSpreadsheet size={18} /> },
            { to: '/app/polls', label: 'Polls', icon: <Vote size={18} /> },
          ],
        },
        {
          title: 'Planning',
          items: [
            { to: '/app/calendar', label: 'Calendar', icon: <CalendarDays size={18} /> },
            { to: '/app/reminders', label: 'Reminders', icon: <Bell size={18} />, badge: remindersDue },
          ],
        },
        { title: 'You', items: [{ to: '/app/profile', label: 'Profile', icon: <User size={18} /> }] },
      ]

  const leave = async () => {
    await signOut()
    client.clear()
  }

  const brand = (
    <div className="flex min-w-0 items-center gap-2.5">
      <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-spark text-on-spark">
        <Sprout size={20} />
      </span>
      <span className="font-display text-xl font-extrabold tracking-tight">VentureTrack</span>
    </div>
  )

  return (
    <div className="min-h-full md:pl-64">
      {/* The rail: a band across the top on phones, a panel down the left on computers. */}
      <aside className="on-rail bg-rail text-rail-ink md:fixed md:inset-y-0 md:left-0 md:flex md:w-64 md:flex-col">
        <div className="gutter flex items-center justify-between gap-3 pt-4 pb-3 md:px-5 md:pt-6 md:pb-5">
          {brand}
          <button
            onClick={() => void leave()}
            className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium text-rail-muted hover:bg-rail-raised hover:text-rail-ink md:hidden"
          >
            <LogOut size={16} />
            Sign out
          </button>
        </div>

        <nav aria-label="Main" className="scroll-strip flex gap-1 overflow-x-auto px-3 pb-3 [mask-image:linear-gradient(to_right,black_85%,transparent)] md:[mask-image:none] md:flex-1 md:flex-col md:gap-5 md:overflow-y-auto md:px-3 md:pb-4">
          {groups.map((group) => (
            <div key={group.title} className="flex shrink-0 gap-1 md:flex-col md:gap-0.5">
              <p className="hidden px-3 pb-1 text-[11px] font-semibold tracking-[0.08em] text-rail-muted/80 uppercase md:block">{group.title}</p>
              {group.items.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) =>
                    `relative flex shrink-0 items-center gap-2 rounded-full px-3.5 py-2 text-sm font-semibold whitespace-nowrap transition-colors md:gap-3 md:rounded-xl md:px-3 md:py-2.5 ${
                      isActive
                        ? 'bg-spark text-on-spark md:bg-rail-raised md:text-rail-ink md:before:absolute md:before:inset-y-2 md:before:-left-3 md:before:w-1 md:before:rounded-r-full md:before:bg-spark'
                        : 'text-rail-muted hover:bg-rail-raised hover:text-rail-ink'
                    }`
                  }
                >
                  {item.icon}
                  <span className="md:flex-1">{item.label}</span>
                  {!!item.badge && (
                    <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-spark px-1.5 text-[11px] font-bold text-on-spark tabular-nums ring-2 ring-rail">
                      {item.badge}
                    </span>
                  )}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>

        <div className="hidden border-t border-white/10 p-4 md:block">
          <div className="flex items-center gap-3">
            <Avatar name={profile.full_name} />
            <div className="min-w-0 flex-1 leading-tight">
              <p className="truncate text-sm font-semibold">{profile.full_name}</p>
              <p className="truncate text-xs text-rail-muted">@{profile.username}{isAdmin ? ' · owner' : ''}</p>
            </div>
          </div>
          <button
            onClick={() => void leave()}
            className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-white/10 px-3 py-2 text-sm font-medium text-rail-muted hover:bg-rail-raised hover:text-rail-ink"
          >
            <LogOut size={16} />
            Sign out
          </button>
        </div>
      </aside>

      <main className="gutter">
        <div className="mx-auto flex max-w-5xl min-w-0 flex-col gap-5 py-6 pb-16 md:py-10">
          <Outlet />
        </div>
      </main>
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
