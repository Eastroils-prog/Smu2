import { Link } from 'react-router-dom'
import { AlertTriangle, CheckSquare, ChevronRight, FileSpreadsheet, LifeBuoy, MessageCircle, Users } from 'lucide-react'
import { Avatar, Badge, Card, Empty, PageTitle, SectionTitle } from '../features/shared/ui'
import { useAuth } from './auth'
import { LoadError } from './Tasks'
import { StageProgress } from './Home'
import { DueReminders } from './Reminders'
import {
  daysSince, dueLabel, isLate, progressOf, unreadFrom, useHelpRequests, useMessages, useMilestones, usePeople, useSettings,
  useSharedFiles, useStages, useTasks,
} from './data'

type Tone = 'danger' | 'warn' | 'info'

/** The owner's first page: who needs attention, and what is coming up. */
export function OwnerDashboard() {
  const { profile } = useAuth()
  const people = usePeople()
  const tasks = useTasks()
  const messages = useMessages()
  const help = useHelpRequests()
  const files = useSharedFiles()
  const stages = useStages()
  const milestones = useMilestones()
  const settings = useSettings()
  if (!profile) return null

  const allTasks = tasks.data ?? []
  const allMessages = messages.data ?? []
  const openHelp = (help.data ?? []).filter((h) => !h.resolved_at)
  const quietAfter = settings.data?.inactivityDays ?? 7
  const active = (people.data ?? []).filter((p) => p.status === 'active' && !p.archived_at && !p.blocked_at)

  const flagged = active
    .map((p) => {
      const reasons: { label: string; tone: Tone }[] = []
      if (openHelp.some((h) => h.participant_id === p.id)) reasons.push({ label: 'Asked for help', tone: 'danger' })
      const late = allTasks.filter((t) => t.participant_id === p.id && isLate(t)).length
      if (late) reasons.push({ label: late === 1 ? '1 late task' : `${late} late tasks`, tone: 'danger' })
      const quiet = daysSince(p.last_active_at)
      if (quiet >= quietAfter) reasons.push({ label: quiet === Infinity ? 'Never active' : `Quiet for ${quiet} days`, tone: 'warn' })
      if (allTasks.some((t) => t.participant_id === p.id && t.status === 'submitted')) reasons.push({ label: 'Work to check', tone: 'info' })
      if (unreadFrom(allMessages, profile.id, p.id)) reasons.push({ label: 'Unread message', tone: 'info' })
      return { person: p, reasons }
    })
    .filter((x) => x.reasons.length > 0)
    // Most urgent first: anything red, then yellow, then the rest.
    .sort((a, b) => rank(a.reasons) - rank(b.reasons) || a.person.full_name.localeCompare(b.person.full_name))

  const needsYou = flagged.filter((x) => x.reasons.some((r) => r.tone !== 'info')).length
  const toCheck = allTasks.filter((t) => t.status === 'submitted').length
  const unread = active.reduce((n, p) => n + unreadFrom(allMessages, profile.id, p.id), 0)
  const filesWaiting = (files.data ?? []).filter((f) => f.status === 'pending').length
  const upcoming = allTasks
    .filter((t) => t.status !== 'completed' && t.status !== 'submitted' && t.due_on && active.some((p) => p.id === t.participant_id))
    .sort((a, b) => (a.due_on ?? '').localeCompare(b.due_on ?? ''))
    .slice(0, 6)
  const nameOf = (id: string) => active.find((p) => p.id === id)?.full_name ?? ''
  const average = active.length
    ? active.reduce((n, p) => n + progressOf(p, allTasks, stages.data ?? [], milestones.data ?? []), 0) / active.length
    : 0

  const stats = [
    { label: 'Active people', value: active.length, to: '/admin/people', icon: <Users size={18} /> },
    { label: 'Need your attention', value: needsYou, to: '#attention', alert: needsYou > 0, icon: <AlertTriangle size={18} /> },
    { label: 'Work to check', value: toCheck, to: '/admin/tasks', icon: <CheckSquare size={18} /> },
    { label: 'Unread messages', value: unread, to: '/admin/messages', icon: <MessageCircle size={18} /> },
    { label: 'Help requests', value: openHelp.length, to: '#attention', alert: openHelp.length > 0, icon: <LifeBuoy size={18} /> },
    { label: 'Files to approve', value: filesWaiting, to: '/admin/files', icon: <FileSpreadsheet size={18} /> },
  ]
  const hour = new Date().getHours()
  const greeting = `${hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'}, ${profile.full_name.split(' ')[0]}.`

  if (people.isError || tasks.isError) {
    return (
      <>
        <PageTitle title="Dashboard" />
        <LoadError />
      </>
    )
  }

  return (
    <>
      <PageTitle title="Dashboard" subtitle={`${greeting} Here is how your people are doing today.`} />

      <dl className="grid grid-cols-2 gap-3 lg:grid-cols-3" data-testid="stats">
        {stats.map((s) => (
          <Link
            key={s.label}
            to={s.to}
            className={`group flex flex-col gap-3 rounded-2xl border p-4 shadow-card transition hover:-translate-y-0.5 hover:shadow-lift ${
              s.alert ? 'border-danger/25 bg-danger-soft' : 'border-line/70 bg-surface'
            }`}
            data-testid="stat"
          >
            <span className={`inline-flex h-9 w-9 items-center justify-center rounded-xl ${s.alert ? 'bg-surface text-danger' : 'bg-accent-soft text-accent-strong'}`}>{s.icon}</span>
            <span className="flex flex-col">
              <dd className={`font-display text-[32px] leading-none font-extrabold tabular-nums ${s.alert ? 'text-danger' : ''}`}>{s.value}</dd>
              <dt className={`mt-1 text-sm ${s.alert ? 'text-danger' : 'text-muted'}`}>{s.label}</dt>
            </span>
          </Link>
        ))}
      </dl>

      <DueReminders />

      <Card>
        <SectionTitle>Whole programme, verified progress</SectionTitle>
        <StageProgress value={average} stages={stages.data ?? []} />
        <p className="mt-2 text-sm text-muted">The average of everyone active. Only approved work and reached milestones count.</p>
      </Card>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card>
          <SectionTitle>
            <span id="attention">Needs your attention</span>
          </SectionTitle>
          {people.isLoading ? (
            <Empty>Loading…</Empty>
          ) : flagged.length === 0 ? (
            <Empty>Nobody needs you right now.</Empty>
          ) : (
            <ul className="flex flex-col divide-y divide-line">
              {flagged.map(({ person, reasons }) => (
                <li key={person.id}>
                  <Link to={`/admin/people/${person.id}`} className="flex items-center gap-3 py-3 hover:opacity-80" data-testid="attention-row">
                    <Avatar name={person.full_name} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{person.full_name}</span>
                      <span className="mt-1 flex flex-wrap gap-1.5">
                        {reasons.map((r) => <Badge key={r.label} tone={r.tone}>{r.label}</Badge>)}
                      </span>
                    </span>
                    <ChevronRight size={18} className="shrink-0 text-muted" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-xs text-muted">“Quiet” means no activity for {quietAfter} days or more.</p>
        </Card>

        <Card>
          <SectionTitle action={<Link to="/admin/tasks" className="text-sm font-medium text-accent-strong">All tasks</Link>}>Coming up</SectionTitle>
          {tasks.isLoading ? (
            <Empty>Loading…</Empty>
          ) : upcoming.length === 0 ? (
            <Empty>No deadlines coming up.</Empty>
          ) : (
            <ul className="flex flex-col divide-y divide-line">
              {upcoming.map((t) => (
                <li key={t.id} className="flex items-center justify-between gap-3 py-3">
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{t.title}</span>
                    <span className="block truncate text-sm text-muted">{nameOf(t.participant_id)}</span>
                  </span>
                  <span className={`shrink-0 text-sm ${isLate(t) ? 'font-semibold text-danger' : 'text-muted'}`}>{dueLabel(t.due_on)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  )
}

function rank(reasons: { tone: Tone }[]): number {
  if (reasons.some((r) => r.tone === 'danger')) return 0
  if (reasons.some((r) => r.tone === 'warn')) return 1
  return 2
}
