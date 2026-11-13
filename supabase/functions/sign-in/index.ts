// Username sign-in and "forgot my password".
//
// Supabase Auth signs people in by e-mail. VentureTrack shows a username
// instead, so this function looks the e-mail up on the server (it is never sent
// to the browser) and then signs in with it.
//
// Safety properties:
//   * The answer for "wrong password" and "no such username" is identical.
//   * Five wrong passwords for a username within 15 minutes locks that username.
//   * "Forgot password" always gives the same answer, so it cannot be used to
//     find out which usernames exist.
import { ANON_KEY, SUPABASE_URL, asService, asString, corsHeaders, json, readBody, rpc } from '../_shared/http.ts'

const USERNAME = /^[a-z0-9][a-z0-9._]{2,29}$/
const WRONG = { error: 'invalid_credentials' }

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' })

  const body = await readBody(req)
  const action = asString(body.action) || 'sign-in'
  const username = asString(body.username, 60).trim().toLowerCase()
  const password = asString(body.password, 200)

  if (action === 'forgot') {
    if (USERNAME.test(username)) {
      const found = await rpc('sign_in_begin', { p_username: username }, asService)
      if (found.ok && typeof found.data === 'string') {
        const redirect = asString(body.redirect_to, 300)
        const query = redirect ? `?redirect_to=${encodeURIComponent(redirect)}` : ''
        await fetch(`${SUPABASE_URL}/auth/v1/recover${query}`, {
          method: 'POST',
          headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: found.data }),
        })
      }
    }
    return json(200, { ok: true })
  }

  if (action !== 'sign-in') return json(400, { error: 'unknown_action' })
  if (!USERNAME.test(username) || !password) return json(401, WRONG)

  const found = await rpc('sign_in_begin', { p_username: username }, asService)
  if (!found.ok) {
    if (found.message === 'too_many_attempts') return json(429, { error: 'too_many_attempts' })
    console.error('sign_in_begin failed', found.status, found.message)
    return json(500, { error: 'server_error' })
  }

  // For an unknown username we still ask Auth, with an address that cannot
  // exist, so both cases take about the same time.
  const email = typeof found.data === 'string' ? found.data : 'nobody@invalid.venturetrack.example'
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })

  if (!res.ok) {
    await rpc('sign_in_finish', { p_username: username, p_succeeded: false }, asService)
    return json(401, WRONG)
  }

  const session = await res.json()
  await rpc('sign_in_finish', { p_username: username, p_succeeded: true }, asService)
  return json(200, { access_token: session.access_token, refresh_token: session.refresh_token })
})
