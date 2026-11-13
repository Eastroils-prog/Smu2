import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Check, CircleCheck, Circle, LifeBuoy } from 'lucide-react'
import { STAGES, formatDate, formatDue, isOverdue, progressOf, type TaskStatus } from '../../lib/data'
import { useStore } from '../../lib/store'
import { Chat } from '../shared/Chat'
import { TaskCard } from '../shared/TaskCard'
import { Avatar, Badge, Button, Card, Empty, Field, Modal, PageTitle, SectionTitle, StageBar, StatusBadge, inputClass } from '../shared/ui'

function useMe() {
  const store = useStore()
  const me = store.state.people.find((p) => p.id === store.meId)!
  const tasks = store.state.tasks.filter((t) => t.personId === me.id)
  return { ...store, me, tasks }
}

// ---------- Home ----------

export function MyDashboard() {
  const { state, me, tasks, requestHelp } = useMe()
  const [asking, setAsking] = useState(false)
  const [helpText, setHelpText] = useState('')

  const todo = tasks
    .filter((t) => t.status === 'not_started' || t.status === 'in_progress' || t.status === 'needs_revision')
    .sort((a, b) => a.due.localeCompare(b.due))
  const lastFeedback = tasks.filter((t) => t.feedback && (t.status === 'completed' || t.status === 'needs_revision')).slice(-1)[0]

  return (
    <>
      <PageTitle title={`Hello, ${me.name.split(' ')[0]}`} subtitle="Here is where you are and what comes next." />

      <Card>
        <SectionTitle>Your verified progress</SectionTitle>
        <StageBar value={progressOf(state, me.id)} />
        <p className="mt-3">
          {me.status === 'completed' ? (
            <strong>You finished the programme. Well done!</strong>
          ) : (
            <>
              You are in stage {me.stage + 1} of {STAGES.length}: <strong>{STAGES[me.stage].name}</strong>
            </>
          )}
        </p>
        <p className="mt-1 text-sm text-muted">The bar moves when the owner approves your work.</p>
      </Card>

      <Card>
        <SectionTitle action={<Link to="/app/tasks" className="text-sm font-medium text-accent-strong">See all tasks</Link>}>
          What to do next
        </SectionTitle>
        {todo.length === 0 ? (
          <Empty>Nothing to do right now. Nice work!</Empty>
        ) : (
          <ul className="flex flex-col divide-y divide-line">
            {todo.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-3">
                <span className="min-w-0 font-medium">{t.title}</span>
                <span className="flex items-center gap-2">
                  <span className={`text-sm ${isOverdue(t) ? 'font-semibold text-danger' : 'text-muted'}`}>{formatDue(t.due)}</span>
                  <StatusBadge status={t.status} />
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {lastFeedback && (
        <Card>
          <SectionTitle>Latest feedback</SectionTitle>
          <p className="text-sm text-muted">{lastFeedback.title}</p>
          <p className="mt-1">{lastFeedback.feedback}</p>
        </Card>
      )}

      <Card className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-semibold">Stuck on something?</h2>
          <p className="text-sm text-muted">
            {me.helpRequest ? 'Your request was sent. The owner will get back to you.' : 'Tell the owner and they will get back to you.'}
          </p>
        </div>
        {me.helpRequest ? (
          <Badge tone="accent">Help requested</Badge>
        ) : (
          <Button variant="secondary" onClick={() => setAsking(true)}>
            <LifeBuoy size={17} />
            Ask for help
          </Button>
        )}
      </Card>

      {asking && (
        <Modal title="Ask for help" onClose={() => setAsking(false)}>
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault()
              if (!helpText.trim()) return
              requestHelp(me.id, helpText.trim())
              setHelpText('')
              setAsking(false)
            }}
          >
            <Field label="What do you need help with?" htmlFor="help-text">
              <textarea id="help-text" rows={4} required value={helpText} onChange={(e) => setHelpText(e.target.value)} className={inputClass} />
            </Field>
            <Button type="submit">Send request</Button>
          </form>
        </Modal>
      )}
    </>
  )
}

// ---------- Tasks ----------

const GROUPS: { title: string; statuses: TaskStatus[] }[] = [
  { title: 'To do', statuses: ['needs_revision', 'in_progress', 'not_started'] },
  { title: 'Waiting to be checked', statuses: ['submitted'] },
  { title: 'Approved', statuses: ['completed'] },
]

export function MyTasks() {
  const { tasks } = useMe()
  return (
    <>
      <PageTitle title="My tasks" subtitle="Start a task, do the work, then hand it in." />
      {tasks.length === 0 && <Empty>You have no tasks yet.</Empty>}
      {GROUPS.map((group) => {
        const list = tasks
          .filter((t) => group.statuses.includes(t.status))
          .sort((a, b) => group.statuses.indexOf(a.status) - group.statuses.indexOf(b.status) || a.due.localeCompare(b.due))
        if (list.length === 0) return null
        return (
          <section key={group.title} className="flex flex-col gap-3">
            <h2 className="text-base font-semibold">
              {group.title} <span className="font-sans text-sm font-normal text-muted">({list.length})</span>
            </h2>
            {list.map((t) => <TaskCard key={t.id} task={t} viewer="participant" />)}
          </section>
        )
      })}
    </>
  )
}

// ---------- Messages ----------

export function MyMessages() {
  const { me } = useMe()
  return (
    <>
      <PageTitle title="Messages" subtitle="Your private conversation with the owner. Nobody else can read it." />
      <Chat personId={me.id} viewer="participant" />
    </>
  )
}

// ---------- Progress ----------

export function MyProgress() {
  const { state, me } = useMe()
  const finished = me.status === 'completed'
  return (
    <>
      <PageTitle title="My progress" subtitle="The six stages from idea to launch." />
      <Card>
        <StageBar value={progressOf(state, me.id)} />
      </Card>
      <ol className="flex flex-col gap-3">
        {STAGES.map((stage, i) => {
          const done = finished || i < me.stage
          const current = !finished && i === me.stage
          const milestones = state.milestones.filter((m) => m.personId === me.id && m.stage === i)
          return (
            <li
              key={stage.name}
              className={`flex gap-4 rounded-2xl border p-4 ${current ? 'border-accent bg-accent-soft' : 'border-line bg-surface'} ${!done && !current ? 'opacity-70' : ''}`}
            >
              <span
                className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full font-display font-bold ${
                  done ? 'bg-accent text-on-accent' : current ? 'border-2 border-accent text-accent-strong' : 'bg-sunken text-muted'
                }`}
              >
                {done ? <Check size={18} aria-label="Done" /> : i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-base font-semibold">{stage.name}</h2>
                  {current && <Badge tone="accent">You are here</Badge>}
                </div>
                <p className="text-sm text-muted">{stage.description}</p>
                {current && milestones.length > 0 && (
                  <ul className="mt-3 flex flex-col gap-1.5">
                    {milestones.map((m) => (
                      <li key={m.id} className="flex items-center gap-2 text-sm">
                        {m.achieved ? <CircleCheck size={17} className="shrink-0 text-accent" /> : <Circle size={17} className="shrink-0 text-muted" />}
                        {m.title}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </li>
          )
        })}
      </ol>
    </>
  )
}

// ---------- Profile ----------

export function MyProfile() {
  const { me, updateProfile } = useMe()
  const [name, setName] = useState(me.name)
  const [idea, setIdea] = useState(me.idea)
  const [goals, setGoals] = useState(me.goals)
  const [saved, setSaved] = useState(false)
  const changed = name !== me.name || idea !== me.idea || goals !== me.goals

  return (
    <>
      <PageTitle title="My profile" />
      <Card>
        <div className="mb-5 flex items-center gap-4">
          <Avatar name={me.name} size="lg" />
          <div className="min-w-0 text-sm text-muted">
            <p className="break-all">{me.email}</p>
            <p>Joined {formatDate(me.joined)} · {STAGES[me.stage].name}</p>
          </div>
        </div>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            if (!name.trim()) return
            updateProfile(me.id, { name: name.trim(), idea: idea.trim(), goals: goals.trim() })
            setSaved(true)
          }}
        >
          <Field label="Your name" htmlFor="profile-name">
            <input id="profile-name" required value={name} onChange={(e) => { setName(e.target.value); setSaved(false) }} className={inputClass} />
          </Field>
          <Field label="Your business idea" htmlFor="profile-idea">
            <textarea id="profile-idea" rows={3} value={idea} onChange={(e) => { setIdea(e.target.value); setSaved(false) }} className={inputClass} />
          </Field>
          <Field label="Your goals" htmlFor="profile-goals">
            <textarea id="profile-goals" rows={3} value={goals} onChange={(e) => { setGoals(e.target.value); setSaved(false) }} className={inputClass} />
          </Field>
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" disabled={!changed}>Save changes</Button>
            {saved && !changed && <span role="status" className="text-sm font-medium text-accent-strong">Saved</span>}
          </div>
        </form>
        <p className="mt-4 text-sm text-muted">Your e-mail and stage can only be changed by the owner.</p>
      </Card>
    </>
  )
}
