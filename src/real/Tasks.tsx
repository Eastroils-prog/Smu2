import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { CalendarDays, FileText, Paperclip, Plus, X } from 'lucide-react'
import { supabase, type Profile, type Stage } from '../lib/supabase'
import { formatSize } from '../lib/data'
import { Badge, Button, Empty, Field, Modal, PageTitle, StatusBadge, inputClass } from '../features/shared/ui'
import { useAuth } from './auth'
import {
  FILE_LIMIT_BYTES, FILE_LIMIT_COUNT, dateInDays, dueLabel, isLate, usePeople, useSignedUrl, useStages, useSubmissions,
  useTasks, type Attachment, type Submission, type Task,
} from './data'

const TASK_ERRORS: Record<string, string> = {
  task_not_open: 'This task is already handed in or approved. Reload the page to see the latest.',
  task_not_startable: 'This task was already started. Reload the page to see the latest.',
  task_not_submitted: 'This work was already checked. Reload the page to see the latest.',
  nothing_to_hand_in: 'Write something or add a file first.',
  too_many_files: `You can add up to ${FILE_LIMIT_COUNT} files.`,
  file_missing: 'One of the files did not upload. Please add it again.',
  file_not_allowed: 'One of the files could not be attached.',
}
const taskError = (message: string) => TASK_ERRORS[message] ?? 'Something went wrong. Please try again.'

export function LoadError() {
  return (
    <p role="alert" className="rounded-xl bg-danger-soft px-4 py-3 text-danger">
      We could not load this. Check your connection and reload the page.
    </p>
  )
}

// ---------- One task ----------

export function TaskCard({ task, submissions, stages, personName }: { task: Task; submissions: Submission[]; stages: Stage[]; personName?: string }) {
  const { profile } = useAuth()
  const client = useQueryClient()
  const [text, setText] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  if (!profile) return null

  const isOwner = profile.role === 'admin'
  const readOnly = !!profile.archived_at
  const mine = submissions.filter((s) => s.task_id === task.id)
  const latest = mine[mine.length - 1]
  const late = isLate(task)
  const stage = stages.find((s) => s.id === task.stage_id)
  const canHandIn = !isOwner && !readOnly && (task.status === 'in_progress' || task.status === 'needs_revision')
  const canReview = isOwner && task.status === 'submitted'

  const refresh = async () => {
    await client.invalidateQueries({ queryKey: ['tasks'] })
    await client.invalidateQueries({ queryKey: ['submissions'] })
  }
  const run = async (work: () => Promise<string | null>) => {
    setBusy(true)
    setError('')
    const failed = await work()
    setBusy(false)
    if (failed) setError(taskError(failed))
    await refresh()
  }

  const start = () =>
    run(async () => (await supabase.rpc('start_task', { p_task_id: task.id })).error?.message ?? null)

  const review = (approve: boolean) =>
    run(async () => {
      const { error: failed } = await supabase.rpc('review_task', { p_task_id: task.id, p_approve: approve, p_feedback: text })
      if (!failed) setText('')
      return failed?.message ?? null
    })

  const handIn = () =>
    run(async () => {
      // 1. Upload each file into my own private folder. 2. Hand in, naming those files.
      const uploaded: { path: string; name: string }[] = []
      for (const file of files) {
        const safe = file.name.replace(/[^A-Za-z0-9._-]+/g, '_').slice(-80) || 'file'
        const path = `${profile.id}/${task.id}/${crypto.randomUUID()}-${safe}`
        const { error: uploadFailed } = await supabase.storage
          .from('submissions')
          .upload(path, file, { contentType: file.type || 'application/octet-stream' })
        if (uploadFailed) return 'file_missing'
        uploaded.push({ path, name: file.name })
      }
      const { error: failed } = await supabase.rpc('submit_task', { p_task_id: task.id, p_body: text, p_files: uploaded })
      if (!failed) {
        setText('')
        setFiles([])
      }
      return failed?.message ?? null
    })

  const addFiles = (picked: File[]) => {
    const tooBig = picked.find((f) => f.size > FILE_LIMIT_BYTES)
    if (tooBig) {
      setError(`"${tooBig.name}" is too big. Each file can be up to 10 MB.`)
      return
    }
    if (files.length + picked.length > FILE_LIMIT_COUNT) {
      setError(taskError('too_many_files'))
      return
    }
    setError('')
    setFiles((list) => [...list, ...picked])
  }

  return (
    <article className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-4" data-testid="task-card">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="font-sans font-semibold">{task.title}</h3>
          <p className="text-sm text-muted">
            {personName ? `${personName} · ` : ''}
            {stage ? stage.name : ''}
          </p>
        </div>
        <StatusBadge status={task.status} />
      </div>

      {task.description && <p className="text-sm break-words whitespace-pre-wrap">{task.description}</p>}

      {task.status !== 'completed' && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className={`inline-flex items-center gap-1.5 ${late ? 'font-semibold text-danger' : 'text-muted'}`}>
            <CalendarDays size={15} />
            {dueLabel(task.due_on)}
          </span>
          {task.priority === 'high' && <Badge tone="warn">Important</Badge>}
        </div>
      )}

      {latest && (
        <div className="rounded-lg bg-sunken p-3 text-sm">
          <p className="mb-1 text-xs font-semibold tracking-wide text-muted uppercase">{isOwner ? 'Handed in' : 'What you handed in'}</p>
          {latest.body && <p className="break-words whitespace-pre-wrap">{latest.body}</p>}
          {latest.task_attachments.length > 0 && (
            <ul className="mt-2 flex flex-wrap gap-2" aria-label="Attached files">
              {latest.task_attachments.map((a) => (
                <li key={a.id}>
                  <StoredFile attachment={a} />
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {latest?.feedback && latest.decision !== 'pending' && (
        <div className={`rounded-lg p-3 text-sm ${latest.decision === 'approved' ? 'bg-accent-soft' : 'bg-danger-soft'}`}>
          <p className="mb-1 text-xs font-semibold tracking-wide text-muted uppercase">Feedback from the owner</p>
          <p className="break-words whitespace-pre-wrap">{latest.feedback}</p>
        </div>
      )}

      {!isOwner && task.status === 'not_started' && !readOnly && (
        <div>
          <Button small variant="secondary" disabled={busy} onClick={() => void start()}>Start this task</Button>
        </div>
      )}

      {!isOwner && task.status === 'submitted' && <p className="text-sm text-muted">Waiting for the owner to check your work.</p>}

      {canHandIn && (
        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            if (!text.trim() && files.length === 0) {
              setError(taskError('nothing_to_hand_in'))
              return
            }
            void handIn()
          }}
        >
          <label htmlFor={`work-${task.id}`} className="text-sm font-medium">Your work</label>
          <textarea
            id={`work-${task.id}`}
            rows={3}
            maxLength={10000}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Write what you did, or paste a link"
            className={inputClass}
          />
          {files.length > 0 && (
            <ul className="flex flex-wrap gap-2" aria-label="Files to hand in">
              {files.map((f, i) => (
                <li key={`${f.name}-${i}`} className="flex max-w-full items-center gap-2 rounded-lg border border-line bg-surface p-1.5 pr-2 text-sm" data-testid="picked-file">
                  <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-sunken text-muted"><FileText size={17} /></span>
                  <span className="min-w-0">
                    <span className="block max-w-40 truncate font-medium">{f.name}</span>
                    <span className="block text-xs text-muted">{formatSize(f.size)}</span>
                  </span>
                  <button type="button" onClick={() => setFiles((list) => list.filter((_, j) => j !== i))} aria-label={`Remove ${f.name}`} className="rounded-md p-1 text-muted hover:bg-sunken hover:text-ink">
                    <X size={15} />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <label
              htmlFor={`files-${task.id}`}
              className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-line bg-surface px-3 py-1.5 text-sm font-medium hover:bg-sunken focus-within:outline-2 focus-within:outline-accent"
            >
              <Paperclip size={15} />
              Add pictures or files
              <input
                id={`files-${task.id}`}
                type="file"
                multiple
                className="sr-only"
                onChange={(e) => {
                  addFiles(Array.from(e.target.files ?? []))
                  e.target.value = ''
                }}
              />
            </label>
            <Button small type="submit" disabled={busy}>{busy ? 'Handing in…' : 'Hand in'}</Button>
          </div>
          <p className="text-xs text-muted">Up to {FILE_LIMIT_COUNT} files, 10 MB each. Only you and the owner can see them.</p>
        </form>
      )}

      {canReview && (
        <div className="flex flex-col gap-2">
          <label htmlFor={`feedback-${task.id}`} className="text-sm font-medium">Your feedback (optional)</label>
          <textarea id={`feedback-${task.id}`} rows={2} maxLength={5000} value={text} onChange={(e) => setText(e.target.value)} placeholder="A short note for them" className={inputClass} />
          <div className="flex flex-wrap gap-2">
            <Button small disabled={busy} onClick={() => void review(true)}>Approve</Button>
            <Button small variant="secondary" disabled={busy} onClick={() => void review(false)}>Ask for changes</Button>
          </div>
        </div>
      )}

      {error && <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
    </article>
  )
}

/** A handed-in file. Pictures show a preview; everything opens in a new tab. */
function StoredFile({ attachment }: { attachment: Attachment }) {
  const url = useSignedUrl(attachment.storage_path)
  const isImage = (attachment.mime_type ?? '').startsWith('image/')
  return (
    <a
      href={url.data ?? undefined}
      target="_blank"
      rel="noreferrer"
      className="flex max-w-full items-center gap-2 rounded-lg border border-line bg-surface p-1.5 pr-2.5 text-sm hover:border-accent"
      data-testid="attachment"
    >
      {isImage && url.data ? (
        <img src={url.data} alt="" className="h-12 w-12 shrink-0 rounded-md object-cover" />
      ) : (
        <span className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-md bg-sunken text-muted"><FileText size={20} /></span>
      )}
      <span className="min-w-0">
        <span className="block max-w-40 truncate font-medium">{attachment.file_name}</span>
        <span className="block text-xs text-muted">{formatSize(attachment.size_bytes)}</span>
      </span>
    </a>
  )
}

// ---------- Owner: all tasks ----------

export function OwnerTasks() {
  const tasks = useTasks()
  const submissions = useSubmissions()
  const stages = useStages()
  const people = usePeople()
  const [filter, setFilter] = useState<'check' | 'open' | 'all'>('check')
  const [giving, setGiving] = useState(false)

  const all = tasks.data ?? []
  const toCheck = all.filter((t) => t.status === 'submitted')
  const open = all.filter((t) => t.status !== 'completed' && t.status !== 'submitted')
  const shown = filter === 'check' ? toCheck : filter === 'open' ? open : all
  const nameOf = (id: string) => people.data?.find((p) => p.id === id)?.full_name ?? ''

  const filters = [
    { key: 'check' as const, label: `To check (${toCheck.length})` },
    { key: 'open' as const, label: `Still open (${open.length})` },
    { key: 'all' as const, label: `All (${all.length})` },
  ]

  return (
    <>
      <PageTitle
        title="Tasks"
        subtitle="Give work, then check it when it comes back."
        action={
          <Button onClick={() => setGiving(true)}>
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
      {tasks.isError || submissions.isError ? (
        <LoadError />
      ) : tasks.isLoading ? (
        <Empty>Loading…</Empty>
      ) : shown.length === 0 ? (
        <Empty>{filter === 'check' ? 'Nothing to check. You are all caught up.' : 'No tasks here yet.'}</Empty>
      ) : (
        <div className="flex flex-col gap-3">
          {shown.map((t) => (
            <TaskCard key={t.id} task={t} submissions={submissions.data ?? []} stages={stages.data ?? []} personName={nameOf(t.participant_id)} />
          ))}
        </div>
      )}
      {giving && <GiveTaskModal people={people.data ?? []} onClose={() => setGiving(false)} />}
    </>
  )
}

export function GiveTaskModal({ people, fixedPersonId, onClose }: { people: Profile[]; fixedPersonId?: string; onClose: () => void }) {
  const client = useQueryClient()
  const choices = people.filter((p) => p.status === 'active' && !p.archived_at)
  const [personId, setPersonId] = useState(fixedPersonId ?? '')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [days, setDays] = useState(7)
  const [priority, setPriority] = useState<'low' | 'medium' | 'high'>('medium')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const chosen = personId || choices[0]?.id || ''

  return (
    <Modal title="Give a task" onClose={onClose}>
      {choices.length === 0 && !fixedPersonId ? (
        <Empty>Nobody has joined yet. Invite a person first, and give them a task once they have joined.</Empty>
      ) : (
        <form
          className="flex flex-col gap-4"
          noValidate
          onSubmit={async (e) => {
            e.preventDefault()
            if (!title.trim() || !chosen) {
              setError('Type what they should do.')
              return
            }
            setBusy(true)
            setError('')
            const { error: failed } = await supabase.from('tasks').insert({
              participant_id: chosen,
              title: title.trim(),
              description: description.trim() || null,
              priority,
              due_on: dateInDays(days),
            })
            setBusy(false)
            if (failed) {
              setError('We could not give this task. The person may be archived or not joined yet.')
              return
            }
            await client.invalidateQueries({ queryKey: ['tasks'] })
            onClose()
          }}
        >
          {!fixedPersonId && (
            <Field label="Who is it for?" htmlFor="task-person">
              <select id="task-person" value={chosen} onChange={(e) => setPersonId(e.target.value)} className={inputClass}>
                {choices.map((p) => (
                  <option key={p.id} value={p.id}>{p.full_name}</option>
                ))}
              </select>
            </Field>
          )}
          <Field label="What should they do?" htmlFor="task-title">
            <input id="task-title" maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} className={inputClass} />
          </Field>
          <Field label="Details (optional)" htmlFor="task-details">
            <textarea id="task-details" rows={3} maxLength={5000} value={description} onChange={(e) => setDescription(e.target.value)} className={inputClass} />
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
              <select id="task-priority" value={priority} onChange={(e) => setPriority(e.target.value as 'low' | 'medium' | 'high')} className={inputClass}>
                <option value="low">Low</option>
                <option value="medium">Normal</option>
                <option value="high">Important</option>
              </select>
            </Field>
          </div>
          {error && <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
          <Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Give this task'}</Button>
        </form>
      )}
    </Modal>
  )
}

// ---------- Participant: my tasks ----------

const GROUPS: { title: string; statuses: Task['status'][] }[] = [
  { title: 'To do', statuses: ['needs_revision', 'in_progress', 'not_started'] },
  { title: 'Waiting to be checked', statuses: ['submitted'] },
  { title: 'Approved', statuses: ['completed'] },
]

export function MyTasks() {
  const tasks = useTasks()
  const submissions = useSubmissions()
  const stages = useStages()
  const all = tasks.data ?? []

  return (
    <>
      <PageTitle title="My tasks" subtitle="Start a task, do the work, then hand it in." />
      {tasks.isError || submissions.isError ? (
        <LoadError />
      ) : tasks.isLoading ? (
        <Empty>Loading…</Empty>
      ) : all.length === 0 ? (
        <Empty>You have no tasks yet. The owner will give you some.</Empty>
      ) : (
        GROUPS.map((group) => {
          const list = all
            .filter((t) => group.statuses.includes(t.status))
            .sort((a, b) => group.statuses.indexOf(a.status) - group.statuses.indexOf(b.status))
          if (list.length === 0) return null
          return (
            <section key={group.title} className="flex flex-col gap-3">
              <h2 className="text-base font-semibold">
                {group.title} <span className="font-sans text-sm font-normal text-muted">({list.length})</span>
              </h2>
              {list.map((t) => (
                <TaskCard key={t.id} task={t} submissions={submissions.data ?? []} stages={stages.data ?? []} />
              ))}
            </section>
          )
        })
      )}
    </>
  )
}
