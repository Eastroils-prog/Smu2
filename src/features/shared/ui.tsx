import { useEffect, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { Inbox, X } from 'lucide-react'
import { STAGES, STATUS_LABEL, initials, type TaskStatus } from '../../lib/data'

type Tone = 'neutral' | 'accent' | 'warn' | 'danger' | 'info'

const toneClass: Record<Tone, string> = {
  neutral: 'bg-sunken text-muted',
  accent: 'bg-accent-soft text-accent-strong',
  warn: 'bg-warn-soft text-warn',
  danger: 'bg-danger-soft text-danger',
  info: 'bg-info-soft text-info',
}

const dotClass: Record<Tone, string> = {
  neutral: 'bg-muted',
  accent: 'bg-accent',
  warn: 'bg-warn',
  danger: 'bg-danger',
  info: 'bg-info',
}

/** A small label. The dot repeats the meaning in shape, not only in colour. */
export function Badge({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full py-0.5 pr-2.5 pl-2 text-xs font-semibold whitespace-nowrap ${toneClass[tone]}`}>
      <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${dotClass[tone]}`} />
      {children}
    </span>
  )
}

const statusTone: Record<TaskStatus, Tone> = {
  not_started: 'neutral',
  in_progress: 'info',
  submitted: 'warn',
  needs_revision: 'danger',
  completed: 'accent',
}

export function StatusBadge({ status }: { status: TaskStatus }) {
  return <Badge tone={statusTone[status]}>{STATUS_LABEL[status]}</Badge>
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost'
  small?: boolean
}

export function Button({ variant = 'primary', small, className = '', ...rest }: ButtonProps) {
  const look = {
    primary: 'bg-accent text-on-accent shadow-card hover:bg-accent-strong',
    secondary: 'border border-line bg-surface text-ink shadow-card hover:border-accent/40 hover:bg-sunken',
    ghost: 'text-accent-strong hover:bg-accent-soft',
  }[variant]
  const size = small ? 'h-8 px-3 text-sm' : 'h-10 px-4 text-sm'
  return (
    <button
      {...rest}
      className={`inline-flex shrink-0 items-center justify-center gap-2 rounded-xl font-semibold transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100 ${look} ${size} ${className}`}
    />
  )
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-2xl border border-line/70 bg-surface p-4 shadow-card sm:p-5 ${className}`}>{children}</section>
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
      <h2 className="flex items-center gap-2 text-[17px] font-bold">{children}</h2>
      {action}
    </div>
  )
}

export function PageTitle({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3 pb-1">
      <div className="min-w-0">
        <h1 className="text-[28px] leading-tight font-extrabold sm:text-[32px]">{title}</h1>
        {subtitle && <p className="mt-1 max-w-2xl text-muted">{subtitle}</p>}
      </div>
      {action}
    </header>
  )
}

/** Each name always gets the same soft colour, so people are easy to tell apart at a glance. */
function avatarSlot(name: string): number {
  let hash = 0
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0
  return (hash % 6) + 1
}

export function Avatar({ name, size = 'md' }: { name: string; size?: 'md' | 'lg' }) {
  const box = size === 'lg' ? 'h-16 w-16 text-xl' : 'h-10 w-10 text-sm'
  const slot = avatarSlot(name)
  return (
    <span
      aria-hidden="true"
      className={`inline-flex shrink-0 items-center justify-center rounded-full font-display font-bold ${box}`}
      style={{ background: `var(--avatar-${slot})`, color: `var(--avatar-${slot}-ink)` }}
    >
      {initials(name)}
    </span>
  )
}

/** Progress bar cut into one slice per stage. `value` is 0 to 1. */
export function StageBar({ value, showLabel = true }: { value: number; showLabel?: boolean }) {
  const percent = Math.round(value * 100)
  return (
    <div className="flex items-center gap-3">
      <div
        className="flex min-w-0 flex-1 gap-1"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-label="Verified progress"
      >
        {STAGES.map((stage, i) => {
          const fill = Math.max(0, Math.min(1, value * STAGES.length - i))
          return (
            <div key={stage.name} title={stage.name} className="h-2.5 flex-1 overflow-hidden rounded-full bg-sunken">
              <div className="h-full rounded-full bg-accent transition-all duration-500" style={{ width: `${fill * 100}%` }} />
            </div>
          )
        })}
      </div>
      {showLabel && <span className="w-11 text-right font-display text-base font-bold tabular-nums">{percent}%</span>}
    </div>
  )
}

export function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-line px-4 py-7 text-center text-sm text-muted">
      <Inbox size={20} aria-hidden="true" className="opacity-60" />
      <p className="max-w-sm">{children}</p>
    </div>
  )
}

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="gutter fixed inset-0 z-30 flex items-end justify-center bg-[rgb(8_20_14/0.5)] py-4 backdrop-blur-[2px] sm:items-center sm:py-6" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="rise-in max-h-full w-full max-w-md overflow-y-auto rounded-3xl border border-line/70 bg-surface p-5 shadow-lift sm:p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-5 flex items-center justify-between gap-3">
          <h2 className="text-xl font-bold">{title}</h2>
          <button onClick={onClose} aria-label="Close" className="rounded-full p-2 text-muted hover:bg-sunken hover:text-ink">
            <X size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

export const inputClass =
  'w-full rounded-xl border border-line bg-surface px-3.5 py-2.5 text-ink shadow-[inset_0_1px_1px_rgb(15_31_23/0.03)] transition placeholder:text-muted/70 hover:border-muted/40 focus:border-accent focus:ring-4 focus:ring-accent/15 focus:outline-none disabled:bg-sunken disabled:text-muted'

export function Field({ label, htmlFor, children }: { label: string; htmlFor: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-sm font-semibold">
        {label}
      </label>
      {children}
    </div>
  )
}
