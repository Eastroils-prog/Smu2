import { useEffect, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { STAGES, STATUS_LABEL, initials, type TaskStatus } from '../../lib/data'

type Tone = 'neutral' | 'accent' | 'warn' | 'danger' | 'info'

const toneClass: Record<Tone, string> = {
  neutral: 'bg-sunken text-muted',
  accent: 'bg-accent-soft text-accent-strong',
  warn: 'bg-warn-soft text-warn',
  danger: 'bg-danger-soft text-danger',
  info: 'bg-info-soft text-info',
}

export function Badge({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap ${toneClass[tone]}`}>
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
    primary: 'bg-accent text-on-accent hover:bg-accent-strong',
    secondary: 'border border-line bg-surface text-ink hover:bg-sunken',
    ghost: 'text-accent-strong hover:bg-accent-soft',
  }[variant]
  const size = small ? 'px-3 py-1.5 text-sm' : 'px-4 py-2.5 text-sm'
  return (
    <button
      {...rest}
      className={`inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${look} ${size} ${className}`}
    />
  )
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-2xl border border-line bg-surface p-4 sm:p-5 ${className}`}>{children}</section>
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
      <h2 className="text-base font-semibold">{children}</h2>
      {action}
    </div>
  )
}

export function PageTitle({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 text-muted">{subtitle}</p>}
      </div>
      {action}
    </header>
  )
}

export function Avatar({ name, size = 'md' }: { name: string; size?: 'md' | 'lg' }) {
  const box = size === 'lg' ? 'h-14 w-14 text-lg' : 'h-9 w-9 text-xs'
  return (
    <span
      aria-hidden="true"
      className={`inline-flex shrink-0 items-center justify-center rounded-full bg-accent-soft font-semibold text-accent-strong ${box}`}
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
      {showLabel && <span className="w-10 text-right text-sm font-semibold tabular-nums">{percent}%</span>}
    </div>
  )
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="rounded-xl bg-sunken px-4 py-6 text-center text-sm text-muted">{children}</p>
}

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="gutter fixed inset-0 z-30 flex items-center justify-center bg-black/45 py-6" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="max-h-full w-full max-w-md overflow-y-auto rounded-2xl border border-line bg-surface p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button onClick={onClose} aria-label="Close" className="rounded-lg p-1.5 text-muted hover:bg-sunken">
            <X size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

export const inputClass =
  'w-full rounded-lg border border-line bg-surface px-3 py-2.5 text-ink placeholder:text-muted/70 focus:border-accent focus:outline-none'

export function Field({ label, htmlFor, children }: { label: string; htmlFor: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-sm font-medium">
        {label}
      </label>
      {children}
    </div>
  )
}
