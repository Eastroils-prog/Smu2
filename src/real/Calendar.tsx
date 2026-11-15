import { useState } from 'react'
import { Bell, CheckSquare, ChevronLeft, ChevronRight, Plus } from 'lucide-react'
import { Button, Card, Empty, PageTitle, StatusBadge } from '../features/shared/ui'
import { useAuth } from './auth'
import { LoadError } from './Tasks'
import { NewReminderModal, ReminderRow } from './Reminders'
import { isLate, localToday, usePeople, useReminders, useTasks, type Reminder, type Task } from './data'

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

type Item = { kind: 'task'; task: Task } | { kind: 'reminder'; reminder: Reminder }


/** The 6×7 grid of dates shown for a month, starting on a Monday. */
function gridFor(year: number, month: number): { iso: string; inMonth: boolean; day: number }[] {
  const first = new Date(Date.UTC(year, month, 1))
  const offset = (first.getUTCDay() + 6) % 7
  return Array.from({ length: 42 }, (_, i) => {
    const d = new Date(Date.UTC(year, month, 1 - offset + i))
    return { iso: d.toISOString().slice(0, 10), inMonth: d.getUTCMonth() === month, day: d.getUTCDate() }
  })
}

export function CalendarPage() {
  const { profile } = useAuth()
  const isOwner = profile?.role === 'admin'
  const tasks = useTasks()
  const reminders = useReminders()
  const people = usePeople()
  const today = localToday()
  const [year, setYear] = useState(Number(today.slice(0, 4)))
  const [month, setMonth] = useState(Number(today.slice(5, 7)) - 1)
  const [selected, setSelected] = useState(today)
  const [adding, setAdding] = useState(false)
  if (!profile) return null
  const canAdd = !profile.archived_at

  const nameOf = (id: string | null) => (id ? people.data?.find((p) => p.id === id)?.full_name : undefined)
  const visiblePerson = (id: string) => {
    if (!isOwner) return true
    const p = people.data?.find((x) => x.id === id)
    return !!p && !p.blocked_at
  }

  // Everything with a date, grouped by day.
  const byDay = new Map<string, Item[]>()
  const add = (iso: string, item: Item) => byDay.set(iso, [...(byDay.get(iso) ?? []), item])
  for (const t of tasks.data ?? []) if (t.due_on && visiblePerson(t.participant_id)) add(t.due_on, { kind: 'task', task: t })
  for (const r of reminders.data ?? []) add(r.due_on, { kind: 'reminder', reminder: r })

  const cells = gridFor(year, month)
  const monthName = new Date(Date.UTC(year, month, 1)).toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' })
  const move = (by: number) => {
    const d = new Date(Date.UTC(year, month + by, 1))
    setYear(d.getUTCFullYear())
    setMonth(d.getUTCMonth())
  }
  const goToday = () => {
    setYear(Number(today.slice(0, 4)))
    setMonth(Number(today.slice(5, 7)) - 1)
    setSelected(today)
  }
  const dayItems = byDay.get(selected) ?? []
  const selectedLabel = new Date(`${selected}T12:00:00Z`).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })

  const chipText = (item: Item) => (item.kind === 'task' ? item.task.title : item.reminder.title)
  const chipClass = (item: Item) => {
    if (item.kind === 'reminder') return 'bg-warn-soft text-warn'
    if (item.task.status === 'completed') return 'bg-sunken text-muted line-through'
    if (isLate(item.task)) return 'bg-danger-soft text-danger'
    return 'bg-accent-soft text-accent-strong'
  }

  return (
    <>
      <PageTitle
        title="Calendar"
        subtitle={isOwner ? 'Task deadlines for everyone, and your reminders.' : 'When your tasks are due, and your reminders.'}
        action={
          canAdd ? (
            <Button onClick={() => setAdding(true)}>
              <Plus size={17} />
              New reminder
            </Button>
          ) : undefined
        }
      />

      {tasks.isError || reminders.isError ? <LoadError /> : null}

      <Card className="flex flex-col gap-3 p-3 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold" aria-live="polite" data-testid="month-name">{monthName}</h2>
          <div className="flex items-center gap-1">
            <Button small variant="secondary" onClick={goToday}>Today</Button>
            <button type="button" onClick={() => move(-1)} aria-label="Previous month" className="rounded-lg p-2 text-muted hover:bg-sunken hover:text-ink"><ChevronLeft size={18} /></button>
            <button type="button" onClick={() => move(1)} aria-label="Next month" className="rounded-lg p-2 text-muted hover:bg-sunken hover:text-ink"><ChevronRight size={18} /></button>
          </div>
        </div>

        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
          <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-accent" />Task due</span>
          <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-danger" />Late</span>
          <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-warn" />Your reminder</span>
        </div>

        <div className="grid grid-cols-7 text-center text-xs font-semibold tracking-wide text-muted uppercase" aria-hidden="true">
          {WEEKDAYS.map((d) => <div key={d} className="py-1">{d}</div>)}
        </div>
        <div className="grid grid-cols-7 gap-px overflow-hidden rounded-xl border border-line bg-line" role="grid" aria-label={monthName}>
          {cells.map((c) => {
            const items = byDay.get(c.iso) ?? []
            const isToday = c.iso === today
            const isSelected = c.iso === selected
            return (
              <button
                key={c.iso}
                type="button"
                role="gridcell"
                aria-selected={isSelected}
                aria-label={`${c.iso}${items.length ? `, ${items.length} ${items.length === 1 ? 'item' : 'items'}` : ''}`}
                onClick={() => {
                  setSelected(c.iso)
                  if (!c.inMonth) {
                    setYear(Number(c.iso.slice(0, 4)))
                    setMonth(Number(c.iso.slice(5, 7)) - 1)
                  }
                }}
                className={`flex min-h-14 min-w-0 flex-col items-stretch gap-1 p-1 text-left sm:min-h-24 sm:p-1.5 ${
                  isSelected ? 'bg-accent-soft' : c.inMonth ? 'bg-surface hover:bg-sunken' : 'bg-bg text-muted hover:bg-sunken'
                }`}
                data-testid="calendar-day"
                data-date={c.iso}
              >
                <span className={`inline-flex h-6 w-6 items-center justify-center self-start rounded-full text-xs font-semibold tabular-nums ${isToday ? 'bg-accent text-on-accent' : ''}`}>
                  {c.day}
                </span>
                {/* Phones: one dot per item. Larger screens: the first two titles. */}
                <span className="flex flex-wrap gap-0.5 sm:hidden" aria-hidden="true">
                  {items.slice(0, 4).map((it, i) => (
                    <span key={i} className={`h-1.5 w-1.5 rounded-full ${it.kind === 'reminder' ? 'bg-warn' : it.task.status === 'completed' ? 'bg-muted' : isLate(it.task) ? 'bg-danger' : 'bg-accent'}`} />
                  ))}
                </span>
                <span className="hidden min-w-0 flex-col gap-0.5 sm:flex" aria-hidden="true">
                  {items.slice(0, 2).map((it, i) => (
                    <span key={i} className={`truncate rounded px-1 py-0.5 text-[11px] font-medium ${chipClass(it)}`}>{chipText(it)}</span>
                  ))}
                  {items.length > 2 && <span className="px-1 text-[11px] text-muted">+{items.length - 2} more</span>}
                </span>
              </button>
            )
          })}
        </div>
      </Card>

      <Card>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-semibold" data-testid="selected-day">{selectedLabel}</h2>
          {canAdd && (
            <Button small variant="ghost" onClick={() => setAdding(true)}>
              <Plus size={15} />
              Reminder on this day
            </Button>
          )}
        </div>
        {dayItems.length === 0 ? (
          <Empty>Nothing on this day.</Empty>
        ) : (
          <ul className="flex flex-col divide-y divide-line" data-testid="day-items">
            {dayItems.map((it) =>
              it.kind === 'reminder' ? (
                <ReminderRow key={it.reminder.id} reminder={it.reminder} personName={nameOf(it.reminder.participant_id)} />
              ) : (
                <li key={it.task.id} className="flex flex-wrap items-center gap-3 py-3" data-testid="day-task">
                  <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent-strong"><CheckSquare size={15} /></span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium break-words">{it.task.title}</span>
                    <span className="block text-sm text-muted">{isOwner ? nameOf(it.task.participant_id) : 'Your task'} · task due</span>
                  </span>
                  <StatusBadge status={it.task.status} />
                </li>
              ),
            )}
          </ul>
        )}
      </Card>

      <p className="flex items-center gap-1.5 text-sm text-muted"><Bell size={14} />Your reminders show only on your own calendar, never on anyone else’s.</p>
      {adding && <NewReminderModal startDate={selected} onClose={() => setAdding(false)} />}
    </>
  )
}
