// Sends waiting notifications from the outbox to people's devices.
//
// Woken by the database (on every new note, and once a minute as a safety
// net). Only callers that know PUSH_SECRET get in: the database has it in Vault.
import { asService, json, rpc } from '../_shared/http.ts'
import { sendPush, type VapidKeys } from '../_shared/webpush.ts'

const SECRET = Deno.env.get('PUSH_SECRET') ?? ''
const KEYS: VapidKeys = {
  publicKey: Deno.env.get('VAPID_PUBLIC_KEY') ?? '',
  privateKey: Deno.env.get('VAPID_PRIVATE_KEY') ?? '',
  subject: Deno.env.get('VAPID_SUBJECT') ?? 'https://venturetrack.invalid',
}

/** Compare without leaking, through timing, how much of the secret matched. */
function sameSecret(given: string): boolean {
  if (!SECRET || given.length !== SECRET.length) return false
  let diff = 0
  for (let i = 0; i < given.length; i++) diff |= given.charCodeAt(i) ^ SECRET.charCodeAt(i)
  return diff === 0
}

interface Row {
  outbox_id: number
  title: string
  body: string
  url: string
  endpoint: string
  p256dh: string
  auth: string
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' })
  if (!sameSecret(req.headers.get('x-push-secret') ?? '')) return json(401, { error: 'not_allowed' })
  if (!KEYS.publicKey || !KEYS.privateKey) return json(500, { error: 'not_configured' })

  let sent = 0
  let forgotten = 0
  let failed = 0
  // Drain in batches until the outbox is empty (bounded, so one call cannot run forever).
  for (let round = 0; round < 10; round++) {
    const batch = await rpc('push_claim_batch', { p_limit: 200 }, asService)
    if (!batch.ok) {
      console.error('could not read the outbox', batch.status, batch.message)
      return json(502, { error: 'outbox_unavailable' })
    }
    const rows = (batch.data ?? []) as Row[]
    if (rows.length === 0) break

    const results = await Promise.all(
      rows.map(async (r) => ({
        row: r,
        status: await sendPush(r, { title: r.title, body: r.body, url: r.url, tag: `vt-${r.outbox_id}` }, KEYS),
      })),
    )
    for (const { row, status } of results) {
      if (status >= 200 && status < 300) sent++
      else if (status === 404 || status === 410) {
        // The device is gone (app removed, permission withdrawn): stop sending to it.
        await rpc('push_forget', { p_endpoint: row.endpoint }, asService)
        forgotten++
      } else {
        failed++
        console.error('push refused', new URL(row.endpoint).host, status)
      }
    }
    if (rows.length < 200) break
  }
  return json(200, { sent, forgotten, failed })
})
