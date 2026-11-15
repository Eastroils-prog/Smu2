import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { CircleCheck, Circle, LifeBuoy, Plus, Trash2 } from 'lucide-react'
import { supabase, type Profile, type Stage } from '../lib/supabase'
import { formatDate } from '../lib/data'
import { Badge, Button, Card, Empty, Field, Modal, SectionTitle, inputClass } from '../features/shared/ui'
import { callAsMe } from './auth'
import { useHelpRequests, useMilestones, type HelpRequest } from './data'

// ---------- Milestones (owner, on a person's page) ----------

export function PersonMilestones({ person, stages }: { person: Profile; stages: Stage[] }) {
  const client = useQueryClient()
  const milestones = useMilestones()
  const [title, setTitle] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [confirming, setConfirming] = useState<string | null>(null)
  const mine = (milestones.data ?? []).filter((m) => m.participant_id === person.id)
  const current = mine.filter((m) => m.stage_id === person.current_stage_id)
  const earlier = mine.filter((m) => m.stage_id !== person.current_stage_id)
  const stage = stages.find((s) => s.id === person.current_stage_id)

  const run = async (work: PromiseLike<{ error: { message: string } | null }>) => {
    setBusy(true)
    setError('')
    const { error: failed } = await work
    setBusy(false)
    if (failed) setError('We could not save that. Please try again.')
    await client.invalidateQueries({ queryKey: ['milestones'] })
    return !failed
  }

  const row = (m: (typeof mine)[number]) => (
    <li key={m.id} className="flex items-center gap-2" data-testid="milestone">
      <button
        type="button"
        disabled={busy}
        onClick={() => void run(supabase.rpc('set_milestone_reached', { p_id: m.id, p_reached: !m.achieved_at }))}
        aria-pressed={!!m.achieved_at}
        className="flex min-w-0 flex-1 items-center gap-3 rounded-lg px-2 py-2 text-left hover:bg-sunken"
      >
        {m.achieved_at ? <CircleCheck size={20} className="shrink-0 text-accent" /> : <Circle size={20} className="shrink-0 text-muted" />}
        <span className="min-w-0 flex-1 break-words">{m.title}</span>
        <span className="shrink-0 text-sm text-muted">{m.achieved_at ? `Reached ${formatDate(m.achieved_at)}` : 'Tap when reached'}</span>
      </button>
      {confirming === m.id ? (
        <span className="flex shrink-0 gap-1">
          <Button small disabled={busy} onClick={() => { setConfirming(null); void run(supabase.from('milestones').delete().eq('id', m.id)) }}>Remove</Button>
          <Button small variant="secondary" onClick={() => setConfirming(null)}>Keep</Button>
        </span>
      ) : (
        <button type="button" onClick={() => setConfirming(m.id)} aria-label={`Remove milestone ${m.title}`} className="shrink-0 rounded-lg p-2 text-muted hover:bg-sunken hover:text-ink">
          <Trash2 size={16} />
        </button>
      )}
    </li>
  )

  return (
    <Card className="flex flex-col gap-3">
      <SectionTitle>Milestones{stage ? ` in ${stage.name}` : ''}</SectionTitle>
      <p className="-mt-2 text-sm text-muted">Big steps you check yourself, like “first paying customer”. Reached milestones count toward their progress, just like approved tasks.</p>
      {current.length === 0 ? <Empty>No milestones in this stage yet.</Empty> : <ul className="flex flex-col gap-1">{current.map(row)}</ul>}
      {!person.archived_at && !person.blocked_at && (
        <form
          className="flex gap-2"
          onSubmit={async (e) => {
            e.preventDefault()
            if (!title.trim()) return
            if (await run(supabase.rpc('add_milestone', { p_profile_id: person.id, p_title: title.trim() }))) setTitle('')
          }}
        >
          <label htmlFor="milestone-title" className="sr-only">New milestone</label>
          <input id="milestone-title" maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="New milestone, for example: first paying customer" className={`${inputClass} min-w-0 flex-1`} />
          <Button type="submit" disabled={busy || !title.trim()}>
            <Plus size={16} />
            <span className="hidden sm:inline">Add</span>
          </Button>
        </form>
      )}
      {earlier.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer text-muted">Milestones from earlier stages ({earlier.length})</summary>
          <ul className="mt-2 flex flex-col gap-1">{earlier.map(row)}</ul>
        </details>
      )}
      {error && <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
    </Card>
  )
}

/** The participant's own milestones in their current stage (read-only). */
export function MyMilestones({ person }: { person: Profile }) {
  const milestones = useMilestones()
  const current = (milestones.data ?? []).filter((m) => m.participant_id === person.id && m.stage_id === person.current_stage_id)
  if (current.length === 0) return null
  return (
    <ul className="mt-3 flex flex-col gap-1.5" aria-label="Milestones in this stage">
      {current.map((m) => (
        <li key={m.id} className="flex items-center gap-2 text-sm" data-testid="milestone">
          {m.achieved_at ? <CircleCheck size={17} className="shrink-0 text-accent" aria-label="Reached" /> : <Circle size={17} className="shrink-0 text-muted" aria-label="Not reached yet" />}
          <span className={m.achieved_at ? '' : 'text-muted'}>{m.title}</span>
        </li>
      ))}
    </ul>
  )
}

// ---------- Asking for help ----------

/** For the participant: ask, and see whether the owner has handled it. */
export function AskForHelp({ person }: { person: Profile }) {
  const client = useQueryClient()
  const help = useHelpRequests()
  const [asking, setAsking] = useState(false)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const open = (help.data ?? []).find((h) => !h.resolved_at)
  const lastHandled = (help.data ?? []).find((h) => h.resolved_at)
  if (person.archived_at) return null

  return (
    <Card className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-semibold">Stuck on something?</h2>
          <p className="text-sm text-muted">
            {open ? 'Your request was sent. The owner will get back to you.' : 'Tell the owner what you need. Only they can see it.'}
          </p>
        </div>
        {open ? (
          <Badge tone="accent">Help requested</Badge>
        ) : (
          <Button variant="secondary" onClick={() => setAsking(true)}>
            <LifeBuoy size={17} />
            Ask for help
          </Button>
        )}
      </div>
      {open && <p className="rounded-lg bg-sunken px-3 py-2 text-sm break-words whitespace-pre-wrap">{open.body}</p>}
      {!open && lastHandled && <p className="text-sm text-muted">Your last request, from {formatDate(lastHandled.created_at)}, was marked as handled.</p>}

      {asking && (
        <Modal title="Ask for help" onClose={() => setAsking(false)}>
          <form
            className="flex flex-col gap-4"
            noValidate
            onSubmit={async (e) => {
              e.preventDefault()
              if (!text.trim()) {
                setError('Write what you need help with.')
                return
              }
              setBusy(true)
              setError('')
              const { error: failed } = await supabase.from('help_requests').insert({ body: text.trim() })
              setBusy(false)
              if (failed) {
                setError(failed.code === '23505' ? 'You already have a request waiting. The owner will get back to you.' : 'We could not send that. Please try again.')
                return
              }
              setText('')
              setAsking(false)
              await client.invalidateQueries({ queryKey: ['help'] })
            }}
          >
            <Field label="What do you need help with?" htmlFor="help-text">
              <textarea id="help-text" rows={4} maxLength={2000} value={text} onChange={(e) => setText(e.target.value)} className={inputClass} />
            </Field>
            {error && <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
            <Button type="submit" disabled={busy}>{busy ? 'Sending…' : 'Send request'}</Button>
          </form>
        </Modal>
      )}
    </Card>
  )
}

/** For the owner: one open request, with a button to mark it handled. */
export function HelpBanner({ request }: { request: HelpRequest }) {
  const client = useQueryClient()
  const [busy, setBusy] = useState(false)
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-danger-soft p-4" data-testid="help-request">
      <div className="min-w-0">
        <p className="text-sm font-semibold text-danger">Asked for help · {formatDate(request.created_at)}</p>
        <p className="break-words whitespace-pre-wrap">{request.body}</p>
      </div>
      <Button
        small
        variant="secondary"
        disabled={busy}
        onClick={async () => {
          setBusy(true)
          await supabase.rpc('resolve_help_request', { p_id: request.id })
          setBusy(false)
          await client.invalidateQueries({ queryKey: ['help'] })
        }}
      >
        Mark as handled
      </Button>
    </div>
  )
}

// ---------- Archive, block, delete (owner) ----------

const ACCOUNT_ERRORS: Record<string, string> = {
  person_not_found: 'We could not find that person. Reload the page.',
  not_allowed: 'Only the owner can do this.',
}

export function AccountActions({ person }: { person: Profile }) {
  const client = useQueryClient()
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [typed, setTyped] = useState('')

  const refresh = async () => {
    await client.invalidateQueries({ queryKey: ['people'] })
    await client.invalidateQueries({ queryKey: ['directory'] })
  }

  const archive = async (on: boolean) => {
    setBusy(true)
    setMessage(null)
    const { error } = await supabase.from('profiles').update({ archived_at: on ? new Date().toISOString() : null }).eq('id', person.id)
    setBusy(false)
    setMessage(error ? { ok: false, text: 'We could not save that. Please try again.' } : { ok: true, text: on ? 'Archived.' : 'Brought back.' })
    await refresh()
  }

  const account = async (action: 'block' | 'unblock' | 'delete') => {
    setBusy(true)
    setMessage(null)
    const result = await callAsMe('manage-account', { action, profile_id: person.id })
    setBusy(false)
    if (result.error) {
      setMessage({ ok: false, text: ACCOUNT_ERRORS[result.error] ?? 'That did not work. Please try again.' })
      return
    }
    if (action === 'delete') {
      client.clear()
      navigate('/admin/people', { replace: true })
      return
    }
    setMessage({ ok: true, text: action === 'block' ? 'Blocked. They can no longer sign in.' : 'Unblocked. They can sign in again.' })
    await refresh()
  }

  const firstName = person.full_name.split(' ')[0]

  return (
    <Card className="flex flex-col gap-4">
      <SectionTitle>Their account</SectionTitle>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-sans font-semibold">{person.archived_at ? 'Archived' : 'Archive'}</h3>
          <p className="text-sm text-muted">They can still sign in and read their history, but cannot change anything. Easy to undo.</p>
        </div>
        <Button variant="secondary" disabled={busy || !!person.blocked_at} onClick={() => void archive(!person.archived_at)}>
          {person.archived_at ? 'Bring back' : 'Archive'}
        </Button>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
        <div className="min-w-0">
          <h3 className="font-sans font-semibold">{person.blocked_at ? `Blocked since ${formatDate(person.blocked_at)}` : 'Block sign-in'}</h3>
          <p className="text-sm text-muted">They cannot sign in at all, nobody can message them, and they vanish from everyone’s lists. Everything they made is kept for you. Easy to undo.</p>
        </div>
        <Button variant="secondary" disabled={busy} onClick={() => void account(person.blocked_at ? 'unblock' : 'block')}>
          {person.blocked_at ? 'Unblock' : 'Block sign-in'}
        </Button>
      </div>

      <div className="flex flex-col gap-3 border-t border-line pt-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <h3 className="font-sans font-semibold text-danger">Delete for good</h3>
            <p className="text-sm text-muted">Erases their account and everything they made: tasks, handed-in work and files, messages, money numbers, shared files, votes, milestones. This cannot be undone.</p>
          </div>
          {!deleting && (
            <Button variant="secondary" disabled={busy} onClick={() => { setDeleting(true); setTyped('') }}>
              <Trash2 size={16} />
              Delete for good
            </Button>
          )}
        </div>
        {deleting && (
          <form
            className="flex flex-col gap-3 rounded-xl bg-danger-soft p-3"
            onSubmit={(e) => {
              e.preventDefault()
              if (typed.trim() === person.full_name) void account('delete')
            }}
          >
            <Field label={`To confirm, type their full name: ${person.full_name}`} htmlFor="delete-confirm">
              <input id="delete-confirm" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" className={inputClass} />
            </Field>
            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={busy || typed.trim() !== person.full_name}>{busy ? 'Deleting…' : `Delete ${firstName} for good`}</Button>
              <Button type="button" variant="secondary" onClick={() => setDeleting(false)}>Cancel</Button>
            </div>
          </form>
        )}
      </div>

      {message && (
        <p role={message.ok ? 'status' : 'alert'} className={`text-sm font-medium ${message.ok ? 'text-accent-strong' : 'text-danger'}`}>{message.text}</p>
      )}
    </Card>
  )
}
