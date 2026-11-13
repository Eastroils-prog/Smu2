import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Eye, EyeOff, LogIn, Sprout } from 'lucide-react'
import { DEMO_ACCOUNTS } from '../../lib/data'
import { useStore } from '../../lib/store'
import { Button, Field, inputClass } from '../shared/ui'

export function SignIn() {
  const { signIn } = useStore()
  const navigate = useNavigate()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const account = DEMO_ACCOUNTS.find(
      (a) => a.username === username.trim().toLowerCase() && a.password === password,
    )
    if (!account) {
      setError('That username and password do not match. Use one of the sample accounts below.')
      return
    }
    signIn(account.role)
    navigate(account.role === 'admin' ? '/admin' : '/app')
  }

  return (
    <div className="gutter flex min-h-full items-center justify-center py-10">
      <div className="flex w-full max-w-md flex-col gap-6">
        <div className="flex items-center gap-3">
          <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-accent text-on-accent">
            <Sprout size={26} />
          </span>
          <div>
            <h1 className="text-3xl font-bold tracking-tight">VentureTrack</h1>
            <p className="text-muted">Guide people from idea to launch.</p>
          </div>
        </div>

        <form onSubmit={submit} className="flex flex-col gap-4 rounded-2xl border border-line bg-surface p-5" noValidate>
          <h2 className="text-lg font-semibold">Sign in</h2>
          <Field label="Username" htmlFor="signin-username">
            <input
              id="signin-username"
              value={username}
              onChange={(e) => { setUsername(e.target.value); setError('') }}
              autoCapitalize="none"
              autoCorrect="off"
              autoComplete="username"
              className={inputClass}
            />
          </Field>
          <Field label="Password" htmlFor="signin-password">
            <div className="relative">
              <input
                id="signin-password"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => { setPassword(e.target.value); setError('') }}
                autoComplete="current-password"
                className={`${inputClass} pr-11`}
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-muted hover:text-ink"
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </Field>
          {error && (
            <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
              {error}
            </p>
          )}
          <Button type="submit">
            <LogIn size={17} />
            Sign in
          </Button>
        </form>

        <div className="rounded-2xl bg-warn-soft p-4 text-warn">
          <p className="text-sm">
            <strong>Sample version.</strong> Everyone here is made up and nothing is saved. Use one of these sample accounts:
          </p>
          <ul className="mt-3 flex flex-col gap-2">
            {DEMO_ACCOUNTS.map((a) => (
              <li key={a.username} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-surface px-3 py-2 text-ink">
                <span className="min-w-0 text-sm">
                  <span className="block font-semibold">{a.label}</span>
                  <span className="block text-muted">
                    Username <code className="font-semibold text-ink">{a.username}</code> · Password{' '}
                    <code className="font-semibold text-ink">{a.password}</code>
                  </span>
                </span>
                <Button
                  small
                  variant="secondary"
                  type="button"
                  onClick={() => { setUsername(a.username); setPassword(a.password); setError('') }}
                >
                  Fill in
                </Button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  )
}
