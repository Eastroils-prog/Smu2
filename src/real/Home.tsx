import { Link } from 'react-router-dom'
import type { Stage } from '../lib/supabase'
import { Card, Empty, PageTitle, SectionTitle, StatusBadge } from '../features/shared/ui'
import { useAuth } from './auth'
import { dueLabel, isLate, progressOf, useStages, useSubmissions, useTasks } from './data'

/** Progress bar cut into one slice per stage. `value` is 0 to 1. */
export function StageProgress({ value, stages }: { value: number; stages: Stage[] }) {
  const percent = Math.round(value * 100)
  const count = Math.max(stages.length, 1)
  return (
    <div className="flex items-center gap-3">
      <div className="flex min-w-0 flex-1 gap-1" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-label="Verified progress">
        {Array.from({ length: count }, (_, i) => {
          const fill = Math.max(0, Math.min(1, value * count - i))
          return (
            <div key={i} title={stages[i]?.name} className="h-2.5 flex-1 overflow-hidden rounded-full bg-sunken">
              <div className="h-full rounded-full bg-accent transition-all duration-500" style={{ width: `${fill * 100}%` }} />
            </div>
          )
        })}
      </div>
      <span className="w-10 text-right text-sm font-semibold tabular-nums">{percent}%</span>
    </div>
  )
}

/** The participant's first page: where they are and what comes next. */
export function MyHome() {
  const { profile } = useAuth()
  const tasks = useTasks()
  const submissions = useSubmissions()
  const stages = useStages()
  if (!profile) return null

  const all = tasks.data ?? []
  const stageList = stages.data ?? []
  const stage = stageList.find((s) => s.id === profile.current_stage_id)
  const todo = all.filter((t) => t.status === 'not_started' || t.status === 'in_progress' || t.status === 'needs_revision')
  const feedback = (submissions.data ?? []).filter((s) => s.feedback && s.decision !== 'pending').slice(-1)[0]
  const feedbackTask = feedback ? all.find((t) => t.id === feedback.task_id) : undefined

  return (
    <>
      <PageTitle title={`Hello, ${profile.full_name.split(' ')[0]}`} subtitle="Here is where you are and what comes next." />

      <Card>
        <SectionTitle>Your verified progress</SectionTitle>
        <StageProgress value={progressOf(profile, all, stageList)} stages={stageList} />
        {stage && (
          <p className="mt-3">
            You are in stage {stage.position} of {stageList.length}: <strong>{stage.name}</strong>
          </p>
        )}
        <p className="mt-1 text-sm text-muted">The bar moves when the owner approves your work.</p>
      </Card>

      <Card>
        <SectionTitle action={<Link to="/app/tasks" className="text-sm font-medium text-accent-strong">See all tasks</Link>}>What to do next</SectionTitle>
        {tasks.isLoading ? (
          <Empty>Loading…</Empty>
        ) : todo.length === 0 ? (
          <Empty>Nothing to do right now.</Empty>
        ) : (
          <ul className="flex flex-col divide-y divide-line">
            {todo.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-3">
                <span className="min-w-0 font-medium">{t.title}</span>
                <span className="flex items-center gap-2">
                  <span className={`text-sm ${isLate(t) ? 'font-semibold text-danger' : 'text-muted'}`}>{dueLabel(t.due_on)}</span>
                  <StatusBadge status={t.status} />
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {feedback && (
        <Card>
          <SectionTitle>Latest feedback</SectionTitle>
          {feedbackTask && <p className="text-sm text-muted">{feedbackTask.title}</p>}
          <p className="mt-1 break-words whitespace-pre-wrap">{feedback.feedback}</p>
        </Card>
      )}
    </>
  )
}
