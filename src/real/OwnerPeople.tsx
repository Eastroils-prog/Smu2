import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Check, Copy, Link2, UserPlus } from 'lucide-react'
import { PROFILE_COLUMNS, supabase, type Invitation, type Profile, type Stage } from '../lib/supabase'
import { formatDate } from '../lib/data'
import { Avatar, Badge, Button, Card, Empty, Field, Modal, PageTitle, SectionTitle, inputClass } from '../features/shared/ui'
import { callAsMe } from './auth'

// ---------- Data ----------

export function useStages() {
  return useQuery({
    queryKey: ['stages'],
    queryFn: async () => {
      const { data, error } = await supabase.from('stages').select('id, position, name, description').eq('is_archived', false).order('position')
      if (error) throw error
      return data as Stage[]
    },
  })
}

function usePeople() {
  return useQuery({
    queryKey: ['people'],
    queryFn: async () => {
      const { data, error } = await supabase.from('profiles').select(PROFILE_COLUMNS).eq('role', 'participant').order('full_name')
      if (error) throw error
      return data as Profile[]
    },
  })
}

function useInvitations() {
  return useQuery({
    queryKey: ['invitations'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('participant_invitations')
        .select('id, email, full_name, status, expires_at, created_at')
        .eq('status', 'pending')
        .order('created_at', { ascending: false })
      if (error) throw error
      return data as Invitation[]
    },
  })
}

const INVITE_ERRORS: Record<string, string> = {
  email_in_use: 'Someone with that e-mail is already in the programme.',
  already_invited: 'That e-mail already has an invitation waiting. You can get a new link for it from the list.',
  invalid_input: 'Check the name and the e-mail address.',
  link_not_created: 'We could not make the link. Please try again in a minute.',
  person_not_found: 'We could not find that person.',
  not_allowed: 'Only the owner can do this.',
}
const inviteError = (code: string) => INVITE_ERRORS[code] ?? 'Something went wrong. Please try again.'

/** A one-time link the owner copies and sends to the person themselves. */
function ShareLink({ link, forWhom }: { link: string; forWhom: string }) {
  const [copied, setCopied] = useState(false)
  const copy = async (e: React.MouseEvent) => {
    const input = (e.currentTarget.parentElement?.querySelector('input') ?? null) as HTMLInputElement | null
    try {
      await navigator.clipboard.writeText(link)
      setCopied(true)
    } catch {
      // Copying was refused: select the text so it can be copied by hand.
      input?.select()
    }
  }
  return (
    <div className="flex flex-col gap-2 rounded-xl bg-accent-soft p-3" data-testid="share-link">
      <p className="text-sm font-semibold">Send this link to {forWhom}</p>
      <div className="flex gap-2">
        <label htmlFor={`link-${link.length}-${forWhom}`} className="sr-only">Link for {forWhom}</label>
        <input
          id={`link-${link.length}-${forWhom}`}
          readOnly
          value={link}
          onFocus={(e) => e.currentTarget.select()}
          className={`${inputClass} min-w-0 flex-1 text-sm`}
        />
        <Button small type="button" onClick={(e) => void copy(e)}>
          {copied ? <Check size={15} /> : <Copy size={15} />}
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>
      <p className="text-sm text-muted">
        Send it yourself, for example by WhatsApp or e-mail. It works once and for 24 hours. Whoever opens it first can use it, so send it only to {forWhom}. You cannot see this link again later, but you can always make a new one.
      </p>
    </div>
  )
}

function LoadError() {
  return <p role="alert" className="rounded-xl bg-danger-soft px-4 py-3 text-danger">We could not load this. Check your connection and reload the page.</p>
}

// ---------- People list ----------

export function OwnerPeople() {
  const people = usePeople()
  const invitations = useInvitations()
  const stages = useStages()
  const [inviting, setInviting] = useState(false)
  const stageName = (id: string | null) => stages.data?.find((s) => s.id === id)?.name ?? ''
  const joined = (people.data ?? []).filter((p) => p.status !== 'invited')

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

      {(people.isError || invitations.isError) && <LoadError />}

      <section className="flex flex-col gap-3">
        <h2 className="text-base font-semibold">Waiting to join</h2>
        {invitations.isLoading ? (
          <Empty>Loading…</Empty>
        ) : invitations.data?.length ? (
          <ul className="flex flex-col gap-3">
            {invitations.data.map((inv) => (
              <li key={inv.id}>
                <InvitationRow invitation={inv} />
              </li>
            ))}
          </ul>
        ) : (
          <Empty>No invitations are waiting.</Empty>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-base font-semibold">In the programme</h2>
        {people.isLoading ? (
          <Empty>Loading…</Empty>
        ) : joined.length ? (
          <ul className="flex flex-col gap-3">
            {joined.map((p) => (
              <li key={p.id}>
                <Link
                  to={`/admin/people/${p.id}`}
                  className="flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-surface p-4 transition-colors hover:border-accent"
                >
                  <Avatar name={p.full_name} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">{p.full_name}</span>
                    <span className="block truncate text-sm text-muted">
                      @{p.username} · {stageName(p.current_stage_id) || 'No stage yet'}
                    </span>
                  </span>
                  {p.archived_at ? <Badge>Archived</Badge> : <Badge tone="accent">Active</Badge>}
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <Empty>Nobody has joined yet. Invite your first person.</Empty>
        )}
      </section>

      {inviting && <InviteModal stages={stages.data ?? []} onClose={() => setInviting(false)} />}
    </>
  )
}

// Links made in this visit, by e-mail address. They are kept only in memory:
// the server never stores a link, so it cannot be shown again after a reload.
const newLinks = new Map<string, string>()

function InvitationRow({ invitation }: { invitation: Invitation }) {
  const client = useQueryClient()
  const [busy, setBusy] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [note, setNote] = useState('')
  const expired = new Date(invitation.expires_at).getTime() < Date.now()
  const fresh = newLinks.get(invitation.email)

  const run = async (action: 'resend' | 'revoke') => {
    setBusy(true)
    setNote('')
    const result = await callAsMe('invite-participant', { action, invitation_id: invitation.id, redirect_to: window.location.origin })
    setBusy(false)
    setConfirming(false)
    if (result.error) setNote(inviteError(result.error))
    // A new link replaces the invitation row, so remember it by e-mail address.
    else if (result.link) newLinks.set(invitation.email, result.link)
    await client.invalidateQueries({ queryKey: ['invitations'] })
    await client.invalidateQueries({ queryKey: ['people'] })
  }

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-4" data-testid="invitation">
      <div className="flex flex-wrap items-center gap-3">
        <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-sunken text-muted">
          <Link2 size={17} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-semibold">{invitation.full_name}</span>
          <span className="block text-sm break-all text-muted">{invitation.email}</span>
        </span>
        {expired ? <Badge tone="danger">Expired</Badge> : <Badge tone="warn">Waiting since {formatDate(invitation.created_at)}</Badge>}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {confirming ? (
          <>
            <span className="text-sm">Cancel this invitation? Their link will stop working.</span>
            <Button small disabled={busy} onClick={() => void run('revoke')}>Yes, cancel it</Button>
            <Button small variant="secondary" disabled={busy} onClick={() => setConfirming(false)}>Keep it</Button>
          </>
        ) : (
          <>
            <Button small variant="secondary" disabled={busy} onClick={() => void run('resend')}>Get a new link</Button>
            <Button small variant="ghost" disabled={busy} onClick={() => setConfirming(true)}>Cancel invitation</Button>
          </>
        )}
        {note && <span role="status" className="text-sm text-muted">{note}</span>}
      </div>
      {fresh && <ShareLink link={fresh} forWhom={invitation.full_name} />}
    </div>
  )
}

function InviteModal({ stages, onClose }: { stages: Stage[]; onClose: () => void }) {
  const client = useQueryClient()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [stageId, setStageId] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [link, setLink] = useState('')

  if (link) {
    return (
      <Modal title="Invitation ready" onClose={onClose}>
        <div className="flex flex-col gap-4">
          <ShareLink link={link} forWhom={name.trim()} />
          <Button type="button" onClick={onClose}>Done</Button>
        </div>
      </Modal>
    )
  }

  return (
    <Modal title="Invite a person" onClose={onClose}>
      <form
        className="flex flex-col gap-4"
        noValidate
        onSubmit={async (e) => {
          e.preventDefault()
          if (!name.trim() || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) {
            setError('Type their name and a full e-mail address.')
            return
          }
          setBusy(true)
          setError('')
          const result = await callAsMe('invite-participant', {
            action: 'invite',
            full_name: name.trim(),
            email: email.trim(),
            stage_id: stageId || stages[0]?.id,
            redirect_to: window.location.origin,
          })
          setBusy(false)
          if (result.error || !result.link) {
            setError(inviteError(result.error ?? 'link_not_created'))
            return
          }
          newLinks.set(email.trim().toLowerCase(), result.link)
          await client.invalidateQueries({ queryKey: ['invitations'] })
          setLink(result.link)
        }}
      >
        <Field label="Their name" htmlFor="invite-name">
          <input id="invite-name" value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
        </Field>
        <Field label="Their e-mail" htmlFor="invite-email">
          <input id="invite-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoCapitalize="none" className={inputClass} />
        </Field>
        <Field label="Which stage do they start in?" htmlFor="invite-stage">
          <select id="invite-stage" value={stageId || stages[0]?.id || ''} onChange={(e) => setStageId(e.target.value)} className={inputClass}>
            {stages.map((s) => (
              <option key={s.id} value={s.id}>{s.position}. {s.name}</option>
            ))}
          </select>
        </Field>
        <p className="text-sm text-muted">You get a link to send them yourself. They open it and pick their own username and password.</p>
        {error && <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
        <Button type="submit" disabled={busy}>{busy ? 'Making the link…' : 'Make invitation link'}</Button>
      </form>
    </Modal>
  )
}

// ---------- One person ----------

export function OwnerPerson() {
  const { id = '' } = useParams()
  const client = useQueryClient()
  const stages = useStages()
  const [note, setNote] = useState('')
  const [resetLink, setResetLink] = useState('')
  const [resetBusy, setResetBusy] = useState(false)
  const person = useQuery({
    queryKey: ['people', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('profiles').select(PROFILE_COLUMNS).eq('id', id).maybeSingle()
      if (error) throw error
      return data as Profile | null
    },
  })

  const change = async (patch: Partial<Profile>, done: string) => {
    setNote('')
    const { error } = await supabase.from('profiles').update(patch).eq('id', id)
    setNote(error ? 'We could not save that. Please try again.' : done)
    await client.invalidateQueries({ queryKey: ['people'] })
  }

  const back = (
    <Link to="/admin/people" className="inline-flex items-center gap-1.5 self-start text-sm font-medium text-accent-strong">
      <ArrowLeft size={16} />
      All people
    </Link>
  )

  if (person.isLoading) return <>{back}<Empty>Loading…</Empty></>
  if (person.isError) return <>{back}<LoadError /></>
  const p = person.data
  if (!p) return <>{back}<Empty>We could not find that person.</Empty></>

  return (
    <>
      {back}
      <div className="flex flex-wrap items-center gap-4">
        <Avatar name={p.full_name} size="lg" />
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-bold tracking-tight">{p.full_name}</h1>
          <p className="text-sm break-all text-muted">
            @{p.username} · {p.email}{p.joined_at ? ` · joined ${formatDate(p.joined_at)}` : ''}
          </p>
        </div>
        {p.archived_at ? <Badge>Archived</Badge> : <Badge tone="accent">Active</Badge>}
      </div>

      <Card>
        <SectionTitle>Stage</SectionTitle>
        <Field label="Which stage are they in? Only you can change this." htmlFor="person-stage">
          <select
            id="person-stage"
            value={p.current_stage_id ?? ''}
            onChange={(e) => void change({ current_stage_id: e.target.value }, 'Stage saved.')}
            className={`${inputClass} max-w-sm`}
          >
            {(stages.data ?? []).map((s) => (
              <option key={s.id} value={s.id}>{s.position}. {s.name}</option>
            ))}
          </select>
        </Field>
      </Card>

      <Card>
        <SectionTitle>Business idea</SectionTitle>
        <p className="break-words whitespace-pre-wrap">{p.business_idea || 'Not written yet.'}</p>
        <h3 className="mt-4 mb-1 font-sans text-sm font-semibold text-muted">Goals</h3>
        <p className="break-words whitespace-pre-wrap">{p.current_goals || 'Not written yet.'}</p>
      </Card>

      <Card className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-semibold">{p.archived_at ? 'This person is archived' : 'Archive this person'}</h2>
          <p className="text-sm text-muted">
            {p.archived_at
              ? 'They can still sign in and read, but cannot change anything.'
              : 'They keep their history and can still read it, but can no longer change anything.'}
          </p>
        </div>
        {p.archived_at ? (
          <Button variant="secondary" onClick={() => void change({ archived_at: null }, 'Brought back.')}>Bring back</Button>
        ) : (
          <Button variant="secondary" onClick={() => void change({ archived_at: new Date().toISOString() }, 'Archived.')}>Archive</Button>
        )}
      </Card>

      <Card className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-base font-semibold">Forgot their password?</h2>
            <p className="text-sm text-muted">Make a link that lets them choose a new password, and send it to them.</p>
          </div>
          <Button
            variant="secondary"
            disabled={resetBusy}
            onClick={async () => {
              setResetBusy(true)
              setNote('')
              const result = await callAsMe('invite-participant', { action: 'reset-link', profile_id: id, redirect_to: window.location.origin })
              setResetBusy(false)
              if (result.error || !result.link) setNote(inviteError(result.error ?? 'link_not_created'))
              else setResetLink(result.link)
            }}
          >
            {resetBusy ? 'Making the link…' : 'Make a password link'}
          </Button>
        </div>
        {resetLink && <ShareLink link={resetLink} forWhom={p.full_name} />}
      </Card>

      {note && <p role="status" className="text-sm font-medium text-accent-strong">{note}</p>}
    </>
  )
}
