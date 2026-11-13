import { useState } from 'react'
import { CalendarDays } from 'lucide-react'
import { STAGES, formatDue, isOverdue, type Role, type Task } from '../../lib/data'
import { useStore } from '../../lib/store'
import { Badge, Button, StatusBadge, inputClass } from './ui'

/**
 * One task. The buttons depend on who is looking:
 * a participant can start it and hand in work; only the owner can approve it.
 */
export function TaskCard({ task, viewer, showPerson = false }: { task: Task; viewer: Role; showPerson?: boolean }) {
  const { state, startTask, submitTask, reviewTask } = useStore()
  const [text, setText] = useState('')
  const person = state.people.find((p) => p.id === task.personId)
  const late = isOverdue(task)

  const canHandIn = viewer === 'participant' && (task.status === 'in_progress' || task.status === 'needs_revision')
  const canReview = viewer === 'admin' && task.status === 'submitted'

  return (
    <article className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-4" data-testid="task-card">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="font-sans font-semibold">{task.title}</h3>
          <p className="text-sm text-muted">
            {showPerson && person ? `${person.name} · ` : ''}
            {STAGES[task.stage].name}
          </p>
        </div>
        <StatusBadge status={task.status} />
      </div>

      <p className="text-sm">{task.description}</p>

      <div className="flex flex-wrap items-center gap-2 text-sm">
        {task.status !== 'completed' && (
          <span className={`inline-flex items-center gap-1.5 ${late ? 'font-semibold text-danger' : 'text-muted'}`}>
            <CalendarDays size={15} />
            {formatDue(task.due)}
          </span>
        )}
        {task.priority === 'high' && task.status !== 'completed' && <Badge tone="warn">Important</Badge>}
      </div>

      {task.submission && (
        <div className="rounded-lg bg-sunken p-3 text-sm">
          <p className="mb-1 text-xs font-semibold tracking-wide text-muted uppercase">
            {viewer === 'participant' ? 'What you handed in' : 'Handed in'}
          </p>
          <p className="break-words whitespace-pre-wrap">{task.submission}</p>
        </div>
      )}

      {task.feedback && task.status !== 'submitted' && (
        <div className={`rounded-lg p-3 text-sm ${task.status === 'completed' ? 'bg-accent-soft' : 'bg-danger-soft'}`}>
          <p className="mb-1 text-xs font-semibold tracking-wide text-muted uppercase">Feedback from the owner</p>
          <p className="break-words whitespace-pre-wrap">{task.feedback}</p>
        </div>
      )}

      {viewer === 'participant' && task.status === 'not_started' && (
        <div>
          <Button small variant="secondary" onClick={() => startTask(task.id)}>
            Start this task
          </Button>
        </div>
      )}

      {viewer === 'participant' && task.status === 'submitted' && (
        <p className="text-sm text-muted">Waiting for the owner to check your work.</p>
      )}

      {canHandIn && (
        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            if (!text.trim()) return
            submitTask(task.id, text.trim())
            setText('')
          }}
        >
          <label htmlFor={`work-${task.id}`} className="text-sm font-medium">
            Your work
          </label>
          <textarea
            id={`work-${task.id}`}
            rows={3}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Write what you did, or paste a link"
            className={inputClass}
          />
          <div>
            <Button small type="submit" disabled={!text.trim()}>
              Hand in
            </Button>
          </div>
        </form>
      )}

      {canReview && (
        <div className="flex flex-col gap-2">
          <label htmlFor={`feedback-${task.id}`} className="text-sm font-medium">
            Your feedback (optional)
          </label>
          <textarea
            id={`feedback-${task.id}`}
            rows={2}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="A short note for them"
            className={inputClass}
          />
          <div className="flex flex-wrap gap-2">
            <Button small onClick={() => { reviewTask(task.id, true, text.trim()); setText('') }}>
              Approve
            </Button>
            <Button small variant="secondary" onClick={() => { reviewTask(task.id, false, text.trim()); setText('') }}>
              Ask for changes
            </Button>
          </div>
        </div>
      )}
    </article>
  )
}
