import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { Button, Card, Empty, Field, PageTitle, SectionTitle, inputClass } from '../features/shared/ui'
import { useAuth } from './auth'
import { LoadError } from './Tasks'
import { money, monthLabel, useFinance, type FinanceEntry } from './data'

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

// ---------- Summary and chart (shared by the participant and the owner) ----------

function Totals({ entries }: { entries: FinanceEntry[] }) {
  const totalIn = entries.reduce((n, e) => n + e.money_in, 0)
  const totalOut = entries.reduce((n, e) => n + e.money_out, 0)
  const left = totalIn - totalOut
  const tiles = [
    { label: 'Money in, all months', value: money(totalIn) },
    { label: 'Money out, all months', value: money(totalOut) },
    { label: left < 0 ? 'Short by' : 'Left over', value: money(Math.abs(left)), warn: left < 0 },
  ]
  return (
    <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      {tiles.map((t) => (
        <div key={t.label} className="rounded-2xl border border-line bg-surface p-4">
          <dd className={`font-display text-2xl font-bold tabular-nums ${t.warn ? 'text-danger' : ''}`}>{t.value}</dd>
          <dt className="text-sm text-muted">{t.label}</dt>
        </div>
      ))}
    </dl>
  )
}

/** A round number at or above `value`, so the top grid line has a clean label. */
function niceTop(value: number): number {
  if (value <= 0) return 100
  const power = 10 ** Math.floor(Math.log10(value))
  const lead = value / power
  return (lead <= 1 ? 1 : lead <= 2 ? 2 : lead <= 5 ? 5 : 10) * power
}

/** Money in and money out, side by side, for the last 12 months that have numbers. */
function MoneyChart({ entries }: { entries: FinanceEntry[] }) {
  const shown = entries.slice(-12)
  const [active, setActive] = useState<string | null>(null)
  const top = niceTop(Math.max(...shown.map((e) => Math.max(e.money_in, e.money_out)), 0))
  const focus = shown.find((e) => e.id === active)
  const height = (amount: number) => `${(amount / top) * 100}%`

  return (
    <figure className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted">
        <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-series-in" />Money in</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-series-out" />Money out</span>
      </div>

      <div className="flex gap-2">
        <div className="flex h-44 flex-col justify-between text-right text-xs text-muted tabular-nums" aria-hidden="true">
          <span>{money(top)}</span>
          <span>{money(top / 2)}</span>
          <span>{money(0)}</span>
        </div>
        <div className="min-w-0 flex-1">
          <div className="relative h-44">
            <div className="absolute inset-0 flex flex-col justify-between" aria-hidden="true">
              <span className="block border-t border-line" />
              <span className="block border-t border-dashed border-line" />
              <span className="block border-t border-line" />
            </div>
            <ul className="absolute inset-0 flex items-end justify-around gap-1" aria-label="Money in and money out by month">
              {shown.map((e) => (
                <li key={e.id} className="flex h-full min-w-0 flex-1 justify-center">
                  <button
                    type="button"
                    onMouseEnter={() => setActive(e.id)}
                    onMouseLeave={() => setActive(null)}
                    onFocus={() => setActive(e.id)}
                    onBlur={() => setActive(null)}
                    onClick={() => setActive(e.id)}
                    aria-label={`${monthLabel(e.month, true)}: money in ${money(e.money_in)}, money out ${money(e.money_out)}`}
                    className={`flex h-full w-full max-w-14 items-end justify-center gap-0.5 rounded-md px-1 ${active === e.id ? 'bg-sunken' : ''}`}
                  >
                    <span className="w-1/2 max-w-4 rounded-t bg-series-in" style={{ height: height(e.money_in), minHeight: e.money_in > 0 ? 2 : 0 }} />
                    <span className="w-1/2 max-w-4 rounded-t bg-series-out" style={{ height: height(e.money_out), minHeight: e.money_out > 0 ? 2 : 0 }} />
                  </button>
                </li>
              ))}
            </ul>
          </div>
          <ul className="mt-1 flex justify-around gap-1 text-xs text-muted" aria-hidden="true">
            {shown.map((e) => (
              <li key={e.id} className="min-w-0 flex-1 truncate text-center">{monthLabel(e.month)}</li>
            ))}
          </ul>
        </div>
      </div>

      <figcaption className="min-h-10 rounded-lg bg-sunken px-3 py-2 text-sm" aria-live="polite">
        {focus ? (
          <>
            <strong>{monthLabel(focus.month, true)}</strong>: in {money(focus.money_in)}, out {money(focus.money_out)},{' '}
            {focus.money_in - focus.money_out < 0 ? 'short by' : 'left over'} {money(Math.abs(focus.money_in - focus.money_out))}
          </>
        ) : (
          <span className="text-muted">Point at a month, or tap it, to see its numbers.</span>
        )}
      </figcaption>
    </figure>
  )
}

function MonthTable({ entries, onEdit, onRemove }: { entries: FinanceEntry[]; onEdit?: (e: FinanceEntry) => void; onRemove?: (e: FinanceEntry) => void }) {
  const [confirming, setConfirming] = useState<string | null>(null)
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[26rem] text-sm">
        <thead>
          <tr className="border-b border-line text-left text-xs tracking-wide text-muted uppercase">
            <th scope="col" className="py-2 pr-3 font-semibold">Month</th>
            <th scope="col" className="py-2 pr-3 text-right font-semibold">In</th>
            <th scope="col" className="py-2 pr-3 text-right font-semibold">Out</th>
            <th scope="col" className="py-2 pr-3 text-right font-semibold">Left</th>
            {onEdit && <th scope="col" className="py-2 font-semibold"><span className="sr-only">Actions</span></th>}
          </tr>
        </thead>
        <tbody>
          {entries.slice().reverse().map((e) => {
            const left = e.money_in - e.money_out
            return (
              <tr key={e.id} className="border-b border-line align-top last:border-0" data-testid="money-row">
                <th scope="row" className="py-2.5 pr-3 text-left font-medium">
                  {monthLabel(e.month, true)}
                  {e.note && <span className="block max-w-xs text-xs font-normal break-words text-muted">{e.note}</span>}
                </th>
                <td className="py-2.5 pr-3 text-right tabular-nums">{money(e.money_in)}</td>
                <td className="py-2.5 pr-3 text-right tabular-nums">{money(e.money_out)}</td>
                <td className={`py-2.5 pr-3 text-right font-semibold tabular-nums ${left < 0 ? 'text-danger' : ''}`}>{left < 0 ? `−${money(-left)}` : money(left)}</td>
                {onEdit && onRemove && (
                  <td className="py-2 text-right whitespace-nowrap">
                    {confirming === e.id ? (
                      <>
                        <Button small onClick={() => { setConfirming(null); onRemove(e) }}>Remove</Button>{' '}
                        <Button small variant="secondary" onClick={() => setConfirming(null)}>Keep</Button>
                      </>
                    ) : (
                      <>
                        <Button small variant="ghost" onClick={() => onEdit(e)} aria-label={`Change ${monthLabel(e.month, true)}`}>Change</Button>
                        <Button small variant="ghost" onClick={() => setConfirming(e.id)} aria-label={`Remove ${monthLabel(e.month, true)}`}>Remove</Button>
                      </>
                    )}
                  </td>
                )}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ---------- Owner: one person's money, read-only ----------

export function PersonMoney({ personId }: { personId: string }) {
  const finance = useFinance()
  const entries = (finance.data ?? []).filter((e) => e.participant_id === personId)
  return (
    <Card className="flex flex-col gap-4">
      <SectionTitle>Money</SectionTitle>
      {finance.isError ? (
        <LoadError />
      ) : entries.length === 0 ? (
        <Empty>They have not added any money numbers yet.</Empty>
      ) : (
        <>
          <Totals entries={entries} />
          <MoneyChart entries={entries} />
          <MonthTable entries={entries} />
        </>
      )}
      <p className="text-sm text-muted">Only you and this person can see these numbers. Only they can change them.</p>
    </Card>
  )
}

// ---------- Participant: my money ----------

function parseAmount(text: string): number | null {
  const cleaned = text.trim().replace(/\s/g, '').replace(',', '.')
  if (cleaned === '') return 0
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null
  const value = Number(cleaned)
  return value <= 9_999_999_999 ? value : null
}

export function MyMoney() {
  const { profile } = useAuth()
  const client = useQueryClient()
  const finance = useFinance()
  const now = new Date()
  const [year, setYear] = useState(now.getFullYear())
  const [monthIndex, setMonthIndex] = useState(now.getMonth())
  const [moneyIn, setMoneyIn] = useState('')
  const [moneyOut, setMoneyOut] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  const [filledFor, setFilledFor] = useState('')
  const month = `${year}-${String(monthIndex + 1).padStart(2, '0')}-01`
  const existing = (finance.data ?? []).find((e) => e.month === month)

  // When the saved numbers arrive, put them in the boxes once.
  useEffect(() => {
    if (!existing || filledFor === month) return
    setFilledFor(month)
    setMoneyIn(String(existing.money_in))
    setMoneyOut(String(existing.money_out))
    setNote(existing.note ?? '')
  }, [existing, filledFor, month])

  if (!profile) return null

  const readOnly = !!profile.archived_at
  const entries = finance.data ?? []
  const years = Array.from({ length: 6 }, (_, i) => now.getFullYear() - i)

  const pick = (y: number, m: number) => {
    setYear(y)
    setMonthIndex(m)
    setMessage(null)
    const key = `${y}-${String(m + 1).padStart(2, '0')}-01`
    setFilledFor(key)
    const found = entries.find((e) => e.month === key)
    setMoneyIn(found ? String(found.money_in) : '')
    setMoneyOut(found ? String(found.money_out) : '')
    setNote(found?.note ?? '')
  }

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    const amountIn = parseAmount(moneyIn)
    const amountOut = parseAmount(moneyOut)
    if (amountIn === null || amountOut === null) {
      setMessage({ ok: false, text: 'Type amounts as numbers, like 250 or 250.50.' })
      return
    }
    setBusy(true)
    const values = { money_in: amountIn, money_out: amountOut, note: note.trim() || null }
    const { error } = existing
      ? await supabase.from('finance_entries').update(values).eq('id', existing.id)
      : await supabase.from('finance_entries').insert({ ...values, month })
    setBusy(false)
    if (error) {
      setMessage({ ok: false, text: error.message === 'month_in_future' ? 'That month has not started yet. Pick this month or an earlier one.' : 'We could not save that. Please try again.' })
      return
    }
    setMessage({ ok: true, text: `Saved ${MONTHS[monthIndex]} ${year}` })
    await client.invalidateQueries({ queryKey: ['finance'] })
  }

  const remove = async (entry: FinanceEntry) => {
    const { error } = await supabase.from('finance_entries').delete().eq('id', entry.id)
    setMessage(error ? { ok: false, text: 'We could not remove that. Please try again.' } : { ok: true, text: 'Removed' })
    await client.invalidateQueries({ queryKey: ['finance'] })
  }

  return (
    <>
      <PageTitle title="My money" subtitle="Write down what came in and what went out each month. Only you and the owner can see this." />

      {finance.isError ? (
        <LoadError />
      ) : finance.isLoading ? (
        <Empty>Loading…</Empty>
      ) : entries.length === 0 ? (
        <Empty>No numbers yet. Add your first month below.</Empty>
      ) : (
        <>
          <Totals entries={entries} />
          <Card>
            <SectionTitle>Month by month</SectionTitle>
            <MoneyChart entries={entries} />
          </Card>
        </>
      )}

      {!readOnly && (
        <Card>
          <SectionTitle>{existing ? `Change ${MONTHS[monthIndex]} ${year}` : 'Add a month'}</SectionTitle>
          <form className="flex flex-col gap-4" onSubmit={save} noValidate>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Month" htmlFor="money-month">
                <select id="money-month" value={monthIndex} onChange={(e) => pick(year, Number(e.target.value))} className={inputClass}>
                  {MONTHS.map((name, i) => <option key={name} value={i}>{name}</option>)}
                </select>
              </Field>
              <Field label="Year" htmlFor="money-year">
                <select id="money-year" value={year} onChange={(e) => pick(Number(e.target.value), monthIndex)} className={inputClass}>
                  {years.map((y) => <option key={y} value={y}>{y}</option>)}
                </select>
              </Field>
              <Field label="Money in (€)" htmlFor="money-in">
                <input id="money-in" inputMode="decimal" value={moneyIn} onChange={(e) => { setMoneyIn(e.target.value); setMessage(null) }} placeholder="0" className={inputClass} />
              </Field>
              <Field label="Money out (€)" htmlFor="money-out">
                <input id="money-out" inputMode="decimal" value={moneyOut} onChange={(e) => { setMoneyOut(e.target.value); setMessage(null) }} placeholder="0" className={inputClass} />
              </Field>
            </div>
            <Field label="Note (optional)" htmlFor="money-note">
              <input id="money-note" maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} placeholder="For example: first paying customers" className={inputClass} />
            </Field>
            <p className="text-sm text-muted">Money in is what customers paid you. Money out is everything you spent on the business.</p>
            <div className="flex flex-wrap items-center gap-3">
              <Button type="submit" disabled={busy}>{busy ? 'Saving…' : existing ? 'Save changes' : 'Save this month'}</Button>
              {message && (
                <span role={message.ok ? 'status' : 'alert'} className={`text-sm font-medium ${message.ok ? 'text-accent-strong' : 'text-danger'}`}>{message.text}</span>
              )}
            </div>
          </form>
        </Card>
      )}

      {entries.length > 0 && (
        <Card>
          <SectionTitle>All your months</SectionTitle>
          <MonthTable
            entries={entries}
            onEdit={readOnly ? undefined : (e) => pick(Number(e.month.slice(0, 4)), Number(e.month.slice(5, 7)) - 1)}
            onRemove={readOnly ? undefined : (e) => void remove(e)}
          />
        </Card>
      )}
    </>
  )
}
