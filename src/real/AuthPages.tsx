import { useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Eye, EyeOff, LogIn, Sprout } from 'lucide-react'
import { linkError, supabase } from '../lib/supabase'
import { Button, Field, inputClass } from '../features/shared/ui'
import { useAuth } from './auth'

export const MIN_PASSWORD = 10
const USERNAME = /^[a-z0-9][a-z0-9._]{2,29}$/

function AuthFrame({ children }: { children: ReactNode }) {
  return (
    <div className="gutter flex min-h-full items-center justify-center py-10">
      <div className="flex w-full max-w-md flex-col gap-6">
        <div className="flex items-center gap-3">
          <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-accent text-on-accent">
            <Sprout size={26} />
          </span>
          <div>
            <p className="font-display text-3xl font-bold tracking-tight">VentureTrack</p>
            <p className="text-muted">Guide people from idea to launch.</p>
          </div>
        </div>
        {children}
      </div>
    </div>
  )
}

function ErrorText({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
      {children}
    </p>
  )
}

function PasswordInput(props: { id: string; value: string; onChange: (v: string) => void; autoComplete: string }) {
  const [show, setShow] = useState(false)
  return (
    <div className="relative">
      <input
        id={props.id}
        type={show ? 'text' : 'password'}
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        autoComplete={props.autoComplete}
        className={`${inputClass} pr-11`}
      />
      <button
        type="button"
        onClick={() => setShow((v) => !v)}
        aria-label={show ? 'Hide password' : 'Show password'}
        className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-muted hover:text-ink"
      >
        {show ? <EyeOff size={18} /> : <Eye size={18} />}
      </button>
    </div>
  )
}

// ---------- Sign in ----------

export function SignInPage() {
  const { signIn } = useAuth()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(
    linkError ? 'That link has expired or was already used. Ask the owner to send a new one, or use "Forgot your password?".' : '',
  )

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!username.trim() || !password) {
      setError('Type your username and your password.')
      return
    }
    setBusy(true)
    setError('')
    const result = await signIn(username.trim().toLowerCase(), password)
    setBusy(false)
    if (result === 'wrong') setError('That username and password do not match.')
    if (result === 'locked') setError('Too many wrong tries. Wait 15 minutes, then try again.')
    if (result === 'error') setError('Something went wrong on our side. Please try again.')
  }

  return (
    <AuthFrame>
      <form onSubmit={submit} className="flex flex-col gap-4 rounded-2xl border border-line bg-surface p-5" noValidate>
        <h1 className="text-lg font-semibold">Sign in</h1>
        <Field label="Username" htmlFor="signin-username">
          <input
            id="signin-username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoCapitalize="none"
            autoCorrect="off"
            autoComplete="username"
            className={inputClass}
          />
        </Field>
        <Field label="Password" htmlFor="signin-password">
          <PasswordInput id="signin-password" value={password} onChange={setPassword} autoComplete="current-password" />
        </Field>
        {error && <ErrorText>{error}</ErrorText>}
        <Button type="submit" disabled={busy}>
          <LogIn size={17} />
          {busy ? 'Signing in…' : 'Sign in'}
        </Button>
        <Link to="/forgot" className="self-start text-sm font-medium text-accent-strong">
          Forgot your password?
        </Link>
      </form>
      <p className="text-sm text-muted">There is no sign-up page. The programme owner invites each person by e-mail.</p>
    </AuthFrame>
  )
}

// ---------- Forgot password ----------

export function ForgotPage() {
  const { forgotPassword } = useAuth()
  const [username, setUsername] = useState('')
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)

  return (
    <AuthFrame>
      <div className="flex flex-col gap-4 rounded-2xl border border-line bg-surface p-5">
        <h1 className="text-lg font-semibold">Forgot your password?</h1>
        {sent ? (
          <p role="status">
            If that username exists, we sent an e-mail with a link to choose a new password. It can take a minute to arrive.
          </p>
        ) : (
          <form
            className="flex flex-col gap-4"
            onSubmit={async (e) => {
              e.preventDefault()
              if (!username.trim()) return
              setBusy(true)
              await forgotPassword(username.trim().toLowerCase())
              setBusy(false)
              setSent(true)
            }}
          >
            <p className="text-sm text-muted">Type your username. We will e-mail you a link to choose a new password.</p>
            <Field label="Username" htmlFor="forgot-username">
              <input
                id="forgot-username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoCapitalize="none"
                autoCorrect="off"
                autoComplete="username"
                className={inputClass}
              />
            </Field>
            <Button type="submit" disabled={busy || !username.trim()}>
              {busy ? 'Sending…' : 'Send me the link'}
            </Button>
          </form>
        )}
        <Link to="/sign-in" className="self-start text-sm font-medium text-accent-strong">
          Back to sign in
        </Link>
      </div>
    </AuthFrame>
  )
}

// ---------- Choose a new password (after the e-mail link) ----------

export function SetPasswordPage() {
  const { finishRecovery } = useAuth()
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  return (
    <AuthFrame>
      <form
        className="flex flex-col gap-4 rounded-2xl border border-line bg-surface p-5"
        noValidate
        onSubmit={async (e) => {
          e.preventDefault()
          if (password.length < MIN_PASSWORD) {
            setError(`Your password needs at least ${MIN_PASSWORD} characters.`)
            return
          }
          setBusy(true)
          const { error: failed } = await supabase.auth.updateUser({ password })
          setBusy(false)
          if (failed) setError(passwordProblem(failed.message))
          else finishRecovery()
        }}
      >
        <h1 className="text-lg font-semibold">Choose a new password</h1>
        <Field label={`New password (at least ${MIN_PASSWORD} characters)`} htmlFor="new-password">
          <PasswordInput id="new-password" value={password} onChange={setPassword} autoComplete="new-password" />
        </Field>
        {error && <ErrorText>{error}</ErrorText>}
        <Button type="submit" disabled={busy}>
          {busy ? 'Saving…' : 'Save new password'}
        </Button>
      </form>
    </AuthFrame>
  )
}

function passwordProblem(message: string): string {
  if (/different from the old/i.test(message)) return 'Choose a password you have not used here before.'
  if (/weak|at least|characters/i.test(message)) return `Your password needs at least ${MIN_PASSWORD} characters.`
  return 'We could not save that password. Please try again.'
}

// ---------- Accept an invitation ----------

export function WelcomePage() {
  const { profile, reloadProfile, signOut } = useAuth()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const savedPassword = useRef('')

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    const name = username.trim().toLowerCase()
    if (!USERNAME.test(name)) {
      setError('Your username needs 3 to 30 characters. Use small letters, numbers, dots or underscores, and start with a letter or number.')
      return
    }
    if (password.length < MIN_PASSWORD) {
      setError(`Your password needs at least ${MIN_PASSWORD} characters.`)
      return
    }
    setBusy(true)
    setError('')
    // Save the password once. If only the username needs another try, do not send it again.
    if (savedPassword.current !== password) {
      const { error: passwordFailed } = await supabase.auth.updateUser({ password })
      if (passwordFailed && !/different from the old/i.test(passwordFailed.message)) {
        setBusy(false)
        setError(passwordProblem(passwordFailed.message))
        return
      }
      savedPassword.current = password
    }
    const { error: acceptFailed } = await supabase.rpc('accept_invitation', { p_username: name })
    setBusy(false)
    if (acceptFailed) {
      const code = acceptFailed.message
      if (code === 'username_taken') setError('Someone already uses that username. Please pick another one.')
      else if (code === 'invitation_not_valid') setError('This invitation is no longer valid. Ask the owner to send a new one.')
      else setError('We could not finish setting up your account. Please try again.')
      return
    }
    await reloadProfile()
  }

  return (
    <AuthFrame>
      <form onSubmit={submit} className="flex flex-col gap-4 rounded-2xl border border-line bg-surface p-5" noValidate>
        <div>
          <h1 className="text-lg font-semibold">Welcome{profile ? `, ${profile.full_name.split(' ')[0]}` : ''}!</h1>
          <p className="mt-1 text-sm text-muted">
            Pick a username and a password. You will use them to sign in from now on.
          </p>
        </div>
        <Field label="Choose a username" htmlFor="welcome-username">
          <input
            id="welcome-username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoCapitalize="none"
            autoCorrect="off"
            autoComplete="username"
            className={inputClass}
          />
        </Field>
        <Field label={`Choose a password (at least ${MIN_PASSWORD} characters)`} htmlFor="welcome-password">
          <PasswordInput id="welcome-password" value={password} onChange={setPassword} autoComplete="new-password" />
        </Field>
        {error && <ErrorText>{error}</ErrorText>}
        <Button type="submit" disabled={busy}>
          {busy ? 'Setting up…' : 'Create my account'}
        </Button>
        <button type="button" onClick={() => void signOut()} className="self-start text-sm font-medium text-muted underline">
          Not you? Leave this page
        </button>
      </form>
    </AuthFrame>
  )
}
