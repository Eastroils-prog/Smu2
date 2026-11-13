import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, ChevronRight, CircleCheck, Circle, Lock, Plus, UserPlus } from 'lucide-react'
import {
  STAGES, attentionFor, daysFromNow, daysSince, formatDate, formatDue, formatWhen, isOverdue, progressOf,
  stageShare, unreadCount, type Person, type Priority,
} from '../../lib/data'
import { useStore } from '../../lib/store'
import { Chat } from '../shared/Chat'
import { TaskCard } from '../shared/TaskCard'
import {
  Avatar, Badge, Button, Card, Empty, Field, Modal, PageTitle, SectionTitle, StageBar, inputClass,
} from '../shared/ui'

// ---------- Dashboard ----------

export function AdminDashboard() {
  const { state } = useStore()
  const active = state.people.filter((p) => p.status === 'active')
  const flagged = active
    .map((p) => ({ person: p, reasons: attentionFor(state, p) }))
    .filter((x) => x.reasons.some((r) => r.tone !== 'info'))
  const toCheck = state.tasks.filter((t) => t.status === 'submitted')
  const unread = active.reduce((n, p) => n + unreadCount(state, p.id, 'admin'), 0)
  const upcoming = state.tasks
    .filter((t) => t.status !== 'completed' && t.status !== 'submitted')
    .sort((a, b) => a.due.localeCompare(b.due))
    .slice(0, 5)
  const average = active.length ? active.reduce((n, p) => n + progressOf(state, p.id), 0) / active.length : 0

  return (
    <>
      <PageTitle title="Dashboard" subtitle="Here is how your people are doing today." />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Active people" value={active.length} to="/admin/people" />
        <Stat label="Need your attention" value={flagged.length} to="/admin/people" alert={flagged.length > 0} />
        <Stat label="Work to check" value={toCheck.length} to="/admin/tasks" />
        <Stat label="Unread messages" value={unread} to="/admin/messages" />
      </div>

      <Card>
        <SectionTitle>Whole programme, verified progress</SectionTitle>
        <StageBar value={average} />
        <p className="mt-2 text-sm text-muted">The average of everyone. It only counts work you have approved.</p>
      </Card>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card>
          <SectionTitle>Needs your attention</SectionTitle>
          {flagged.length === 0 ? (
            <Empty>Nobody needs you right now.</Empty>
          ) : (
            <ul className="flex flex-col divide-y divide-line">
              {flagged.map(({ person, reasons }) => (
                <li key={person.id}>
                  <Link to={`/admin/people/${person.id}`} className="flex items-center gap-3 py-3 hover:opacity-80">
                    <Avatar name={person.name} />
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium">{person.name}</span>
                      <span className="mt-1 flex flex-wrap gap-1.5">
                        {reasons.map((r) => (
                          <Badge key={r.label} tone={r.tone}>{r.label}</Badge>
                        ))}
                      </span>
                    </span>
                    <ChevronRight size={18} className="shrink-0 text-muted" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <SectionTitle>Coming up</SectionTitle>
          {upcoming.length === 0 ? (
            <Empty>No deadlines coming up.</Empty>
          ) : (
            <ul className="flex flex-col divide-y divide-line">
              {upcoming.map((t) => {
                const person = state.people.find((p) => p.id === t.personId)
                return (
                  <li key={t.id} className="flex items-center justify-between gap-3 py-3">
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{t.title}</span>
                      <span className="block text-sm text-muted">{person?.name}</span>
                    </span>
                    <span className={`shrink-0 text-sm ${isOverdue(t) ? 'font-semibold text-danger' : 'text-muted'}`}>
                      {formatDue(t.due)}
                    </span>
                  </li>
                )
              })}
            </ul>
          )}
        </Card>
      </div>
    </>
  )
}

function Stat({ label, value, to, alert }: { label: string; value: number; to: string; alert?: boolean }) {
  return (
    <Link to={to} className="rounded-2xl border border-line bg-surface p-4 transition-colors hover:border-accent">
      <p className={`font-display text-3xl font-bold tabular-nums ${alert ? 'text-danger' : ''}`}>{value}</p>
      <p className="text-sm text-muted">{label}</p>
    </Link>
  )
}

// ---------- People ----------

export function PeopleList() {
  const { state, invite } = useStore()
  const [query, setQuery] = useState('')
  const [inviting, setInviting] = useState(false)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')

  const shown = state.people.filter((p) => p.name.toLowerCase().includes(query.trim().toLowerCase()))

  return (
    <>
      <PageTitle
        title="People"
        subtitle="Everyone in your programme."
        action={
          <Button onClick={() => setInviting(true)}>
            <UserPlus size={17} />
            Invite a person
          </Button>
        }
      />

      <div>
        <label htmlFor="people-search" className="sr-only">Search people by name</label>
        <input
          id="people-search"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by name"
          className={`${inputClass} max-w-sm`}
        />
      </div>

      {shown.length === 0 ? (
        <Empty>No one matches that name.</Empty>
      ) : (
        <ul className="flex flex-col gap-3">
          {shown.map((p) => (
            <li key={p.id}>
              <PersonRow person={p} />
            </li>
          ))}
        </ul>
      )}

      {inviting && (
        <Modal title="Invite a person" onClose={() => setInviting(false)}>
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault()
              if (!name.trim() || !email.trim()) return
              invite(name.trim(), email.trim())
              setName('')
              setEmail('')
              setInviting(false)
            }}
          >
            <Field label="Their name" htmlFor="invite-name">
              <input id="invite-name" required value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
            </Field>
            <Field label="Their e-mail" htmlFor="invite-email">
              <input id="invite-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className={inputClass} />
            </Field>
            <p className="text-sm text-muted">
              In the real app they get an e-mail with a link. In this sample they are only added to the list.
            </p>
            <Button type="submit">Send invitation</Button>
          </form>
        </Modal>
      )}
    </>
  )
}

function PersonRow({ person }: { person: Person }) {
  const { state } = useStore()
  const reasons = attentionFor(state, person)
  return (
    <Link
      to={`/admin/people/${person.id}`}
      className="grid grid-cols-1 items-center gap-x-4 gap-y-3 rounded-2xl border border-line bg-surface p-4 transition-colors hover:border-accent sm:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_auto]"
    >
      <div className="flex min-w-0 items-center gap-3">
        <Avatar name={person.name} />
        <div className="min-w-0">
          <p className="truncate font-semibold">{person.name}</p>
          <p className="truncate text-sm text-muted">
            {person.status === 'invited' ? 'Invited, has not joined yet' : STAGES[person.stage].name}
          </p>
        </div>
      </div>
      {person.status === 'invited' ? (
        <div><Badge>Waiting for them</Badge></div>
      ) : (
        <StageBar value={progressOf(state, person.id)} />
      )}
      <div className="flex flex-wrap gap-1.5 sm:justify-end">
        {reasons.map((r) => (
          <Badge key={r.label} tone={r.tone}>{r.label}</Badge>
        ))}
        {person.status === 'active' && reasons.length === 0 && <Badge tone="accent">On track</Badge>}
      </div>
    </Link>
  )
}

// ---------- One person ----------

type Tab = 'overview' | 'tasks' | 'messages' | 'notes'

export function PersonDetail() {
  const { id = '' } = useParams()
  const { state, toggleMilestone, advanceStage, addNote, resolveHelp } = useStore()
  const [tab, setTab] = useState<Tab>('overview')
  const [note, setNote] = useState('')
  const [newTask, setNewTask] = useState(false)
  const person = state.people.find((p) => p.id === id)

  if (!person) return <Empty>We could not find that person.</Empty>

  const tasks = state.tasks.filter((t) => t.personId === id)
  const milestones = state.milestones.filter((m) => m.personId === id && m.stage === person.stage)
  const notes = state.notes.filter((n) => n.personId === id)
  const stageDone = stageShare(state, id, person.stage) === 1
  const isLastStage = person.stage === STAGES.length - 1
  const unread = unreadCount(state, id, 'admin')

  const tabs: { key: Tab; label: string; count?: number }[] = [
    { key: 'overview', label: 'Overview' },
    { key: 'tasks', label: 'Tasks', count: tasks.filter((t) => t.status === 'submitted').length },
    { key: 'messages', label: 'Messages', count: unread },
    { key: 'notes', label: 'Private notes' },
  ]

  return (
    <>
      <Link to="/admin/people" className="inline-flex items-center gap-1.5 self-start text-sm font-medium text-accent-strong">
        <ArrowLeft size={16} />
        All people
      </Link>

      <div className="flex flex-wrap items-center gap-4">
        <Avatar name={person.name} size="lg" />
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-bold tracking-tight">{person.name}</h1>
          <p className="text-sm break-all text-muted">
            {person.email} · {person.status === 'invited' ? 'invited' : 'joined'} {formatDate(person.joined)}
            {person.status === 'active' && ` · last seen ${daysSince(person.lastActive) === 0 ? 'today' : `${daysSince(person.lastActive)} days ago`}`}
          </p>
        </div>
      </div>

      {person.helpRequest && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-danger-soft p-4">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-danger">Asked for help</p>
            <p>{person.helpRequest}</p>
          </div>
          <Button small variant="secondary" onClick={() => resolveHelp(id)}>Mark as handled</Button>
        </div>
      )}

      <div role="tablist" aria-label="Sections" className="flex gap-1 overflow-x-auto border-b border-line">
        {tabs.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => setTab(t.key)}
            className={`-mb-px flex items-center gap-2 border-b-2 px-3 py-2.5 text-sm font-medium whitespace-nowrap ${
              tab === t.key ? 'border-accent text-accent-strong' : 'border-transparent text-muted hover:text-ink'
            }`}
          >
            {t.label}
            {!!t.count && <Badge tone="warn">{t.count}</Badge>}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <>
          {person.status === 'invited' ? (
            <Empty>{person.name} has been invited but has not joined yet.</Empty>
          ) : (
            <>
              <Card>
                <SectionTitle>Verified progress</SectionTitle>
                <StageBar value={progressOf(state, id)} />
                <p className="mt-3">
                  {person.status === 'completed' ? (
                    <strong>Finished the programme.</strong>
                  ) : (
                    <>
                      Stage {person.stage + 1} of {STAGES.length}: <strong>{STAGES[person.stage].name}</strong>
                    </>
                  )}
                </p>
                {person.status === 'active' && (
                  <div className="mt-3 flex flex-wrap items-center gap-3">
                    <Button small variant={stageDone ? 'primary' : 'secondary'} onClick={() => advanceStage(id)}>
                      {isLastStage ? 'Mark programme as finished' : `Move to stage ${person.stage + 2}`}
                    </Button>
                    <span className="text-sm text-muted">
                      {stageDone ? 'Everything in this stage is approved.' : 'Only you can move a person forward.'}
                    </span>
                  </div>
                )}
              </Card>

              {person.status === 'active' && (
                <Card>
                  <SectionTitle>Milestones in this stage</SectionTitle>
                  {milestones.length === 0 ? (
                    <Empty>No milestones in this stage yet.</Empty>
                  ) : (
                    <ul className="flex flex-col gap-1">
                      {milestones.map((m) => (
                        <li key={m.id}>
                          <button
                            onClick={() => toggleMilestone(m.id)}
                            aria-pressed={m.achieved}
                            className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left hover:bg-sunken"
                          >
                            {m.achieved ? <CircleCheck size={20} className="shrink-0 text-accent" /> : <Circle size={20} className="shrink-0 text-muted" />}
                            <span className="flex-1">{m.title}</span>
                            <span className="text-sm text-muted">{m.achieved ? 'Reached' : 'Tap when reached'}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </Card>
              )}

              <Card>
                <SectionTitle>Business idea</SectionTitle>
                <p>{person.idea || 'Not written yet.'}</p>
                <h3 className="mt-4 mb-1 font-sans text-sm font-semibold text-muted">Goals</h3>
                <p>{person.goals || 'Not written yet.'}</p>
              </Card>
            </>
          )}
        </>
      )}

      {tab === 'tasks' && (
        <>
          <div>
            <Button onClick={() => setNewTask(true)}>
              <Plus size={17} />
              Give a task
            </Button>
          </div>
          {tasks.length === 0 ? (
            <Empty>No tasks yet.</Empty>
          ) : (
            <div className="flex flex-col gap-3">
              {tasks.map((t) => <TaskCard key={t.id} task={t} viewer="admin" />)}
            </div>
          )}
        </>
      )}

      {tab === 'messages' && <Chat personId={id} viewer="admin" />}

      {tab === 'notes' && (
        <>
          <p className="flex items-center gap-2 rounded-xl bg-info-soft px-4 py-3 text-sm text-info">
            <Lock size={16} className="shrink-0" />
            Only you can see these notes. {person.name.split(' ')[0]} never can.
          </p>
          <form
            className="flex flex-col gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              if (!note.trim()) return
              addNote(id, note.trim())
              setNote('')
            }}
          >
            <label htmlFor="note-text" className="sr-only">New private note</label>
            <textarea id="note-text" rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Write a private note" className={inputClass} />
            <div><Button small type="submit" disabled={!note.trim()}>Save note</Button></div>
          </form>
          {notes.length === 0 ? (
            <Empty>No notes yet.</Empty>
          ) : (
            <ul className="flex flex-col gap-3">
              {notes.map((n) => (
                <li key={n.id} className="rounded-xl border border-line bg-surface p-4">
                  <p className="break-words whitespace-pre-wrap">{n.body}</p>
                  <p className="mt-1 text-xs text-muted">{formatWhen(n.at)}</p>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {newTask && <NewTaskModal fixedPersonId={id} onClose={() => setNewTask(false)} />}
    </>
  )
}

// ---------- Messages ----------

export function AdminMessages() {
  const { id } = useParams()
  const { state } = useStore()
  const navigate = useNavigate()
  const people = state.people.filter((p) => p.status !== 'invited')
  const current = people.find((p) => p.id === id)

  if (current) {
    return (
      <>
        <Link to="/admin/messages" className="inline-flex items-center gap-1.5 self-start text-sm font-medium text-accent-strong">
          <ArrowLeft size={16} />
          All conversations
        </Link>
        <div className="flex items-center gap-3">
          <Avatar name={current.name} />
          <h1 className="text-xl font-bold">{current.name}</h1>
        </div>
        <Chat personId={current.id} viewer="admin" />
      </>
    )
  }

  const rows = people
    .map((p) => {
      const thread = state.messages.filter((m) => m.personId === p.id)
      return { person: p, last: thread[thread.length - 1], unread: unreadCount(state, p.id, 'admin') }
    })
    .sort((a, b) => (b.last?.at ?? '').localeCompare(a.last?.at ?? ''))

  return (
    <>
      <PageTitle title="Messages" subtitle="One private conversation with each person." />
      <ul className="flex flex-col gap-2">
        {rows.map(({ person, last, unread }) => (
          <li key={person.id}>
            <button
              onClick={() => navigate(`/admin/messages/${person.id}`)}
              className="flex w-full items-center gap-3 rounded-2xl border border-line bg-surface p-4 text-left transition-colors hover:border-accent"
            >
              <Avatar name={person.name} />
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline justify-between gap-2">
                  <span className={`truncate ${unread ? 'font-bold' : 'font-semibold'}`}>{person.name}</span>
                  {last && <span className="shrink-0 text-xs text-muted">{formatWhen(last.at)}</span>}
                </span>
                <span className={`block truncate text-sm ${unread ? 'text-ink' : 'text-muted'}`}>
                  {last ? `${last.from === 'admin' ? 'You: ' : ''}${last.body}` : 'No messages yet'}
                </span>
              </span>
              {unread > 0 && <Badge tone="accent">{unread} new</Badge>}
            </button>
          </li>
        ))}
      </ul>
    </>
  )
}

// ---------- Tasks ----------

export function AdminTasks() {
  const { state } = useStore()
  const [filter, setFilter] = useState<'check' | 'open' | 'all'>('check')
  const [newTask, setNewTask] = useState(false)

  const toCheck = state.tasks.filter((t) => t.status === 'submitted')
  const open = state.tasks.filter((t) => t.status !== 'completed' && t.status !== 'submitted')
  const shown = (filter === 'check' ? toCheck : filter === 'open' ? open : state.tasks)
    .slice()
    .sort((a, b) => a.due.localeCompare(b.due))

  const filters = [
    { key: 'check' as const, label: `To check (${toCheck.length})` },
    { key: 'open' as const, label: `Still open (${open.length})` },
    { key: 'all' as const, label: `All (${state.tasks.length})` },
  ]

  return (
    <>
      <PageTitle
        title="Tasks"
        subtitle="Give work, then check it when it comes back."
        action={
          <Button onClick={() => setNewTask(true)}>
            <Plus size={17} />
            Give a task
          </Button>
        }
      />
      <div className="flex flex-wrap gap-2">
        {filters.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            aria-pressed={filter === f.key}
            className={`rounded-full px-3.5 py-1.5 text-sm font-medium ${
              filter === f.key ? 'bg-accent text-on-accent' : 'border border-line bg-surface text-muted hover:text-ink'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>
      {shown.length === 0 ? (
        <Empty>{filter === 'check' ? 'Nothing to check. You are all caught up.' : 'No tasks here.'}</Empty>
      ) : (
        <div className="flex flex-col gap-3">
          {shown.map((t) => <TaskCard key={t.id} task={t} viewer="admin" showPerson />)}
        </div>
      )}
      {newTask && <NewTaskModal onClose={() => setNewTask(false)} />}
    </>
  )
}

function NewTaskModal({ fixedPersonId, onClose }: { fixedPersonId?: string; onClose: () => void }) {
  const { state, createTask } = useStore()
  const people = state.people.filter((p) => p.status === 'active')
  const [personId, setPersonId] = useState(fixedPersonId ?? people[0]?.id ?? '')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [days, setDays] = useState(7)
  const [priority, setPriority] = useState<Priority>('medium')

  return (
    <Modal title="Give a task" onClose={onClose}>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault()
          if (!title.trim() || !personId) return
          createTask({ personId, title: title.trim(), description: description.trim() || 'No extra details.', due: daysFromNow(days), priority })
          onClose()
        }}
      >
        {!fixedPersonId && (
          <Field label="Who is it for?" htmlFor="task-person">
            <select id="task-person" value={personId} onChange={(e) => setPersonId(e.target.value)} className={inputClass}>
              {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </Field>
        )}
        <Field label="What should they do?" htmlFor="task-title">
          <input id="task-title" required value={title} onChange={(e) => setTitle(e.target.value)} className={inputClass} />
        </Field>
        <Field label="Details (optional)" htmlFor="task-details">
          <textarea id="task-details" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} className={inputClass} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Due in" htmlFor="task-due">
            <select id="task-due" value={days} onChange={(e) => setDays(Number(e.target.value))} className={inputClass}>
              <option value={3}>3 days</option>
              <option value={7}>1 week</option>
              <option value={14}>2 weeks</option>
              <option value={30}>1 month</option>
            </select>
          </Field>
          <Field label="How important?" htmlFor="task-priority">
            <select id="task-priority" value={priority} onChange={(e) => setPriority(e.target.value as Priority)} className={inputClass}>
              <option value="low">Low</option>
              <option value="medium">Normal</option>
              <option value="high">Important</option>
            </select>
          </Field>
        </div>
        <Button type="submit">Give this task</Button>
      </form>
    </Modal>
  )
}
