import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { Bell, Plus, Repeat, Trash2 } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { Badge, Button, Card, Empty, Field, Modal, PageTitle, SectionTitle, inputClass } from '../features/shared/ui'
import { LoadError } from './Tasks'
import { localToday, usePeople, useReminders, type Reminder } from './data'

const REPEAT_LABEL = { none: '', weekly: 'Every week', monthly: 'Every month' } as const

export function dayLabel(iso: string, today = localToday()): string {
  const days = Math.round((Date.parse(`${iso}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000)
  if (days === 0) return 'Today'
  if (days === 1) return 'Tomorrow'
  if (days === -1) return 'Yesterday'
  if (days < 0) return `${-days} days ago`
  if (days < 7) return new Date(`${iso}T12:00:00Z`).toLocaleDateString(undefined, { weekday: 'long', timeZone: 'UTC' })
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' })
}

/** One reminder with its Done and Delete buttons. */
export function ReminderRow({ reminder, personName }: { reminder: Reminder; personName?: string }) {
  const client = useQueryClient()
  const [busy, setBusy] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState('')
  const today = localToday()
  const overdue = reminder.due_on < today
  const dueToday = reminder.due_on === today

  const run = async (work: PromiseLike<{ error: { message: string } | null }>) => {
    setBusy(true)
    setError('')
    const { error: failed } = await work
    setBusy(false)
    if (failed) setError('That did not work. Please try again.')
    await client.invalidateQueries({ queryKey: ['reminders'] })
  }

  return (
    <li className="flex flex-col gap-2 py-3" data-testid="reminder">
      <div className="flex flex-wrap items-start gap-3">
        <span className={`mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${overdue ? 'bg-danger-soft text-danger' : dueToday ? 'bg-warn-soft text-warn' : 'bg-sunken text-muted'}`}>
          <Bell size={15} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-medium break-words">{reminder.title}</p>
          <p className="flex flex-wrap items-center gap-x-2 text-sm text-muted">
            <span className={overdue ? 'font-semibold text-danger' : dueToday ? 'font-semibold text-warn' : ''}>{dayLabel(reminder.due_on, today)}</span>
            {personName && <span>· {personName}</span>}
            {reminder.repeats !== 'none' && (
              <span className="inline-flex items-center gap-1">· <Repeat size={13} />{REPEAT_LABEL[reminder.repeats]}</span>
            )}
          </p>
          {reminder.note && <p className="mt-1 text-sm break-words whitespace-pre-wrap">{reminder.note}</p>}
        </div>
        <div className="flex shrink-0 gap-1">
          {confirming ? (
            <>
              <Button small disabled={busy} onClick={() => void run(supabase.from('reminders').delete().eq('id', reminder.id))}>Delete</Button>
              <Button small variant="secondary" onClick={() => setConfirming(false)}>Keep</Button>
            </>
          ) : (
            <>
              <Button small variant="secondary" disabled={busy} onClick={() => void run(supabase.rpc('complete_reminder', { p_id: reminder.id }))}>
                {reminder.repeats === 'none' ? 'Done' : 'Done, next one'}
              </Button>
              <button type="button" onClick={() => setConfirming(true)} aria-label={`Delete reminder ${reminder.title}`} className="rounded-lg p-2 text-muted hover:bg-sunken hover:text-ink">
                <Trash2 size={16} />
              </button>
            </>
          )}
        </div>
      </div>
      {error && <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
    </li>
  )
}

export function NewReminderModal({ onClose, fixedPersonId, startDate }: { onClose: () => void; fixedPersonId?: string; startDate?: string }) {
  const client = useQueryClient()
  const people = usePeople()
  const choices = (people.data ?? []).filter((p) => p.status === 'active')
  const [title, setTitle] = useState('')
  const [personId, setPersonId] = useState(fixedPersonId ?? '')
  const [dueOn, setDueOn] = useState(startDate ?? localToday())
  const [repeats, setRepeats] = useState<Reminder['repeats']>('none')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  return (
    <Modal title="New reminder" onClose={onClose}>
      <form
        className="flex flex-col gap-4"
        noValidate
        onSubmit={async (e) => {
          e.preventDefault()
          if (!title.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(dueOn)) {
            setError('Write what to remember and pick a date.')
            return
          }
          setBusy(true)
          setError('')
          const { error: failed } = await supabase.from('reminders').insert({
            title: title.trim(),
            participant_id: personId || null,
            due_on: dueOn,
            repeats,
            note: note.trim() || null,
          })
          setBusy(false)
          if (failed) {
            setError('We could not save this reminder. Please try again.')
            return
          }
          await client.invalidateQueries({ queryKey: ['reminders'] })
          onClose()
        }}
      >
        <Field label="What should you remember?" htmlFor="reminder-title">
          <input id="reminder-title" maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="For example: call about the pricing plan" className={inputClass} />
        </Field>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="When?" htmlFor="reminder-date">
            <input id="reminder-date" type="date" value={dueOn} onChange={(e) => setDueOn(e.target.value)} className={inputClass} />
          </Field>
          <Field label="Repeat" htmlFor="reminder-repeat">
            <select id="reminder-repeat" value={repeats} onChange={(e) => setRepeats(e.target.value as Reminder['repeats'])} className={inputClass}>
              <option value="none">Just once</option>
              <option value="weekly">Every week</option>
              <option value="monthly">Every month</option>
            </select>
          </Field>
        </div>
        {!fixedPersonId && (
          <Field label="About someone? (optional)" htmlFor="reminder-person">
            <select id="reminder-person" value={personId} onChange={(e) => setPersonId(e.target.value)} className={inputClass}>
              <option value="">Nobody in particular</option>
              {choices.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
            </select>
          </Field>
        )}
        <Field label="Note (optional)" htmlFor="reminder-note">
          <textarea id="reminder-note" rows={2} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} className={inputClass} />
        </Field>
        <p className="text-sm text-muted">Only you can see reminders, even ones about a person.</p>
        {error && <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
        <Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save reminder'}</Button>
      </form>
    </Modal>
  )
}

export function RemindersPage() {
  const reminders = useReminders()
  const people = usePeople()
  const [adding, setAdding] = useState(false)
  const today = localToday()
  const all = reminders.data ?? []
  const nameOf = (id: string | null) => (id ? people.data?.find((p) => p.id === id)?.full_name : undefined)
  const groups = [
    { title: 'Late', list: all.filter((r) => r.due_on < today) },
    { title: 'Today', list: all.filter((r) => r.due_on === today) },
    { title: 'Coming up', list: all.filter((r) => r.due_on > today) },
  ]

  return (
    <>
      <PageTitle
        title="Reminders"
        subtitle="Your own follow-ups. Only you can see them."
        action={
          <Button onClick={() => setAdding(true)}>
            <Plus size={17} />
            New reminder
          </Button>
        }
      />
      {reminders.isError ? (
        <LoadError />
      ) : reminders.isLoading ? (
        <Empty>Loading…</Empty>
      ) : all.length === 0 ? (
        <Empty>No reminders. Tap “New reminder” to add one.</Empty>
      ) : (
        groups.map((g) =>
          g.list.length === 0 ? null : (
            <Card key={g.title}>
              <SectionTitle>
                {g.title} <span className="font-sans text-sm font-normal text-muted">({g.list.length})</span>
              </SectionTitle>
              <ul className="-my-3 flex flex-col divide-y divide-line">
                {g.list.map((r) => <ReminderRow key={r.id} reminder={r} personName={nameOf(r.participant_id)} />)}
              </ul>
            </Card>
          ),
        )
      )}
      <p className="text-sm text-muted">
        Tip: you can also see your reminders on the <Link to="/admin/calendar" className="font-medium text-accent-strong">calendar</Link>.
      </p>
      {adding && <NewReminderModal onClose={() => setAdding(false)} />}
    </>
  )
}

/** For the dashboard: reminders due today or late. */
export function DueReminders() {
  const reminders = useReminders()
  const people = usePeople()
  const today = localToday()
  const due = (reminders.data ?? []).filter((r) => r.due_on <= today)
  const nameOf = (id: string | null) => (id ? people.data?.find((p) => p.id === id)?.full_name : undefined)
  return (
    <Card>
      <SectionTitle action={<Link to="/admin/reminders" className="text-sm font-medium text-accent-strong">All reminders</Link>}>
        Your reminders for today {due.length > 0 && <Badge tone="warn">{due.length}</Badge>}
      </SectionTitle>
      {reminders.isLoading ? (
        <Empty>Loading…</Empty>
      ) : due.length === 0 ? (
        <Empty>Nothing to follow up today.</Empty>
      ) : (
        <ul className="-my-3 flex flex-col divide-y divide-line">
          {due.map((r) => <ReminderRow key={r.id} reminder={r} personName={nameOf(r.participant_id)} />)}
        </ul>
      )}
    </Card>
  )
}
