// Block, unblock or permanently delete a participant.
//
// Changing someone's sign-in needs the service-role key, which must never reach
// a browser, so this runs on the server. Who may call it is decided by the
// DATABASE: account_action_target, set_blocked and account_files are called
// with the caller's own token and refuse anyone who is not the administrator.
import { SUPABASE_URL, SERVICE_KEY, asService, asString, corsHeaders, json, readBody, rpc } from '../_shared/http.ts'

const serviceHeaders = { apikey: SERVICE_KEY, Authorization: asService, 'Content-Type': 'application/json' }

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' })

  const caller = req.headers.get('Authorization') ?? ''
  if (!caller.startsWith('Bearer ')) return json(401, { error: 'not_signed_in' })

  const body = await readBody(req)
  const action = asString(body.action)
  const profileId = asString(body.profile_id, 40)
  if (!['block', 'unblock', 'delete'].includes(action)) return json(400, { error: 'unknown_action' })

  // 1. Is the caller the administrator, and is this a participant? (Asked as the caller.)
  const target = await rpc('account_action_target', { p_profile_id: profileId }, caller)
  if (!target.ok) {
    if (target.message === 'person_not_found') return json(404, { error: 'person_not_found' })
    return json(403, { error: 'not_allowed' })
  }

  if (action === 'block' || action === 'unblock') {
    const blocking = action === 'block'
    // Refuse new sign-ins (and token refreshes) for about 100 years, or lift that.
    const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${profileId}`, {
      method: 'PUT',
      headers: serviceHeaders,
      body: JSON.stringify({ ban_duration: blocking ? '876000h' : 'none' }),
    })
    if (!res.ok) {
      console.error('ban update failed', res.status, await res.text())
      return json(502, { error: 'could_not_change' })
    }
    const marked = await rpc('set_blocked', { p_profile_id: profileId, p_blocked: blocking }, caller)
    if (!marked.ok) return json(502, { error: 'could_not_change' })
    return json(200, { ok: true })
  }

  // ---- Delete for good ----
  // 2. Remove every file they stored, then the account. Deleting the account
  //    removes their profile and, through the database's cascades, their
  //    tasks, work, messages, money numbers, shared files, votes, milestones
  //    and help requests.
  const files = await rpc('account_files', { p_profile_id: profileId }, caller)
  if (!files.ok || !Array.isArray(files.data)) return json(502, { error: 'could_not_delete' })
  const byBucket = new Map<string, string[]>()
  for (const f of files.data as { bucket: string; path: string }[]) {
    byBucket.set(f.bucket, [...(byBucket.get(f.bucket) ?? []), f.path])
  }
  for (const [bucket, paths] of byBucket) {
    for (let i = 0; i < paths.length; i += 100) {
      const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${bucket}`, {
        method: 'DELETE',
        headers: serviceHeaders,
        body: JSON.stringify({ prefixes: paths.slice(i, i + 100) }),
      })
      if (!res.ok) {
        console.error('file removal failed', bucket, res.status, await res.text())
        return json(502, { error: 'could_not_delete' })
      }
    }
  }

  const removed = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${profileId}`, { method: 'DELETE', headers: serviceHeaders })
  if (!removed.ok) {
    console.error('account removal failed', removed.status, await removed.text())
    return json(502, { error: 'could_not_delete' })
  }
  return json(200, { ok: true })
})
