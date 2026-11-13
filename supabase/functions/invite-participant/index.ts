// Invite, re-send and cancel invitations.
//
// Creating an account for someone needs the service-role key, which must never
// reach a browser, so this one job runs on the server.
//
// Who may call it is decided by the DATABASE, not here: create_invitation and
// revoke_invitation are called with the caller's own token and refuse anyone
// who is not the administrator.
import { SUPABASE_URL, SERVICE_KEY, asService, asString, corsHeaders, json, readBody, rpc } from '../_shared/http.ts'

const dbErrors: Record<string, [number, string]> = {
  email_in_use: [409, 'email_in_use'],
  already_invited: [409, 'already_invited'],
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' })

  const caller = req.headers.get('Authorization') ?? ''
  if (!caller.startsWith('Bearer ')) return json(401, { error: 'not_signed_in' })

  const body = await readBody(req)
  const action = asString(body.action)
  const redirectTo = asString(body.redirect_to, 300)

  if (action === 'invite') {
    return await invite(caller, asString(body.email, 254), asString(body.full_name, 120), asString(body.stage_id, 40) || null, redirectTo)
  }

  if (action === 'revoke' || action === 'resend') {
    const revoked = await rpc('revoke_invitation', { p_invitation_id: asString(body.invitation_id, 40) }, caller)
    if (!revoked.ok) return json(revoked.status === 401 || revoked.status === 403 ? 403 : 400, { error: 'not_allowed' })
    const row = Array.isArray(revoked.data) ? (revoked.data[0] as Record<string, string | null> | undefined) : undefined
    if (!row) return json(404, { error: 'invitation_not_found' })

    // Remove the half-created account so the link in the old e-mail stops working.
    if (row.profile_id) {
      const del = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${row.profile_id}`, {
        method: 'DELETE',
        headers: { apikey: SERVICE_KEY, Authorization: asService },
      })
      if (!del.ok) console.error('could not delete invited account', del.status, await del.text())
    }
    if (action === 'revoke') return json(200, { ok: true })
    return await invite(caller, row.email ?? '', row.full_name ?? '', row.initial_stage_id, redirectTo)
  }

  return json(400, { error: 'unknown_action' })
})

async function invite(caller: string, email: string, fullName: string, stageId: string | null, redirectTo: string) {
  email = email.trim().toLowerCase()
  fullName = fullName.trim()
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || !fullName) return json(400, { error: 'invalid_input' })

  // 1. Record the invitation — as the caller, so the database checks they are the admin.
  const created = await rpc('create_invitation', { p_email: email, p_full_name: fullName, p_stage_id: stageId }, caller)
  if (!created.ok) {
    const known = dbErrors[created.message]
    if (known) return json(known[0], { error: known[1] })
    if (created.status === 401 || created.status === 403) return json(403, { error: 'not_allowed' })
    console.error('create_invitation failed', created.status, created.message)
    return json(400, { error: 'could_not_invite' })
  }

  // 2. Create the account and send the e-mail. The database only accepts the
  //    new account because the pending invitation from step 1 exists.
  const query = redirectTo ? `?redirect_to=${encodeURIComponent(redirectTo)}` : ''
  const sent = await fetch(`${SUPABASE_URL}/auth/v1/invite${query}`, {
    method: 'POST',
    headers: { apikey: SERVICE_KEY, Authorization: asService, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, data: { full_name: fullName } }),
  })
  if (!sent.ok) {
    console.error('invite e-mail failed', sent.status, await sent.text())
    // Do not leave an invitation behind that nobody received.
    await fetch(`${SUPABASE_URL}/rest/v1/participant_invitations?id=eq.${created.data}`, {
      method: 'DELETE',
      headers: { apikey: SERVICE_KEY, Authorization: asService },
    })
    return json(502, { error: 'email_not_sent' })
  }
  return json(200, { ok: true, invitation_id: created.data })
}
