import { useEffect, useRef, useState } from 'react'
import { Check, CheckCheck, Send } from 'lucide-react'
import { formatWhen, threadBetween } from '../../lib/data'
import { useStore } from '../../lib/store'
import { Button, Empty, inputClass } from './ui'

/** One private conversation between two people. `me` is the person looking at the screen. */
export function Chat({ me, other }: { me: string; other: string }) {
  const { state, sendMessage, markRead } = useStore()
  const [draft, setDraft] = useState('')
  const endRef = useRef<HTMLDivElement>(null)
  const messages = threadBetween(state, me, other)

  // Opening the conversation counts as reading it.
  useEffect(() => {
    markRead(me, other)
  }, [me, other, messages.length, markRead])

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'nearest' })
  }, [messages.length])

  const send = (e: React.FormEvent) => {
    e.preventDefault()
    const body = draft.trim()
    if (!body) return
    sendMessage(me, other, body)
    setDraft('')
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex max-h-[26rem] flex-col gap-2 overflow-y-auto rounded-xl bg-sunken p-3" data-testid="chat-thread">
        {messages.length === 0 && <Empty>No messages yet. Say hello!</Empty>}
        {messages.map((m) => {
          const mine = m.from === me
          return (
            <div key={m.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
              <div
                className={`max-w-[85%] rounded-2xl px-3.5 py-2 ${
                  mine ? 'rounded-br-md bg-accent text-on-accent' : 'rounded-bl-md border border-line bg-surface'
                }`}
              >
                <p className="break-words whitespace-pre-wrap">{m.body}</p>
                <p className={`mt-1 flex items-center justify-end gap-1 text-[11px] ${mine ? 'opacity-80' : 'text-muted'}`}>
                  {formatWhen(m.at)}
                  {mine &&
                    (m.read ? (
                      <CheckCheck size={13} aria-label="Read" />
                    ) : (
                      <Check size={13} aria-label="Sent" />
                    ))}
                </p>
              </div>
            </div>
          )
        })}
        <div ref={endRef} />
      </div>
      <form onSubmit={send} className="flex gap-2">
        <label htmlFor={`chat-input-${other}`} className="sr-only">
          Write a message
        </label>
        <input
          id={`chat-input-${other}`}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Write a message"
          autoComplete="off"
          className={`${inputClass} min-w-0 flex-1`}
        />
        <Button type="submit" disabled={!draft.trim()} aria-label="Send message">
          <Send size={16} />
          <span className="hidden sm:inline">Send</span>
        </Button>
      </form>
    </div>
  )
}
