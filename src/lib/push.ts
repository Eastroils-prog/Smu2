// The phone-app side of notifications: the background helper, installing the
// app, and turning notifications on or off for this device.
import { supabase } from './supabase'

export const VAPID_PUBLIC_KEY = (import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined) ?? ''

export const pushSupported = () =>
  'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window && !!VAPID_PUBLIC_KEY

/** Opened from the home-screen icon, rather than in a browser tab. */
export const isInstalled = () =>
  window.matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true

export const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)

export function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((error) => console.warn('Background helper not registered', error))
  })
}

// Android and computer browsers offer their own "Install" prompt; keep it for our button.
interface InstallPrompt extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}
let installPrompt: InstallPrompt | null = null
const installListeners = new Set<() => void>()
window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault()
  installPrompt = event as InstallPrompt
  installListeners.forEach((fn) => fn())
})
window.addEventListener('appinstalled', () => {
  installPrompt = null
  installListeners.forEach((fn) => fn())
})
export const canPromptInstall = () => installPrompt !== null
export function onInstallChange(fn: () => void): () => void {
  installListeners.add(fn)
  return () => {
    installListeners.delete(fn)
  }
}
export async function promptInstall(): Promise<boolean> {
  if (!installPrompt) return false
  await installPrompt.prompt()
  const { outcome } = await installPrompt.userChoice
  installPrompt = null
  installListeners.forEach((fn) => fn())
  return outcome === 'accepted'
}

function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(base64url.length / 4) * 4, '=')
  return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))
}

/** Whether this site may show notifications. Asks the Permissions API first, which some browsers keep more up to date. */
export async function notificationPermission(): Promise<NotificationPermission> {
  try {
    const status = await navigator.permissions.query({ name: 'notifications' })
    return status.state === 'prompt' ? 'default' : status.state
  } catch {
    return Notification.permission
  }
}

export async function currentSubscription(): Promise<PushSubscription | null> {
  if (!pushSupported()) return null
  const registration = await navigator.serviceWorker.ready
  return registration.pushManager.getSubscription()
}

export type EnableResult = 'on' | 'denied' | 'unsupported' | 'failed'

/** Ask for permission (must follow a tap), subscribe this device, and save it. */
export async function enablePush(): Promise<EnableResult> {
  if (!pushSupported()) return 'unsupported'
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') return permission === 'denied' ? 'denied' : 'failed'
  try {
    const registration = await navigator.serviceWorker.ready
    const subscription =
      (await registration.pushManager.getSubscription()) ??
      (await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(VAPID_PUBLIC_KEY) }))
    const json = subscription.toJSON()
    const { error } = await supabase.rpc('save_push_subscription', {
      p_endpoint: subscription.endpoint,
      p_p256dh: json.keys?.p256dh ?? '',
      p_auth: json.keys?.auth ?? '',
      p_time_zone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      p_device: deviceName(),
    })
    return error ? 'failed' : 'on'
  } catch (error) {
    console.warn('Could not turn on notifications', error)
    return 'failed'
  }
}

export async function disablePush(): Promise<void> {
  const subscription = await currentSubscription()
  if (!subscription) return
  await supabase.from('push_subscriptions').delete().eq('endpoint', subscription.endpoint)
  await subscription.unsubscribe()
}

function deviceName(): string {
  const ua = navigator.userAgent
  const os = /iphone/i.test(ua) ? 'iPhone' : /ipad/i.test(ua) ? 'iPad' : /android/i.test(ua) ? 'Android' : /mac/i.test(ua) ? 'Mac' : /windows/i.test(ua) ? 'Windows' : 'Computer'
  const browser = /edg\//i.test(ua) ? 'Edge' : /firefox/i.test(ua) ? 'Firefox' : /chrome|crios/i.test(ua) ? 'Chrome' : /safari/i.test(ua) ? 'Safari' : 'browser'
  return `${os} · ${browser}`
}
