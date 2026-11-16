// VentureTrack's background helper ("service worker").
// It shows notifications that arrive while the app is closed, and opens the
// right page when one is tapped. It does not store or cache any data.

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))

self.addEventListener('push', (event) => {
  let note = {}
  try {
    note = event.data ? event.data.json() : {}
  } catch {
    note = { body: event.data ? event.data.text() : '' }
  }
  event.waitUntil(
    self.registration.showNotification(note.title || 'VentureTrack', {
      body: note.body || '',
      icon: '/icons/icon-192.png',
      badge: '/icons/badge-96.png',
      tag: note.tag,
      data: { url: note.url || '/' },
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  // Only ever open pages of this app.
  const target = new URL(event.notification.data?.url || '/', self.location.origin)
  const url = target.origin === self.location.origin ? target.href : self.location.origin + '/'
  event.waitUntil(
    (async () => {
      const open = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      for (const client of open) {
        if (new URL(client.url).origin === self.location.origin && 'focus' in client) {
          await client.focus()
          if ('navigate' in client) await client.navigate(url)
          return
        }
      }
      await self.clients.openWindow(url)
    })(),
  )
})
