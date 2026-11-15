import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, X } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { formatDate } from '../lib/data'
import { Badge, Button, Empty, Field, Modal, PageTitle, inputClass } from '../features/shared/ui'
import { useAuth } from './auth'
import { LoadError } from './Tasks'

interface PollOption {
  id: string
  label: string
  position: number
}

interface Poll {
  id: string
  question: string
  allow_multiple: boolean
  created_at: string
  closed_at: string | null
  poll_options: PollOption[]
}

interface Result {
  option_id: string
  votes: number
  voters: number
}

const MAX_CHOICES = 10

const POLL_ERRORS: Record<string, string> = {
  too_few_choices: 'Write at least two choices.',
  too_many_choices: `A poll can have up to ${MAX_CHOICES} choices.`,
  duplicate_choices: 'Two choices are the same. Make each one different.',
  one_choice_only: 'This poll takes one choice only.',
  no_choice: 'Pick a choice first.',
  poll_closed: 'This poll has closed. Reload the page to see the result.',
  choice_not_in_poll: 'That choice is no longer there. Reload the page.',
  poll_not_found: 'This poll is no longer there. Reload the page.',
}
const pollError = (message: string) => POLL_ERRORS[message] ?? 'Something went wrong. Please try again.'

function usePolls() {
  return useQuery({
    queryKey: ['polls'],
    refetchInterval: 15_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('polls')
        .select('id, question, allow_multiple, created_at, closed_at, poll_options(id, label, position)')
        .order('created_at', { ascending: false })
      if (error) throw new Error(error.message)
      return (data as Poll[]).map((p) => ({ ...p, poll_options: p.poll_options.slice().sort((a, b) => a.position - b.position) }))
    },
  })
}

/** Which choices I picked, per poll. Only my own votes are ever readable. */
function useMyVotes() {
  return useQuery({
    queryKey: ['my-votes'],
    queryFn: async () => {
      const { data, error } = await supabase.from('poll_votes').select('poll_id, option_id')
      if (error) throw new Error(error.message)
      const byPoll = new Map<string, string[]>()
      for (const v of data as { poll_id: string; option_id: string }[]) byPoll.set(v.poll_id, [...(byPoll.get(v.poll_id) ?? []), v.option_id])
      return byPoll
    },
  })
}

function useResults(pollId: string, enabled: boolean) {
  return useQuery({
    queryKey: ['poll-results', pollId],
    enabled,
    refetchInterval: 15_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('poll_results', { p_poll_id: pollId })
      if (error) throw new Error(error.message)
      return (data as Result[]).map((r) => ({ ...r, votes: Number(r.votes), voters: Number(r.voters) }))
    },
  })
}

export function PollsPage() {
  const { profile } = useAuth()
  const polls = usePolls()
  const myVotes = useMyVotes()
  const [creating, setCreating] = useState(false)
  if (!profile) return null

  const isOwner = profile.role === 'admin'
  const all = polls.data ?? []
  const open = all.filter((p) => !p.closed_at)
  const closed = all.filter((p) => p.closed_at)

  return (
    <>
      <PageTitle
        title="Polls"
        subtitle={isOwner ? 'Ask everyone a question. Votes are anonymous.' : 'Vote on the owner’s questions. Nobody can see what you chose.'}
        action={
          isOwner ? (
            <Button onClick={() => setCreating(true)}>
              <Plus size={17} />
              New poll
            </Button>
          ) : undefined
        }
      />

      {polls.isError || myVotes.isError ? (
        <LoadError />
      ) : polls.isLoading ? (
        <Empty>Loading…</Empty>
      ) : all.length === 0 ? (
        <Empty>{isOwner ? 'No polls yet. Tap “New poll” to ask your first question.' : 'No polls yet. The owner will add them here.'}</Empty>
      ) : (
        <>
          <section className="flex flex-col gap-3">
            <h2 className="text-base font-semibold">Open</h2>
            {open.length === 0 ? (
              <Empty>No open polls right now.</Empty>
            ) : (
              open.map((p) => <PollCard key={p.id} poll={p} mine={myVotes.data?.get(p.id) ?? []} isOwner={isOwner} canVote={!profile.archived_at} />)
            )}
          </section>
          {closed.length > 0 && (
            <section className="flex flex-col gap-3">
              <h2 className="text-base font-semibold">Closed</h2>
              {closed.map((p) => <PollCard key={p.id} poll={p} mine={myVotes.data?.get(p.id) ?? []} isOwner={isOwner} canVote={false} />)}
            </section>
          )}
        </>
      )}

      {creating && <NewPollModal onClose={() => setCreating(false)} />}
    </>
  )
}

function PollCard({ poll, mine, isOwner, canVote }: { poll: Poll; mine: string[]; isOwner: boolean; canVote: boolean }) {
  const client = useQueryClient()
  const voted = mine.length > 0
  const isClosed = !!poll.closed_at
  const [changing, setChanging] = useState(false)
  const [picked, setPicked] = useState<string[]>(mine)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)

  // The owner always sees the totals; voting is one tap away. Others vote first, then see them.
  const showForm = canVote && !isClosed && (changing || (!voted && !isOwner))
  const results = useResults(poll.id, isOwner || voted || isClosed)
  const rows = results.data ?? []
  const voters = rows[0]?.voters ?? 0

  const toggle = (id: string) => {
    setError('')
    if (!poll.allow_multiple) setPicked([id])
    else setPicked((list) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]))
  }

  const refresh = async () => {
    await client.invalidateQueries({ queryKey: ['polls'] })
    await client.invalidateQueries({ queryKey: ['my-votes'] })
    await client.invalidateQueries({ queryKey: ['poll-results', poll.id] })
  }

  const vote = async (e: React.FormEvent) => {
    e.preventDefault()
    if (picked.length === 0) {
      setError(pollError('no_choice'))
      return
    }
    setBusy(true)
    setError('')
    const { error: failed } = await supabase.rpc('cast_vote', { p_poll_id: poll.id, p_option_ids: picked })
    setBusy(false)
    if (failed) {
      setError(pollError(failed.message))
      return
    }
    setChanging(false)
    await refresh()
  }

  const setClosed = async (close: boolean) => {
    setBusy(true)
    const { error: failed } = await supabase.rpc('close_poll', { p_poll_id: poll.id, p_close: close })
    setBusy(false)
    if (failed) setError(pollError(failed.message))
    await refresh()
  }

  const remove = async () => {
    setBusy(true)
    const { error: failed } = await supabase.from('polls').delete().eq('id', poll.id)
    setBusy(false)
    if (failed) setError(pollError(failed.message))
    await refresh()
  }

  return (
    <article className="flex flex-col gap-4 rounded-2xl border border-line bg-surface p-4 sm:p-5" data-testid="poll">
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="font-sans text-base font-semibold break-words">{poll.question}</h3>
          <p className="text-sm text-muted">
            {poll.allow_multiple ? 'Choose one or more' : 'Choose one'} · {formatDate(poll.created_at)}
          </p>
        </div>
        {isClosed ? <Badge>Closed</Badge> : voted ? <Badge tone="accent">You voted</Badge> : <Badge tone="warn">{isOwner ? 'Open' : 'Waiting for your vote'}</Badge>}
      </header>

      {showForm ? (
        <form className="flex flex-col gap-3" onSubmit={vote}>
          <fieldset className="flex flex-col gap-2">
            <legend className="sr-only">{poll.question}</legend>
            {poll.poll_options.map((o) => {
              const checked = picked.includes(o.id)
              return (
                <label
                  key={o.id}
                  className={`flex cursor-pointer items-center gap-3 rounded-xl border px-3 py-2.5 transition-colors ${
                    checked ? 'border-accent bg-accent-soft' : 'border-line hover:bg-sunken'
                  }`}
                >
                  <input
                    type={poll.allow_multiple ? 'checkbox' : 'radio'}
                    name={`poll-${poll.id}`}
                    checked={checked}
                    onChange={() => toggle(o.id)}
                    className="h-4 w-4 shrink-0 accent-[var(--accent)]"
                  />
                  <span className="min-w-0 break-words">{o.label}</span>
                </label>
              )
            })}
          </fieldset>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" disabled={busy}>{busy ? 'Saving…' : voted ? 'Save my new vote' : 'Vote'}</Button>
            {changing && (
              <Button type="button" variant="secondary" onClick={() => { setChanging(false); setPicked(mine); setError('') }}>
                {voted ? 'Keep my old vote' : 'Cancel'}
              </Button>
            )}
          </div>
        </form>
      ) : results.isLoading && results.fetchStatus !== 'idle' ? (
        <Empty>Loading the results…</Empty>
      ) : rows.length > 0 ? (
        <ResultBars options={poll.poll_options} rows={rows} mine={mine} />
      ) : (
        <ul className="flex flex-col gap-1.5 text-sm">
          {poll.poll_options.map((o) => (
            <li key={o.id} className="rounded-lg bg-sunken px-3 py-2">{o.label}</li>
          ))}
        </ul>
      )}

      {(rows.length > 0 || isOwner) && (
        <p className="text-sm text-muted" data-testid="voter-count">
          {voters === 1 ? '1 person has voted' : `${voters} people have voted`}
          {poll.allow_multiple && voters > 0 ? ' · people could pick more than one, so the bars add up to more than 100%' : ''}
        </p>
      )}

      {!showForm && canVote && !isClosed && (voted || isOwner) && (
        <div>
          <Button small variant="secondary" onClick={() => { setPicked(mine); setChanging(true) }}>{voted ? 'Change my vote' : 'Vote yourself'}</Button>
        </div>
      )}

      {isOwner && (
        <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
          {confirmDelete ? (
            <>
              <span className="text-sm">Delete this poll and all its votes? This cannot be undone.</span>
              <Button small disabled={busy} onClick={() => void remove()}>Yes, delete it</Button>
              <Button small variant="secondary" onClick={() => setConfirmDelete(false)}>Keep it</Button>
            </>
          ) : (
            <>
              {isClosed ? (
                <Button small variant="secondary" disabled={busy} onClick={() => void setClosed(false)}>Open it again</Button>
              ) : (
                <Button small variant="secondary" disabled={busy} onClick={() => void setClosed(true)}>Close the poll</Button>
              )}
              <Button small variant="ghost" onClick={() => setConfirmDelete(true)}>Delete</Button>
            </>
          )}
        </div>
      )}

      {error && <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
    </article>
  )
}

/** One bar per choice: the share of voters who picked it. */
function ResultBars({ options, rows, mine }: { options: PollOption[]; rows: Result[]; mine: string[] }) {
  const voters = rows[0]?.voters ?? 0
  const top = Math.max(...rows.map((r) => r.votes), 0)
  return (
    <ul className="flex flex-col gap-3" aria-label="Results">
      {options.map((o) => {
        const votes = rows.find((r) => r.option_id === o.id)?.votes ?? 0
        const share = voters ? votes / voters : 0
        const leading = votes > 0 && votes === top
        return (
          <li key={o.id} className="flex flex-col gap-1" data-testid="poll-result">
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className={`min-w-0 break-words ${leading ? 'font-semibold' : ''}`}>
                {o.label}
                {mine.includes(o.id) && <span className="ml-2 text-xs font-medium text-accent-strong">your choice</span>}
              </span>
              <span className="shrink-0 tabular-nums">
                <span className="font-semibold">{Math.round(share * 100)}%</span>
                <span className="text-muted"> · {votes} {votes === 1 ? 'vote' : 'votes'}</span>
              </span>
            </div>
            <div className="h-2.5 overflow-hidden rounded-full bg-sunken">
              <div className={`h-full rounded-full transition-all duration-500 ${leading ? 'bg-accent' : 'bg-accent/45'}`} style={{ width: `${share * 100}%` }} />
            </div>
          </li>
        )
      })}
    </ul>
  )
}

function NewPollModal({ onClose }: { onClose: () => void }) {
  const client = useQueryClient()
  const [question, setQuestion] = useState('')
  const [choices, setChoices] = useState(['', '', ''])
  const [multiple, setMultiple] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const setChoice = (i: number, value: string) => setChoices((list) => list.map((c, j) => (j === i ? value : c)))

  return (
    <Modal title="New poll" onClose={onClose}>
      <form
        className="flex flex-col gap-4"
        noValidate
        onSubmit={async (e) => {
          e.preventDefault()
          if (!question.trim()) {
            setError('Write the question first.')
            return
          }
          const filled = choices.map((c) => c.trim()).filter(Boolean)
          if (filled.length < 2) {
            setError(pollError('too_few_choices'))
            return
          }
          setBusy(true)
          setError('')
          const { error: failed } = await supabase.rpc('create_poll', { p_question: question.trim(), p_options: filled, p_allow_multiple: multiple })
          setBusy(false)
          if (failed) {
            setError(pollError(failed.message))
            return
          }
          await client.invalidateQueries({ queryKey: ['polls'] })
          onClose()
        }}
      >
        <Field label="Question" htmlFor="poll-question">
          <input id="poll-question" maxLength={300} value={question} onChange={(e) => setQuestion(e.target.value)} className={inputClass} />
        </Field>

        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1.5 text-sm font-medium">Choices</legend>
          {choices.map((c, i) => (
            <div key={i} className="flex gap-2">
              <label htmlFor={`poll-choice-${i}`} className="sr-only">Choice {i + 1}</label>
              <input
                id={`poll-choice-${i}`}
                maxLength={200}
                value={c}
                onChange={(e) => setChoice(i, e.target.value)}
                placeholder={`Choice ${i + 1}`}
                className={`${inputClass} min-w-0 flex-1`}
              />
              {choices.length > 2 && (
                <button
                  type="button"
                  onClick={() => setChoices((list) => list.filter((_, j) => j !== i))}
                  aria-label={`Remove choice ${i + 1}`}
                  className="shrink-0 rounded-lg px-2 text-muted hover:bg-sunken hover:text-ink"
                >
                  <X size={17} />
                </button>
              )}
            </div>
          ))}
          {choices.length < MAX_CHOICES && (
            <div>
              <Button small type="button" variant="ghost" onClick={() => setChoices((list) => [...list, ''])}>
                <Plus size={15} />
                Add a choice
              </Button>
            </div>
          )}
        </fieldset>

        <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-line px-3 py-2.5">
          <input type="checkbox" checked={multiple} onChange={(e) => setMultiple(e.target.checked)} className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--accent)]" />
          <span>
            <span className="block font-medium">People can pick more than one</span>
            <span className="block text-sm text-muted">Leave this off if each person should pick just one choice.</span>
          </span>
        </label>

        {error && <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
        <Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Start the poll'}</Button>
      </form>
    </Modal>
  )
}
