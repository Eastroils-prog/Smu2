import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Briefcase, Check, CheckCheck, Send } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { formatWhen } from '../lib/data'
import { Avatar, Badge, Button, Empty, PageTitle, inputClass } from '../features/shared/ui'
import { useAuth } from './auth'
import { LoadError } from './Tasks'
import { unreadFrom, useDirectory, useMessages, type Contact, type Message } from './data'

function ContactIcon({ contact }: { contact: Contact }) {
  if (!contact.is_owner) return <Avatar name={contact.full_name} />
  return (
    <span aria-hidden="true" className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent text-on-accent">
      <Briefcase size={17} />
    </span>
  )
}

const between = (messages: Message[], a: string, b: string) =>
  messages.filter((m) => (m.sender_id === a && m.recipient_id === b) || (m.sender_id === b && m.recipient_id === a))

/** The list of conversations, or one open conversation. Used by both the owner and participants. */
export function MessagesPage({ base }: { base: string }) {
  const { id } = useParams()
  const { profile } = useAuth()
  const directory = useDirectory()
  const messages = useMessages()
  if (!profile) return null

  const contacts = directory.data ?? []
  const all = messages.data ?? []
  const open = contacts.find((c) => c.id === id)

  if (id) {
    return (
      <>
        <Link to={base} className="inline-flex items-center gap-1.5 self-start text-sm font-medium text-accent-strong">
          <ArrowLeft size={16} />
          All conversations
        </Link>
        {directory.isLoading ? (
          <Empty>Loading…</Empty>
        ) : !open ? (
          <Empty>You cannot write to this person right now.</Empty>
        ) : (
          <>
            <div className="flex items-center gap-3">
              <ContactIcon contact={open} />
              <div className="min-w-0">
                <h1 className="truncate text-xl font-bold">{open.full_name}</h1>
                <p className="text-sm text-muted">Only the two of you can read this.</p>
              </div>
            </div>
            <Thread me={profile.id} other={open.id} messages={between(all, profile.id, open.id)} canSend={!profile.archived_at} />
          </>
        )}
      </>
    )
  }

  const rows = contacts
    .map((contact) => {
      const thread = between(all, profile.id, contact.id)
      return { contact, last: thread[thread.length - 1], unread: unreadFrom(all, profile.id, contact.id) }
    })
    .sort((a, b) => (b.last?.created_at ?? '').localeCompare(a.last?.created_at ?? '') || Number(b.contact.is_owner) - Number(a.contact.is_owner))

  return (
    <>
      <PageTitle title="Messages" subtitle="Each conversation is private between two people." />
      {directory.isError || messages.isError ? (
        <LoadError />
      ) : directory.isLoading || messages.isLoading ? (
        <Empty>Loading…</Empty>
      ) : rows.length === 0 ? (
        <Empty>Nobody to write to yet. People appear here once they have joined.</Empty>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map(({ contact, last, unread }) => (
            <li key={contact.id}>
              <Link
                to={`${base}/${contact.id}`}
                className="flex w-full items-center gap-3 rounded-2xl border border-line bg-surface p-4 text-left transition-colors hover:border-accent"
              >
                <ContactIcon contact={contact} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline justify-between gap-2">
                    <span className={`truncate ${unread ? 'font-bold' : 'font-semibold'}`}>{contact.full_name}</span>
                    {last && <span className="shrink-0 text-xs text-muted">{formatWhen(last.created_at)}</span>}
                  </span>
                  <span className={`block truncate text-sm ${unread ? 'text-ink' : 'text-muted'}`}>
                    {last ? `${last.sender_id === profile.id ? 'You: ' : ''}${last.body}` : contact.is_owner ? 'Programme owner · no messages yet' : 'No messages yet'}
                  </span>
                </span>
                {unread > 0 && <Badge tone="accent">{unread} new</Badge>}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}

function Thread({ me, other, messages, canSend }: { me: string; other: string; messages: Message[]; canSend: boolean }) {
  const client = useQueryClient()
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const endRef = useRef<HTMLDivElement>(null)
  const unread = unreadFrom(messages, me, other)

  // Opening the conversation counts as reading it.
  useEffect(() => {
    if (unread === 0) return
    void supabase.rpc('mark_conversation_read', { p_other: other }).then(() => client.invalidateQueries({ queryKey: ['messages'] }))
  }, [unread, other, client])

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'nearest' })
  }, [messages.length])

  const send = async (e: React.FormEvent) => {
    e.preventDefault()
    const body = draft.trim()
    if (!body) return
    setBusy(true)
    setError('')
    const { error: failed } = await supabase.rpc('send_message', { p_to: other, p_body: body })
    setBusy(false)
    if (failed) {
      setError(failed.message === 'recipient_not_available' ? 'This person can no longer receive messages.' : 'Your message was not sent. Please try again.')
      return
    }
    setDraft('')
    await client.invalidateQueries({ queryKey: ['messages'] })
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex max-h-[26rem] flex-col gap-2 overflow-y-auto rounded-xl bg-sunken p-3" data-testid="chat-thread">
        {messages.length === 0 && <Empty>No messages yet. Say hello!</Empty>}
        {messages.map((m) => {
          const mine = m.sender_id === me
          return (
            <div key={m.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[85%] rounded-2xl px-3.5 py-2 ${mine ? 'rounded-br-md bg-accent text-on-accent' : 'rounded-bl-md border border-line bg-surface'}`}>
                <p className="break-words whitespace-pre-wrap">{m.body}</p>
                <p className={`mt-1 flex items-center justify-end gap-1 text-[11px] ${mine ? 'opacity-80' : 'text-muted'}`}>
                  {formatWhen(m.created_at)}
                  {mine && (m.read_at ? <CheckCheck size={13} aria-label="Read" /> : <Check size={13} aria-label="Sent" />)}
                </p>
              </div>
            </div>
          )
        })}
        <div ref={endRef} />
      </div>
      {canSend ? (
        <form onSubmit={send} className="flex gap-2">
          <label htmlFor="message-input" className="sr-only">Write a message</label>
          <input id="message-input" value={draft} maxLength={5000} onChange={(e) => setDraft(e.target.value)} placeholder="Write a message" autoComplete="off" className={`${inputClass} min-w-0 flex-1`} />
          <Button type="submit" disabled={busy || !draft.trim()} aria-label="Send message">
            <Send size={16} />
            <span className="hidden sm:inline">Send</span>
          </Button>
        </form>
      ) : (
        <p className="rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn">Your account is archived, so you can read messages but not send them.</p>
      )}
      {error && <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
      <p className="text-xs text-muted">New messages appear within a few seconds.</p>
    </div>
  )
}
