import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { BellRing, Download, Share, Smartphone, X } from 'lucide-react'
import { supabase } from '../lib/supabase'
import {
  canPromptInstall, currentSubscription, notificationPermission, disablePush, enablePush, isInstalled, isIos, onInstallChange, promptInstall, pushSupported,
} from '../lib/push'
import { Badge, Button, Card, SectionTitle } from '../features/shared/ui'
import { useAuth } from './auth'

type State = 'loading' | 'on' | 'off' | 'denied' | 'needs-install' | 'unsupported'

/** Whether notifications are on for THIS device, and what to do if not. */
function usePushState() {
  const [state, setState] = useState<State>('loading')
  const refresh = async () => {
    if (!pushSupported()) {
      // On iPhone, notifications only exist once the app is on the home screen.
      setState(isIos() && !isInstalled() ? 'needs-install' : 'unsupported')
      return
    }
    const permission = await notificationPermission()
    if (permission === 'denied') {
      setState('denied')
      return
    }
    try {
      setState((await currentSubscription()) && permission === 'granted' ? 'on' : 'off')
    } catch {
      setState('off')
    }
  }
  useEffect(() => {
    void refresh()
  }, [])
  return { state, refresh }
}

function useInstallPrompt() {
  const [available, setAvailable] = useState(canPromptInstall())
  useEffect(() => onInstallChange(() => setAvailable(canPromptInstall())), [])
  return available
}

function useMyDevices() {
  return useQuery({
    queryKey: ['push-devices'],
    queryFn: async () => {
      const { data, error } = await supabase.from('push_subscriptions').select('id, device, created_at').order('created_at', { ascending: false })
      if (error) throw new Error(error.message)
      return data as { id: string; device: string | null; created_at: string }[]
    },
  })
}

/** The full box on the profile page: install the app, and turn notifications on or off. */
export function PhoneAppCard() {
  const { profile } = useAuth()
  const client = useQueryClient()
  const { state, refresh } = usePushState()
  const canInstall = useInstallPrompt()
  const devices = useMyDevices()
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  const installed = isInstalled()
  if (!profile) return null

  const turnOn = async () => {
    setBusy(true)
    setMessage(null)
    const result = await enablePush()
    setBusy(false)
    await refresh()
    await client.invalidateQueries({ queryKey: ['push-devices'] })
    if (result === 'on') setMessage({ ok: true, text: 'Notifications are on for this device.' })
    else if (result === 'denied') setMessage({ ok: false, text: 'You said no to notifications. To change that, allow them for VentureTrack in your phone or browser settings.' })
    else setMessage({ ok: false, text: 'We could not turn on notifications on this device. Please try again.' })
  }

  const turnOff = async () => {
    setBusy(true)
    setMessage(null)
    await disablePush()
    setBusy(false)
    await refresh()
    await client.invalidateQueries({ queryKey: ['push-devices'] })
    setMessage({ ok: true, text: 'Notifications are off for this device.' })
  }

  const test = async () => {
    setBusy(true)
    setMessage(null)
    const { error } = await supabase.rpc('push_test')
    setBusy(false)
    setMessage(error ? { ok: false, text: 'We could not send a test. Please try again.' } : { ok: true, text: 'Sent. It should arrive within a few seconds.' })
  }

  return (
    <Card className="flex flex-col gap-5" >
      <SectionTitle>
        <Smartphone size={18} aria-hidden="true" />
        Phone app and notifications
      </SectionTitle>

      <div className="flex flex-col gap-2" data-testid="install-section">
        <h3 className="font-sans font-semibold">1. Put VentureTrack on your home screen</h3>
        {installed ? (
          <p className="text-sm text-muted">You are using the app from your home screen.</p>
        ) : canInstall ? (
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={() => void promptInstall()}>
              <Download size={16} />
              Install VentureTrack
            </Button>
            <span className="text-sm text-muted">It gets its own icon and opens like an app.</span>
          </div>
        ) : isIos() ? (
          <ol className="flex list-decimal flex-col gap-1 pl-5 text-sm">
            <li>Open this page in <strong>Safari</strong>.</li>
            <li>Tap the <strong>Share</strong> button <Share size={14} className="inline align-[-2px]" aria-label="Share" /> at the bottom of the screen.</li>
            <li>Scroll down and tap <strong>Add to Home Screen</strong>, then <strong>Add</strong>.</li>
            <li>Open VentureTrack from its new icon, and come back to this page.</li>
          </ol>
        ) : (
          <ol className="flex list-decimal flex-col gap-1 pl-5 text-sm">
            <li>Open the browser menu (<strong>⋮</strong> at the top right in Chrome).</li>
            <li>Tap <strong>Install app</strong> or <strong>Add to Home screen</strong>.</li>
            <li>Open VentureTrack from its new icon.</li>
          </ol>
        )}
      </div>

      <div className="flex flex-col gap-2 border-t border-line pt-4" data-testid="notifications-section">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-sans font-semibold">2. Get notifications on this device</h3>
          {state === 'on' && <Badge tone="accent">On</Badge>}
          {state === 'denied' && <Badge tone="danger">Blocked</Badge>}
        </div>
        <p className="text-sm text-muted">
          {profile.role === 'admin'
            ? 'You hear about new messages, handed-in work, help requests and files to approve, plus a morning summary of reminders and deadlines.'
            : 'You hear about new messages, new tasks, feedback on your work, polls and shared files, plus a morning summary of reminders and deadlines.'}
        </p>

        {state === 'loading' && <p className="text-sm text-muted">Checking this device…</p>}
        {state === 'needs-install' && (
          <p className="rounded-xl bg-info-soft px-3 py-2 text-sm text-info">On iPhone and iPad, notifications work once VentureTrack is on your home screen (step 1). Open it from the icon and turn them on here.</p>
        )}
        {state === 'unsupported' && (
          <p className="rounded-xl bg-sunken px-3 py-2 text-sm text-muted">This browser cannot show notifications from websites. Try Chrome, Edge, Firefox, or Safari on iPhone after step 1.</p>
        )}
        {state === 'denied' && (
          <p className="rounded-xl bg-danger-soft px-3 py-2 text-sm text-danger">Notifications are blocked for VentureTrack on this device. Allow them in your phone’s or browser’s settings for this site, then reload this page.</p>
        )}
        {state === 'off' && (
          <div>
            <Button disabled={busy || !!profile.archived_at} onClick={() => void turnOn()}>
              <BellRing size={16} />
              {busy ? 'Turning on…' : 'Turn on notifications'}
            </Button>
          </div>
        )}
        {state === 'on' && (
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" disabled={busy} onClick={() => void test()}>Send me a test</Button>
            <Button variant="ghost" disabled={busy} onClick={() => void turnOff()}>Turn off on this device</Button>
          </div>
        )}
        {message && (
          <p role={message.ok ? 'status' : 'alert'} className={`text-sm font-medium ${message.ok ? 'text-accent-strong' : 'text-danger'}`}>{message.text}</p>
        )}
        {(devices.data?.length ?? 0) > 0 && (
          <p className="text-xs text-muted" data-testid="device-count">
            Notifications go to {devices.data!.length === 1 ? '1 device' : `${devices.data!.length} devices`}: {devices.data!.map((d) => d.device ?? 'device').join(', ')}.
          </p>
        )}
      </div>
    </Card>
  )
}

const DISMISS_KEY = 'vt-phone-prompt-dismissed'

/** A small nudge on the first page, shown until notifications are on (or it is dismissed). */
export function PhoneAppPrompt() {
  const { profile } = useAuth()
  const { state } = usePushState()
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(DISMISS_KEY) === '1'
    } catch {
      return false
    }
  })
  if (!profile || dismissed || !(state === 'off' || state === 'needs-install')) return null
  const to = profile.role === 'admin' ? '/admin/profile' : '/app/profile'

  return (
    <div className="flex items-center gap-3 rounded-2xl bg-rail p-4 text-rail-ink shadow-card on-rail" data-testid="phone-prompt">
      <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-spark text-on-spark">
        <BellRing size={18} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-semibold">Get VentureTrack on your phone</p>
        <p className="text-sm text-rail-muted">Add it to your home screen and get a notification when something new arrives.</p>
      </div>
      <Link to={to} className="shrink-0 rounded-xl bg-spark px-3 py-2 text-sm font-semibold text-on-spark">Set it up</Link>
      <button
        type="button"
        aria-label="Hide this"
        onClick={() => {
          setDismissed(true)
          try {
            localStorage.setItem(DISMISS_KEY, '1')
          } catch {
            /* the page works without remembering this */
          }
        }}
        className="shrink-0 rounded-full p-1.5 text-rail-muted hover:bg-rail-raised hover:text-rail-ink"
      >
        <X size={16} />
      </button>
    </div>
  )
}
