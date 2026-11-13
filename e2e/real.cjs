// End-to-end check of the REAL app against the local Supabase stack.
//
// Before running:  npx supabase start && npx supabase functions serve   (in another terminal)
//                  npm run build
// Then:            npm run test:real
//
// WARNING: this wipes every account in the LOCAL database. It refuses to run
// against anything that is not 127.0.0.1.
const { chromium } = require('playwright')
const { spawn, execFileSync } = require('node:child_process')
const assert = require('node:assert/strict')

const API = 'http://127.0.0.1:54321'
const MAIL = 'http://127.0.0.1:54324'
const SITE = 'http://127.0.0.1:4173'
const DB = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
// The well-known keys of the local development stack. They open nothing else.
const ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
const SERVICE = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'
const shots = process.env.SHOTS_DIR

const OWNER_PASSWORD = 'owner-password-1'
const SAM_PASSWORD = 'sam-password-12'
const SAM_NEW_PASSWORD = 'sam-new-password-3'

const sql = (query) => execFileSync('psql', [DB, '-v', 'ON_ERROR_STOP=1', '-Atc', query], { encoding: 'utf8' }).trim()
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function api(path, { token = ANON, key = ANON, method = 'GET', body, headers = {} } = {}) {
  const res = await fetch(API + path, {
    method,
    headers: { apikey: key, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await res.text()
  let data = null
  try { data = text ? JSON.parse(text) : null } catch { data = text }
  return { status: res.status, ok: res.ok, data }
}

const signInApi = (username, password) => api('/functions/v1/sign-in', { method: 'POST', body: { username, password } })

/** Wait for the newest e-mail to `address` and return the link inside it. */
async function mailLink(address, after = 0) {
  for (let i = 0; i < 40; i++) {
    const list = await (await fetch(`${MAIL}/api/v1/messages`)).json()
    const hit = list.messages.find((m) => m.To.some((t) => t.Address === address) && new Date(m.Created).getTime() > after)
    if (hit) {
      const full = await (await fetch(`${MAIL}/api/v1/message/${hit.ID}`)).json()
      const match = (full.HTML || full.Text).match(/https?:\/\/[^"'\s<>]+\/auth\/v1\/verify[^"'\s<>]+/)
      assert.ok(match, 'the e-mail should contain a link')
      return match[0].replace(/&amp;/g, '&')
    }
    await sleep(250)
  }
  throw new Error(`no e-mail arrived for ${address}`)
}

async function main() {
  // Safety: only ever test a build that talks to the LOCAL stack.
  const built = execFileSync('sh', ['-c', 'cat dist/assets/*.js'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  if (!built.includes('127.0.0.1:54321')) {
    throw new Error('dist/ is not built against the local stack. Create .env.production.local (see .env.example) and run npm run build.')
  }

  // ---- Clean start: no accounts, no mail, one owner created the documented way ----
  sql('delete from public.participant_invitations; delete from auth.users; delete from private.sign_in_attempts;')
  await fetch(`${MAIL}/api/v1/messages`, { method: 'DELETE' })

  const created = await api('/auth/v1/admin/users', {
    method: 'POST', token: SERVICE, key: SERVICE,
    body: { email: 'owner@example.com', password: OWNER_PASSWORD, email_confirm: true },
  })
  assert.ok(created.ok, 'owner account should be created')
  sql("select private.provision_admin('owner@example.com', 'owner');")

  const server = spawn('npx', ['vite', 'preview', '--host', '127.0.0.1', '--port', '4173', '--strictPort'], { stdio: 'ignore', detached: true })
  const browser = await chromium.launch()
  const problems = []
  let step = 0
  const ok = (label) => console.log(`  ok ${++step}. ${label}`)
  const section = (name) => console.log(`\n${name}`)

  const watch = (page, who) => {
    page.on('pageerror', (e) => problems.push(`[${who}] page error: ${e.message}`))
    page.on('console', (m) => {
      // A refused sign-in is reported by the browser as a failed request; that is expected.
      if (m.type() === 'error' && !/status of 40[01379]|status of 429/.test(m.text())) problems.push(`[${who}] console: ${m.text()}`)
    })
  }
  /** The one-time link shown on screen, inside `scope`. */
  const shownLink = async (scope) => {
    const box = scope.getByTestId('share-link').locator('input')
    await box.waitFor()
    const link = await box.inputValue()
    assert.match(link, /\/auth\/v1\/verify\?/)
    return link
  }
  const mailCount = async () => (await (await fetch(`${MAIL}/api/v1/messages`)).json()).messages.length
  const snap = async (page, name) => {
    const wide = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)
    if (wide) problems.push(`"${name}" scrolls sideways`)
    if (shots) await page.screenshot({ path: `${shots}/real-${name}.png`, fullPage: true })
  }

  try {
    for (let i = 0; i < 40; i++) {
      try { if ((await fetch(SITE)).ok) break } catch {}
      await sleep(250)
    }

    // The owner uses a desktop-size window, the participant a phone-size one.
    const ownerCtx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
    const owner = await ownerCtx.newPage()
    watch(owner, 'owner')

    section('1. The page loads')
    await owner.goto(SITE)
    await owner.getByRole('heading', { name: 'Sign in' }).waitFor()
    assert.match(owner.url(), /\/sign-in$/)
    await snap(owner, 'sign-in')
    ok('a visitor who is not signed in is sent to the sign-in page')
    await owner.goto(`${SITE}/admin/people`)
    await owner.getByRole('heading', { name: 'Sign in' }).waitFor()
    ok('opening an inside page without signing in also leads to sign-in')

    section('2. Buttons and forms, with the real back end')
    await owner.getByLabel('Username').fill('owner')
    await owner.getByLabel('Password', { exact: true }).fill('not-the-password')
    await owner.getByRole('button', { name: 'Sign in' }).click()
    await owner.getByRole('alert').getByText('do not match').waitFor()
    ok('a wrong password is refused')

    await owner.getByLabel('Password', { exact: true }).fill(OWNER_PASSWORD)
    await owner.getByRole('button', { name: 'Sign in' }).click()
    await owner.getByRole('heading', { name: 'People' }).waitFor()
    await owner.getByText('Nobody has joined yet').waitFor()
    ok('the owner signs in with a username and password')

    const invite = async (name, email) => {
      await owner.getByRole('button', { name: 'Invite a person' }).click()
      await owner.getByLabel('Their name').fill(name)
      await owner.getByLabel('Their e-mail').fill(email)
      await owner.getByRole('button', { name: 'Make invitation link' }).click()
    }
    /** Invite, read the link from the dialog, close it. */
    const inviteAndGetLink = async (name, email) => {
      await invite(name, email)
      const dialog = owner.getByRole('dialog')
      const link = await shownLink(dialog)
      await dialog.getByRole('button', { name: 'Done' }).click()
      return link
    }
    await invite('Sam Baker', 'sam@example.com')
    const samLink = await shownLink(owner.getByRole('dialog'))
    await snap(owner, 'owner-invite-link')
    await owner.getByRole('dialog').getByRole('button', { name: 'Done' }).click()
    await owner.getByTestId('invitation').filter({ hasText: 'Sam Baker' }).waitFor()
    assert.equal(await mailCount(), 0)
    ok('the owner invites Sam and gets a link to send; no e-mail is sent')

    await invite('Sam Again', 'sam@example.com')
    await owner.getByRole('alert').getByText('already').waitFor()
    await owner.getByRole('button', { name: 'Close' }).click()
    ok('inviting the same e-mail twice is refused')

    // ---- Sam accepts on a phone ----
    const samCtx = await browser.newContext({ viewport: { width: 390, height: 844 } })
    const sam = await samCtx.newPage()
    watch(sam, 'sam')
    await sam.goto(samLink)
    await sam.getByRole('heading', { name: 'Welcome, Sam!' }).waitFor()
    await snap(sam, 'welcome')
    await sam.getByLabel('Choose a username').fill('owner')
    await sam.getByLabel(/Choose a password/).fill(SAM_PASSWORD)
    await sam.getByRole('button', { name: 'Create my account' }).click()
    await sam.getByRole('alert').getByText('already uses that username').waitFor()
    ok('Sam opens the link, and a username that is taken is refused')

    await sam.getByLabel('Choose a username').fill('sam.b')
    await sam.getByRole('button', { name: 'Create my account' }).click()
    await sam.getByRole('heading', { name: 'My profile' }).waitFor()
    ok('Sam picks a username and password and lands on their profile')

    await sam.getByLabel('Your business idea').fill('Dog walking for busy families.')
    await sam.getByRole('button', { name: 'Save changes' }).click()
    await sam.getByRole('status').getByText('Saved').waitFor()
    await sam.reload()
    await sam.getByRole('heading', { name: 'My profile' }).waitFor()
    assert.equal(await sam.getByLabel('Your business idea').inputValue(), 'Dog walking for busy families.')
    await snap(sam, 'participant-profile')
    ok('Sam saves their business idea and it is still there after reloading (really saved)')

    await sam.getByRole('button', { name: 'Sign out' }).click()
    await sam.getByRole('heading', { name: 'Sign in' }).waitFor()
    await sam.getByLabel('Username').fill('Sam.B')
    await sam.getByLabel('Password', { exact: true }).fill(SAM_PASSWORD)
    await sam.getByRole('button', { name: 'Sign in' }).click()
    await sam.getByRole('heading', { name: 'My profile' }).waitFor()
    ok('Sam signs out and signs back in with the username')

    await sam.goto(`${SITE}/admin/people`)
    await sam.getByRole('heading', { name: 'My profile' }).waitFor()
    ok('Sam cannot open the owner pages')

    // ---- Owner manages Sam ----
    await owner.reload()
    await owner.getByRole('link', { name: /Sam Baker/ }).click()
    await owner.getByText('Dog walking for busy families.').waitFor()
    const stageTwo = sql('select id from public.stages where position = 2')
    await owner.getByLabel(/Which stage are they in/).selectOption(stageTwo)
    await owner.getByRole('status').getByText('Stage saved.').waitFor()
    assert.equal(sql("select s.position from public.profiles p join public.stages s on s.id = p.current_stage_id where p.username = 'sam.b'"), '2')
    await snap(owner, 'owner-person')
    ok('the owner sees what Sam wrote and moves Sam to stage 2')

    // ---- Cancel and re-send ----
    await owner.getByRole('link', { name: 'All people' }).click()
    const kimLink = await inviteAndGetLink('Kim Reyes', 'kim@example.com')
    const kimRow = owner.getByTestId('invitation').filter({ hasText: 'Kim Reyes' })
    await kimRow.waitFor()
    await kimRow.getByRole('button', { name: 'Cancel invitation' }).click()
    await kimRow.getByRole('button', { name: 'Yes, cancel it' }).click()
    await kimRow.waitFor({ state: 'detached' })
    const kimCtx = await browser.newContext()
    const kim = await kimCtx.newPage()
    await kim.goto(kimLink)
    await kim.getByRole('heading', { name: 'Sign in' }).waitFor()
    assert.equal(await kim.getByRole('heading', { name: /Welcome/ }).count(), 0)
    assert.equal(sql("select count(*) from auth.users where email = 'kim@example.com'"), '0')
    await kimCtx.close()
    ok('a cancelled invitation link no longer works')

    const firstLeeLink = await inviteAndGetLink('Lee Park', 'lee@example.com')
    let leeRow = owner.getByTestId('invitation').filter({ hasText: 'Lee Park' })
    await leeRow.waitFor()
    await leeRow.getByRole('button', { name: 'Get a new link' }).click()
    leeRow = owner.getByTestId('invitation').filter({ hasText: 'Lee Park' })
    // The row already shows the first link; wait for it to be replaced.
    let secondLeeLink = firstLeeLink
    for (let i = 0; i < 40 && secondLeeLink === firstLeeLink; i++) {
      await sleep(250)
      secondLeeLink = await shownLink(leeRow)
    }
    assert.notEqual(firstLeeLink, secondLeeLink)
    const leeCtx = await browser.newContext()
    const lee = await leeCtx.newPage()
    await lee.goto(firstLeeLink)
    await lee.getByRole('heading', { name: 'Sign in' }).waitFor()
    assert.equal(await lee.getByRole('heading', { name: /Welcome/ }).count(), 0)
    await lee.goto(secondLeeLink)
    await lee.getByRole('heading', { name: 'Welcome, Lee!' }).waitFor()
    await leeCtx.close()
    ok('"Get a new link" makes a fresh link, and the old one stops working')

    // ---- Forgot password: the owner makes a link ----
    await sam.getByRole('button', { name: 'Sign out' }).click()
    await sam.getByRole('link', { name: 'Forgot your password?' }).click()
    await sam.getByText('Ask the programme owner for a new link').waitFor()
    await owner.getByRole('link', { name: /Sam Baker/ }).click()
    await owner.getByRole('button', { name: 'Make a password link' }).click()
    const resetLink = await shownLink(owner.locator('main'))
    await snap(owner, 'owner-reset-link')
    await sam.goto(resetLink)
    await sam.getByRole('heading', { name: 'Choose a new password' }).waitFor()
    await sam.getByLabel(/New password/).fill('short')
    await sam.getByRole('button', { name: 'Save new password' }).click()
    await sam.getByRole('alert').getByText('at least 10').waitFor()
    await sam.getByLabel(/New password/).fill(SAM_NEW_PASSWORD)
    await sam.getByRole('button', { name: 'Save new password' }).click()
    await sam.getByRole('heading', { name: 'My profile' }).waitFor()
    assert.equal((await signInApi('sam.b', SAM_PASSWORD)).status, 401)
    assert.equal((await signInApi('sam.b', SAM_NEW_PASSWORD)).status, 200)
    sql('delete from private.sign_in_attempts;')
    const reuse = await browser.newContext()
    const reusePage = await reuse.newPage()
    await reusePage.goto(resetLink)
    await reusePage.getByRole('heading', { name: 'Sign in' }).waitFor()
    assert.equal(await reusePage.getByRole('heading', { name: 'Choose a new password' }).count(), 0)
    await reuse.close()
    assert.equal(await mailCount(), 0)
    ok('forgot password: the owner makes a link, Sam chooses a new password, and the link cannot be used twice')

    // ---- 4. Security: try every door, straight at the back end ----
    section('3. Security (talking to the back end directly, skipping the screens)')
    step = 0
    const samToken = (await signInApi('sam.b', SAM_NEW_PASSWORD)).data.access_token
    const ownerToken = (await signInApi('owner', OWNER_PASSWORD)).data.access_token
    const samId = sql("select id from public.profiles where username = 'sam.b'")
    const ownerId = sql("select id from public.profiles where role = 'admin'")

    const anonRead = await api('/rest/v1/profiles?select=*')
    assert.ok(!anonRead.ok || anonRead.data.length === 0)
    ok('a visitor who is not signed in can read no profiles')

    const signup = await api('/auth/v1/signup', { method: 'POST', body: { email: 'stranger@example.com', password: 'stranger-password-1' } })
    assert.ok(!signup.ok)
    assert.equal(sql("select count(*) from auth.users where email = 'stranger@example.com'"), '0')
    ok('a stranger cannot create an account')

    const samSees = await api('/rest/v1/profiles?select=id,username,email,role', { token: samToken })
    assert.deepEqual(samSees.data.map((r) => r.id), [samId])
    ok('Sam can read exactly one profile: their own (not the owner, not other people)')

    const samInvites = await api('/rest/v1/participant_invitations?select=*', { token: samToken })
    assert.equal(samInvites.data.length, 0)
    ok('Sam can read no invitations')

    const patch = (token, id, body) => api(`/rest/v1/profiles?id=eq.${id}`, { method: 'PATCH', token, body, headers: { Prefer: 'return=representation' } })
    assert.ok(!(await patch(samToken, samId, { role: 'admin' })).ok)
    assert.equal(sql(`select role from public.profiles where id = '${samId}'`), 'participant')
    ok('Sam cannot make themselves the owner')

    assert.ok(!(await patch(samToken, samId, { current_stage_id: sql('select id from public.stages where position = 6') })).ok)
    assert.ok(!(await patch(samToken, samId, { username: 'boss' })).ok)
    assert.ok(!(await patch(samToken, samId, { status: 'completed' })).ok)
    assert.equal(sql(`select s.position || '/' || p.username || '/' || p.status from public.profiles p join public.stages s on s.id = p.current_stage_id where p.id = '${samId}'`), '2/sam.b/active')
    ok('Sam cannot change their own stage, username or status')

    const samEditsOwner = await patch(samToken, ownerId, { full_name: 'Hacked' })
    assert.ok(!samEditsOwner.ok || samEditsOwner.data.length === 0)
    assert.equal(sql(`select full_name from public.profiles where id = '${ownerId}'`), 'Administrator')
    ok("Sam cannot edit the owner's profile")

    const samInvite = await api('/functions/v1/invite-participant', { method: 'POST', token: samToken, body: { action: 'invite', email: 'friend@example.com', full_name: 'Friend' } })
    assert.equal(samInvite.status, 403)
    assert.ok(!(await api('/rest/v1/rpc/create_invitation', { method: 'POST', token: samToken, body: { p_email: 'friend@example.com', p_full_name: 'Friend' } })).ok)
    assert.equal(sql("select count(*) from public.participant_invitations where email = 'friend@example.com'"), '0')
    ok('Sam cannot invite anyone')

    for (const target of [ownerId, samId]) {
      const res = await api('/functions/v1/invite-participant', { method: 'POST', token: samToken, body: { action: 'reset-link', profile_id: target } })
      assert.equal(res.status, 403)
      assert.ok(!res.data.link)
    }
    const ownerSelf = await api('/functions/v1/invite-participant', { method: 'POST', token: ownerToken, body: { action: 'reset-link', profile_id: ownerId } })
    assert.ok(!ownerSelf.ok && !ownerSelf.data.link)
    ok("Sam cannot make a password link for anyone, and no link can be made for the owner's account")

    const noToken = await api('/functions/v1/invite-participant', { method: 'POST', body: { action: 'invite', email: 'x@example.com', full_name: 'X' } })
    assert.ok(noToken.status === 401 || noToken.status === 403)
    ok('the invitation service refuses callers who are not signed in')

    for (const token of [samToken, ANON]) {
      assert.ok(!(await api('/rest/v1/rpc/sign_in_begin', { method: 'POST', token, body: { p_username: 'owner' } })).ok)
    }
    ok("nobody can look up the e-mail address behind a username")

    assert.ok(!(await api('/rest/v1/rpc/provision_admin', { method: 'POST', token: samToken, body: { p_email: 'sam@example.com', p_username: 'sam.b' } })).ok)
    let secondAdmin = 'refused'
    try {
      execFileSync('psql', [DB, '-v', 'ON_ERROR_STOP=1', '-Atc', `update public.profiles set role = 'admin', current_stage_id = null where id = '${samId}'`], { stdio: 'pipe' })
      secondAdmin = 'allowed'
    } catch (e) {
      assert.match(String(e.stderr), /profiles_single_admin_idx/)
    }
    assert.equal(secondAdmin, 'refused')
    ok('a second owner cannot exist, even for someone with direct database access')

    assert.ok(!(await patch(ownerToken, samId, { role: 'admin' })).ok)
    ok('even the owner cannot hand out the owner role through the app')

    assert.ok((await patch(ownerToken, samId, { archived_at: new Date().toISOString() })).ok)
    assert.ok(!(await patch(samToken, samId, { business_idea: 'Changed while archived' })).ok)
    assert.equal(sql(`select business_idea from public.profiles where id = '${samId}'`), 'Dog walking for busy families.')
    assert.ok((await patch(ownerToken, samId, { archived_at: null })).ok)
    ok('an archived person cannot change anything')

    const wrongUser = await signInApi('no.such.person', 'whatever-password')
    const wrongPass = await signInApi('sam.b', 'whatever-password')
    assert.equal(wrongUser.status, 401)
    assert.deepEqual(wrongUser.data, wrongPass.data)
    ok('"no such username" and "wrong password" give the same answer')

    for (let i = 0; i < 4; i++) await signInApi('sam.b', 'whatever-password')
    assert.equal((await signInApi('sam.b', SAM_NEW_PASSWORD)).status, 429)
    ok('after 5 wrong passwords the username is locked, even for the right password')
    sql('delete from private.sign_in_attempts;')
    assert.equal((await signInApi('sam.b', SAM_NEW_PASSWORD)).status, 200)

    const bundle = execFileSync('sh', ['-c', 'cat dist/assets/*.js'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
    assert.ok(!bundle.includes(SERVICE) && !bundle.includes('service_role'))
    ok('the secret server key is not inside the app that browsers download')
  } finally {
    await browser.close()
    // Stop the preview server and the process it started.
    try { process.kill(-server.pid) } catch {}
  }

  if (problems.length) {
    console.error('\nPROBLEMS:\n' + problems.join('\n'))
    process.exit(1)
  }
  console.log('\nAll checks passed with no errors on the page.')
}

main().catch((e) => {
  console.error('\nFAILED:', e.stack || e.message)
  process.exit(1)
})
