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
const crypto = require('node:crypto')
const http = require('node:http')

// ---------- A stand-in for the push service (Google's or Apple's) ----------
// It receives what send-push sends, checks the VAPID signature, and decrypts
// the message exactly as a phone would (RFC 8291 / RFC 8292).
const b64url = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const fromB64url = (text) => Buffer.from(text.replace(/-/g, '+').replace(/_/g, '/'), 'base64')

function fakeDevice() {
  const ecdh = crypto.createECDH('prime256v1')
  ecdh.generateKeys()
  const auth = crypto.randomBytes(16)
  return { ecdh, auth, p256dh: b64url(ecdh.getPublicKey()), authB64: b64url(auth) }
}

function decrypt(device, body) {
  const salt = body.subarray(0, 16)
  const idLength = body[20]
  const asPublic = body.subarray(21, 21 + idLength)
  const cipher = body.subarray(21 + idLength)
  const shared = device.ecdh.computeSecret(asPublic)
  const uaPublic = device.ecdh.getPublicKey()
  const info = Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic])
  const ikm = Buffer.from(crypto.hkdfSync('sha256', shared, device.auth, info, 32))
  const cek = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16))
  const nonce = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12))
  const decipher = crypto.createDecipheriv('aes-128-gcm', cek, nonce)
  decipher.setAuthTag(cipher.subarray(cipher.length - 16))
  const plain = Buffer.concat([decipher.update(cipher.subarray(0, cipher.length - 16)), decipher.final()])
  return JSON.parse(plain.subarray(0, plain.lastIndexOf(2)).toString('utf8'))
}

function verifyVapid(header, origin, expectedKey) {
  const t = header.match(/t=([^,\s]+)/)[1]
  const k = header.match(/k=([^,\s]+)/)[1]
  assert.equal(k, expectedKey, 'the push must be signed with our public key')
  const [h, c, sig] = t.split('.')
  const raw = fromB64url(k)
  const key = crypto.createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: b64url(raw.subarray(1, 33)), y: b64url(raw.subarray(33, 65)) }, format: 'jwk' })
  assert.ok(crypto.verify('sha256', Buffer.from(`${h}.${c}`), { key, dsaEncoding: 'ieee-p1363' }, fromB64url(sig)), 'the VAPID signature must be valid')
  const claims = JSON.parse(fromB64url(c).toString())
  assert.equal(claims.aud, origin)
  assert.ok(claims.exp > Date.now() / 1000)
}

function startPushService(port) {
  const received = [] // { path, headers, body }
  const server = http.createServer((req, res) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => {
      received.push({ path: req.url, headers: req.headers, body: Buffer.concat(chunks) })
      res.statusCode = req.url.endsWith('/gone') ? 410 : 201
      res.end()
    })
  })
  server.listen(port, '0.0.0.0')
  return { server, received }
}

const OWNER_PASSWORD = 'owner-password-1'
const SAM_PASSWORD = 'sam-password-12'
const SAM_NEW_PASSWORD = 'sam-new-password-3'
const LEE_PASSWORD = 'lee-password-123'

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
  // Phone notifications need the local keys and Vault entries (safe to repeat).
  execFileSync('node', ['scripts/local-push-setup.mjs'], { stdio: 'ignore' })
  const VAPID_PUBLIC = require('node:fs').readFileSync('supabase/functions/.env', 'utf8').match(/^VAPID_PUBLIC_KEY=(.*)$/m)[1]
  const PUSH_PORT = 4190
  const pushService = startPushService(PUSH_PORT)
  // The functions run in a container; from there this machine is the network's gateway.
  const gateway = execFileSync('docker', ['network', 'inspect', 'supabase_network_Smu2', '-f', '{{range .IPAM.Config}}{{.Gateway}}{{end}}'], { encoding: 'utf8' }).trim()
  const pushOrigin = `http://${gateway}:${PUSH_PORT}`
  // Safety: only ever test a build that talks to the LOCAL stack.
  const built = execFileSync('sh', ['-c', 'cat dist/assets/*.js'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  if (!built.includes('127.0.0.1:54321')) {
    throw new Error('dist/ is not built against the local stack. Create .env.production.local (see .env.example) and run npm run build.')
  }

  // ---- Clean start: no accounts, no mail, one owner created the documented way ----
  sql('delete from private.push_outbox; delete from private.push_digests; delete from public.push_subscriptions; delete from public.reminders; delete from public.help_requests; delete from public.milestones; delete from public.polls; delete from public.shared_files; delete from public.finance_entries; delete from public.messages; delete from public.tasks; delete from public.participant_invitations; delete from auth.users; delete from private.sign_in_attempts;')
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
  /** Wait until a poll result row reads e.g. "2 votes". */
  const resultSays = async (poll, label, text) => {
    const row = poll.getByTestId('poll-result').filter({ hasText: label })
    for (let i = 0; i < 60; i++) {
      const all = await row.allTextContents()
      if (all.some((t) => t.replace(/\s+/g, ' ').includes(text))) return
      await sleep(250)
    }
    throw new Error(`"${label}" never showed "${text}": ${JSON.stringify(await row.allTextContents())}`)
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
    await owner.getByRole('heading', { name: 'Dashboard' }).waitFor()
    await owner.getByText('Nobody needs you right now').waitFor()
    await owner.getByRole('navigation').getByRole('link', { name: /^People/ }).click()
    await owner.getByText('Nobody has joined yet').waitFor()
    ok('the owner signs in with a username and password and lands on the dashboard')

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
    await sam.getByRole('heading', { name: 'Hello, Sam' }).waitFor()
    await snap(sam, 'participant-home-empty')
    ok('Sam picks a username and password and lands on their home page')

    await sam.getByRole('navigation').getByRole('link', { name: /^Profile/ }).click()
    await sam.getByRole('heading', { name: 'My profile' }).waitFor()

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
    await sam.getByRole('heading', { name: 'Hello, Sam' }).waitFor()
    ok('Sam signs out and signs back in with the username')

    await sam.goto(`${SITE}/admin/people`)
    await sam.getByRole('heading', { name: 'Hello, Sam' }).waitFor()
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
    await lee.getByLabel('Choose a username').fill('lee.p')
    await lee.getByLabel(/Choose a password/).fill(LEE_PASSWORD)
    await lee.getByRole('button', { name: 'Create my account' }).click()
    await lee.getByRole('heading', { name: 'Hello, Lee' }).waitFor()
    watch(lee, 'lee')
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
    await sam.getByRole('heading', { name: 'Hello, Sam' }).waitFor()
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

    // ---- Tasks ----
    section('3. Tasks, files and messages, with the real back end')
    step = 0
    const percent = async (page) => Number(await page.getByRole('progressbar').first().getAttribute('aria-valuenow'))
    const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64')

    await owner.getByRole('button', { name: 'Give a task' }).click()
    await owner.getByLabel('What should they do?').fill('Write a one-page plan')
    await owner.getByLabel('Details (optional)').fill('Who buys, what they pay, what it costs you.')
    await owner.getByRole('button', { name: 'Give this task' }).click()
    await owner.getByTestId('task-card').filter({ hasText: 'Write a one-page plan' }).waitFor()
    assert.equal(await percent(owner), 17)
    ok('the owner gives Sam a task; Sam is in stage 2 of 6 with nothing approved, so progress is 17%')

    await sam.getByRole('navigation').getByRole('link', { name: /^Tasks/ }).click()
    const samTask = sam.getByTestId('task-card').filter({ hasText: 'Write a one-page plan' })
    await samTask.getByRole('button', { name: 'Start this task' }).click()
    await samTask.getByText('In progress').waitFor()
    await samTask.getByLabel('Your work').fill('Here is my plan, with a photo and my costs.')
    await samTask.locator('input[type=file]').setInputFiles([
      { name: 'plan photo.png', mimeType: 'image/png', buffer: PNG },
      { name: 'costs.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 sample costs') },
    ])
    assert.equal(await samTask.getByTestId('picked-file').count(), 2)
    await samTask.getByRole('button', { name: 'Hand in' }).click()
    await samTask.getByText('Waiting for the owner').waitFor()
    assert.equal(await samTask.getByTestId('attachment').count(), 2)
    await samTask.locator('img').waitFor()
    assert.ok(await samTask.locator('img').evaluate((img) => img.complete && img.naturalWidth > 0), 'the picture should really load')
    assert.equal(await sam.getByRole('button', { name: 'Approve' }).count(), 0)
    await snap(sam, 'participant-task-handed-in')
    ok('Sam starts the task and hands in text, a picture and a file; the picture loads back from storage')

    await owner.getByRole('navigation').getByRole('link', { name: /^Tasks/ }).click()
    await owner.getByRole('button', { name: 'To check (1)' }).waitFor()
    const ownerTask = owner.getByTestId('task-card').filter({ hasText: 'Write a one-page plan' })
    await ownerTask.getByText('Here is my plan, with a photo and my costs.').waitFor()
    assert.equal(await ownerTask.getByTestId('attachment').count(), 2)
    await ownerTask.locator('img').waitFor()
    assert.ok(await ownerTask.locator('img').evaluate((img) => img.complete && img.naturalWidth > 0))
    await snap(owner, 'owner-task-review')
    await ownerTask.getByLabel(/Your feedback/).fill('Please add your prices.')
    await ownerTask.getByRole('button', { name: 'Ask for changes' }).click()
    await owner.getByRole('button', { name: 'To check (0)' }).waitFor()
    ok('the owner sees the work and both files, and asks for changes')

    await sam.reload()
    const samTask2 = sam.getByTestId('task-card').filter({ hasText: 'Write a one-page plan' })
    await samTask2.getByText('Needs changes').waitFor()
    await samTask2.getByText('Please add your prices.').waitFor()
    await samTask2.getByLabel('Your work').fill('Added prices: 12 euros per walk.')
    await samTask2.getByRole('button', { name: 'Hand in' }).click()
    await samTask2.getByText('Waiting for the owner').waitFor()
    ok('Sam reads the feedback and hands in again')

    await owner.reload()
    await owner.getByRole('button', { name: 'To check (1)' }).waitFor()
    const ownerTask2 = owner.getByTestId('task-card').filter({ hasText: 'Write a one-page plan' })
    await ownerTask2.getByLabel(/Your feedback/).fill('Clear plan. Approved!')
    await ownerTask2.getByRole('button', { name: 'Approve' }).click()
    await owner.getByRole('button', { name: 'To check (0)' }).waitFor()
    await owner.getByRole('navigation').getByRole('link', { name: /^People/ }).click()
    // Lee is listed first, so look at Sam's own row.
    await owner.getByRole('link', { name: /Sam Baker/ }).locator('[role=progressbar][aria-valuenow="33"]').waitFor()
    await snap(owner, 'owner-people-progress')
    await sam.getByRole('navigation').getByRole('link', { name: /^Home/ }).click()
    await sam.reload()
    await sam.getByText('Clear plan. Approved!').waitFor()
    await sam.locator('[role=progressbar][aria-valuenow="33"]').waitFor()
    await snap(sam, 'participant-home')
    ok('the owner approves; progress moves to 33% for both the owner and Sam')

    // ---- Messages ----
    await owner.getByRole('navigation').getByRole('link', { name: /^Messages/ }).click()
    await owner.getByRole('link', { name: /Sam Baker/ }).click()
    await owner.getByLabel('Write a message').fill('Well done on the plan!')
    await owner.getByRole('button', { name: 'Send message' }).click()
    await owner.getByTestId('chat-thread').getByText('Well done on the plan!').waitFor()
    await sam.getByRole('navigation').getByRole('link', { name: /Messages/ }).click()
    await sam.getByRole('link', { name: /Administrator/ }).getByText('1 new').waitFor({ timeout: 15000 })
    await snap(sam, 'participant-messages')
    await sam.getByRole('link', { name: /Administrator/ }).click()
    await sam.getByTestId('chat-thread').getByText('Well done on the plan!').waitFor()
    await sam.getByLabel('Write a message').fill('Thank you!')
    await sam.getByRole('button', { name: 'Send message' }).click()
    await owner.getByTestId('chat-thread').getByText('Thank you!').waitFor({ timeout: 15000 })
    await snap(owner, 'owner-chat')
    ok('the owner and Sam exchange messages; the reply appears on the other screen by itself within seconds')

    await sam.getByRole('link', { name: 'All conversations' }).click()
    await sam.getByRole('link', { name: /Lee Park/ }).click()
    await sam.getByLabel('Write a message').fill('Hi Lee, want to swap flyers?')
    await sam.getByRole('button', { name: 'Send message' }).click()
    await lee.getByRole('navigation').getByRole('link', { name: /Messages/ }).click()
    await lee.getByRole('link', { name: /Sam Baker/ }).click()
    await lee.getByTestId('chat-thread').getByText('Hi Lee, want to swap flyers?').waitFor({ timeout: 15000 })
    await lee.getByLabel('Write a message').fill('Yes please!')
    await lee.getByRole('button', { name: 'Send message' }).click()
    await sam.getByTestId('chat-thread').getByText('Yes please!').waitFor({ timeout: 15000 })
    ok('Sam and Lee, two participants, message each other')

    await owner.getByRole('link', { name: 'All conversations' }).click()
    await owner.getByRole('link', { name: /Lee Park/ }).click()
    await owner.getByTestId('chat-thread').waitFor()
    assert.equal(await owner.getByText('swap flyers').count(), 0)
    assert.equal(await lee.getByRole('navigation').getByRole('link', { name: /^Tasks/ }).count(), 1)
    await lee.getByRole('navigation').getByRole('link', { name: /^Tasks/ }).click()
    await lee.getByText('You have no tasks yet').waitFor()
    ok("the owner's screen shows nothing of the Sam–Lee conversation, and Lee sees none of Sam's tasks")

    // ---- Money ----
    section('4. Money and shared spreadsheets, with the real back end')
    step = 0
    const nav = (page, label) => page.getByRole('navigation').getByRole('link', { name: new RegExp('^' + label) })
    await nav(sam, 'Money').click()
    await sam.getByText('No numbers yet').waitFor()
    const addMonth = async (monthName, inAmount, outAmount, note) => {
      await sam.getByLabel('Month', { exact: true }).selectOption({ label: monthName })
      await sam.getByLabel('Money in (€)').fill(inAmount)
      await sam.getByLabel('Money out (€)').fill(outAmount)
      await sam.getByLabel('Note (optional)').fill(note)
      await sam.getByRole('button', { name: /Save this month|Save changes/ }).click()
      await sam.getByRole('status').getByText(`Saved ${monthName}`).waitFor()
    }
    // Two months that have certainly started: this month and January of this year (or last year in January).
    const today = new Date()
    const thisMonth = today.toLocaleString('en', { month: 'long' })
    if (today.getMonth() === 0) await sam.getByLabel('Year').selectOption(String(today.getFullYear() - 1))
    const earlier = today.getMonth() === 0 ? 'December' : 'January'
    await addMonth(earlier, '400', '250,50', 'First customers')
    if (today.getMonth() === 0) await sam.getByLabel('Year').selectOption(String(today.getFullYear()))
    await addMonth(thisMonth, '900', '300', 'More walks')
    assert.equal(await sam.getByTestId('money-row').count(), 2)
    await sam.getByText('€749.50').waitFor()
    await sam.getByRole('button', { name: new RegExp(`^${earlier}.*money in`) }).hover()
    await sam.locator('figcaption').getByText('left over').waitFor()
    await sam.getByLabel('Money in (€)').fill('abc')
    await sam.getByRole('button', { name: /Save/ }).click()
    await sam.getByRole('alert').getByText('Type amounts as numbers').waitFor()
    await sam.reload()
    await sam.getByText('€749.50').waitFor()
    await sam.getByLabel('Money in (€)').and(sam.locator('[value="900"]')).waitFor()
    assert.equal(await sam.getByLabel('Money out (€)').inputValue(), '300')
    await snap(sam, 'participant-money')
    ok('Sam adds two months of money numbers; the totals are right (1300 in, 550.50 out, 749.50 left) and survive a reload')

    await nav(owner, 'People').click()
    await owner.getByRole('link', { name: /Sam Baker/ }).click()
    await owner.getByText('€749.50').waitFor()
    assert.equal(await owner.getByTestId('money-row').count(), 2)
    assert.equal(await owner.getByRole('button', { name: /^Change / }).count(), 0)
    await snap(owner, 'owner-person-money')
    ok("the owner sees Sam's money numbers on Sam's page, and has no way to change them")

    await nav(lee, 'Money').click()
    await lee.getByText('No numbers yet').waitFor()
    ok("Lee's money page is empty: Lee sees none of Sam's numbers")

    // ---- Shared spreadsheets ----
    const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    await nav(sam, 'Files').click()
    await sam.locator('#shared-file').setInputFiles({ name: 'holiday.png', mimeType: 'image/png', buffer: PNG })
    await sam.getByRole('alert').getByText('Only spreadsheet files').waitFor()
    await sam.locator('#shared-file').setInputFiles({ name: 'Price list 2026.xlsx', mimeType: XLSX_TYPE, buffer: Buffer.from('PK sample spreadsheet bytes') })
    await sam.getByTestId('chosen-file').getByText('Price list 2026.xlsx').waitFor()
    assert.equal(await sam.getByLabel('Name to show in the list').inputValue(), 'Price list 2026')
    await sam.getByRole('button', { name: 'Send for approval' }).click()
    await sam.getByRole('status').getByText('Sent to the owner').waitFor()
    await sam.getByTestId('shared-file').filter({ hasText: 'Price list 2026' }).getByText('Waiting for approval').waitFor()
    ok('Sam cannot share a picture, then sends a spreadsheet for approval')

    await nav(lee, 'Files').click()
    await lee.getByText('No shared files yet').waitFor()
    assert.equal(await lee.getByTestId('shared-file').count(), 0)
    ok('before approval, Lee cannot see the spreadsheet')

    await owner.reload()
    await nav(owner, 'Files').getByText('1').waitFor()
    await nav(owner, 'Files').click()
    const waiting = owner.getByTestId('shared-file').filter({ hasText: 'Price list 2026' })
    await waiting.getByText('Sam Baker').waitFor()
    await snap(owner, 'owner-files-pending')
    const [ownerDownload] = await Promise.all([owner.waitForEvent('download'), waiting.getByRole('link', { name: 'Download' }).click()])
    assert.equal(ownerDownload.suggestedFilename(), 'Price list 2026.xlsx')
    await waiting.getByLabel(/Note for the person/).fill('Thanks, very useful.')
    await waiting.getByRole('button', { name: 'Approve' }).click()
    await owner.getByRole('heading', { name: 'Waiting for your approval' }).waitFor({ state: 'detached' })
    ok('the owner sees it waiting, downloads it to look inside, and approves it')

    await lee.reload()
    const leeFile = lee.getByTestId('shared-file').filter({ hasText: 'Price list 2026' })
    await leeFile.getByText('Sam Baker').waitFor()
    const [leeDownload] = await Promise.all([lee.waitForEvent('download'), leeFile.getByRole('link', { name: 'Download' }).click()])
    assert.equal(leeDownload.suggestedFilename(), 'Price list 2026.xlsx')
    const fs = require('node:fs')
    assert.equal(fs.readFileSync(await leeDownload.path(), 'utf8'), 'PK sample spreadsheet bytes')
    await snap(lee, 'participant-files')
    ok('after approval, Lee sees the spreadsheet and downloads the very same file')

    await owner.locator('#shared-file').setInputFiles({ name: 'budget-template.csv', mimeType: 'text/csv', buffer: Buffer.from('month,in,out\n') })
    await owner.getByRole('button', { name: 'Share with everyone' }).click()
    await owner.getByRole('status').getByText('Shared with everyone').waitFor()
    await sam.reload()
    await sam.getByTestId('shared-file').filter({ hasText: 'budget-template' }).waitFor()
    ok("the owner's own spreadsheet is shared with everyone straight away")

    const shared = owner.getByTestId('shared-file').filter({ hasText: 'Price list 2026' })
    await shared.getByRole('button', { name: 'Stop sharing' }).click()
    await shared.getByRole('button', { name: 'Yes, stop sharing' }).click()
    await owner.getByRole('heading', { name: 'Not shared' }).waitFor()
    await lee.reload()
    await lee.getByTestId('shared-file').filter({ hasText: 'budget-template' }).waitFor()
    assert.equal(await lee.getByTestId('shared-file').filter({ hasText: 'Price list 2026' }).count(), 0)
    ok('when the owner stops sharing a file, it disappears for everyone else')

    // ---- Polls ----
    section('5. Polls, with the real back end')
    step = 0
    await nav(owner, 'Polls').click()
    await owner.getByText('No polls yet').waitFor()
    await owner.getByRole('button', { name: 'New poll' }).click()
    const pollDialog = owner.getByRole('dialog')
    await pollDialog.getByLabel('Question').fill('Which day suits the workshop?')
    await pollDialog.getByLabel('Choice 1', { exact: true }).fill('Monday')
    await pollDialog.getByLabel('Choice 2', { exact: true }).fill('Tuesday')
    await pollDialog.getByLabel('Choice 3', { exact: true }).fill('Wednesday')
    await pollDialog.getByRole('button', { name: 'Add a choice' }).click()
    await pollDialog.getByLabel('Choice 4', { exact: true }).fill('Thursday')
    await pollDialog.getByRole('button', { name: 'Add a choice' }).click()
    await pollDialog.getByLabel('Choice 5', { exact: true }).fill('tuesday')
    await pollDialog.getByRole('button', { name: 'Start the poll' }).click()
    await pollDialog.getByRole('alert').getByText('Two choices are the same').waitFor()
    await pollDialog.getByRole('button', { name: 'Remove choice 5' }).click()
    await pollDialog.getByRole('button', { name: 'Start the poll' }).click()
    await owner.getByTestId('poll').filter({ hasText: 'Which day suits the workshop?' }).getByText('Choose one ·').waitFor()

    await owner.getByRole('button', { name: 'New poll' }).click()
    await pollDialog.getByLabel('Question').fill('Which topics do you want help with?')
    for (const [i, label] of ['Pricing', 'Marketing', 'Taxes', 'Pitching', 'Legal'].entries()) {
      if (i >= 3) await pollDialog.getByRole('button', { name: 'Add a choice' }).click()
      await pollDialog.getByLabel(`Choice ${i + 1}`, { exact: true }).fill(label)
    }
    await pollDialog.getByLabel('People can pick more than one').check()
    await pollDialog.getByRole('button', { name: 'Start the poll' }).click()
    await owner.getByTestId('poll').filter({ hasText: 'Which topics' }).getByText('Choose one or more').waitFor()
    const firstPoll = owner.getByTestId('poll').filter({ hasText: 'Which day' })
    await resultSays(firstPoll, 'Monday', '0 votes')
    assert.equal(await firstPoll.getByRole('radio').count(), 0)
    await snap(owner, 'owner-polls')
    ok('the owner makes a one-choice poll with 4 choices (a repeated choice is caught) and a pick-several poll with 5, and sees the results straight away')

    await nav(sam, 'Polls').click()
    const samDay = sam.getByTestId('poll').filter({ hasText: 'Which day' })
    assert.equal(await samDay.getByTestId('poll-result').count(), 0)
    await samDay.getByRole('button', { name: 'Vote' }).click()
    await samDay.getByRole('alert').getByText('Pick a choice first').waitFor()
    await samDay.getByLabel('Tuesday').check()
    await samDay.getByLabel('Thursday').check()
    assert.equal(await samDay.getByLabel('Tuesday').isChecked(), false)
    await samDay.getByRole('button', { name: 'Vote' }).click()
    await samDay.getByText('You voted').waitFor()
    await resultSays(samDay, 'Thursday', '100%')
    await resultSays(samDay, 'Thursday', 'your choice')
    const samTopics = sam.getByTestId('poll').filter({ hasText: 'Which topics' })
    for (const label of ['Pricing', 'Taxes', 'Legal']) await samTopics.getByLabel(label).check()
    await samTopics.getByRole('button', { name: 'Vote' }).click()
    await samTopics.getByText('You voted').waitFor()
    await samTopics.getByText('your choice').nth(2).waitFor()
    assert.equal(await samTopics.getByText('your choice').count(), 3)
    await snap(sam, 'participant-polls')
    ok('Sam sees no results before voting, can pick only one on the one-choice poll, three on the other, then sees the results')

    await nav(lee, 'Polls').click()
    const leeDay = lee.getByTestId('poll').filter({ hasText: 'Which day' })
    await leeDay.getByLabel('Monday').check()
    await leeDay.getByRole('button', { name: 'Vote' }).click()
    await leeDay.getByTestId('voter-count').getByText('2 people have voted').waitFor()
    await leeDay.getByRole('button', { name: 'Change my vote' }).click()
    await leeDay.getByLabel('Thursday').check()
    await leeDay.getByRole('button', { name: 'Save my new vote' }).click()
    await resultSays(leeDay, 'Thursday', '2 votes')
    await resultSays(leeDay, 'Monday', '0 votes')
    ok('Lee votes, then changes the vote; the totals follow (Thursday 2, Monday 0)')

    await owner.reload()
    const ownerDay = owner.getByTestId('poll').filter({ hasText: 'Which day' })
    await resultSays(ownerDay, 'Thursday', '2 votes')
    await ownerDay.getByRole('button', { name: 'Close the poll' }).click()
    await owner.getByRole('heading', { name: 'Closed' }).waitFor()
    await sam.reload()
    const samClosed = sam.getByTestId('poll').filter({ hasText: 'Which day' })
    await samClosed.getByText('Closed', { exact: true }).waitFor()
    assert.equal(await samClosed.getByRole('button', { name: /vote/i }).count(), 0)
    ok('the owner sees the totals and closes the poll; Sam can no longer vote on it')

    const ownerTopics = owner.getByTestId('poll').filter({ hasText: 'Which topics' })
    await ownerTopics.getByRole('button', { name: 'Delete' }).click()
    await ownerTopics.getByRole('button', { name: 'Yes, delete it' }).click()
    await ownerTopics.waitFor({ state: 'detached' })
    await sam.reload()
    await sam.getByTestId('poll').filter({ hasText: 'Which day' }).waitFor()
    assert.equal(await sam.getByTestId('poll').filter({ hasText: 'Which topics' }).count(), 0)
    ok('the owner deletes a poll and it disappears for everyone')

    // ---- Dashboard, milestones, help ----
    section('6. Dashboard, milestones and asking for help, with the real back end')
    step = 0
    const stat = (page, label) => page.getByTestId('stat').filter({ hasText: label }).locator('dd')
    await nav(sam, 'Home').click()
    await sam.getByRole('button', { name: 'Ask for help' }).click()
    await sam.getByRole('dialog').getByRole('button', { name: 'Send request' }).click()
    await sam.getByRole('dialog').getByRole('alert').getByText('Write what you need help with').waitFor()
    await sam.getByLabel('What do you need help with?').fill('How do I set my prices for groups of dogs?')
    await sam.getByRole('dialog').getByRole('button', { name: 'Send request' }).click()
    await sam.getByText('Help requested').waitFor()
    assert.equal(await sam.getByRole('button', { name: 'Ask for help' }).count(), 0)
    ok('Sam asks for help and sees it is waiting; the button is gone until the owner handles it')

    await nav(owner, 'Dashboard').click()
    await owner.getByRole('heading', { name: 'Dashboard' }).waitFor()
    await owner.getByTestId('attention-row').filter({ hasText: 'Sam Baker' }).getByText('Asked for help').waitFor()
    assert.equal(await stat(owner, 'Active people').textContent(), '2')
    assert.equal(await stat(owner, 'Help requests').textContent(), '1')
    assert.equal(await stat(owner, 'Work to check').textContent(), '0')
    assert.equal(await owner.getByTestId('attention-row').filter({ hasText: 'Lee Park' }).count(), 0)
    await snap(owner, 'owner-dashboard')
    ok('the dashboard counts 2 active people and 1 help request, and lists Sam (not Lee) under "Needs your attention"')

    await owner.getByTestId('attention-row').filter({ hasText: 'Sam Baker' }).click()
    await owner.getByTestId('help-request').getByText('groups of dogs').waitFor()
    await owner.getByTestId('help-request').getByRole('button', { name: 'Mark as handled' }).click()
    await owner.getByTestId('help-request').waitFor({ state: 'detached' })
    ok("the owner opens Sam's page from the dashboard, reads the request and marks it handled")

    await owner.locator('[role=progressbar][aria-valuenow="33"]').waitFor()
    await owner.getByLabel('New milestone').fill('First paying customer')
    await owner.getByRole('button', { name: /Add/ }).click()
    await owner.getByTestId('milestone').filter({ hasText: 'First paying customer' }).waitFor()
    await owner.locator('[role=progressbar][aria-valuenow="25"]').waitFor()
    await sam.reload()
    await sam.getByTestId('milestone').filter({ hasText: 'First paying customer' }).getByLabel('Not reached yet').waitFor()
    await sam.locator('[role=progressbar][aria-valuenow="25"]').waitFor()
    await sam.getByRole('button', { name: 'Ask for help' }).waitFor()
    ok('the owner adds a milestone; Sam sees it, progress becomes 25% (1 of 2 things in the stage done), and Sam can ask for help again')

    await owner.getByTestId('milestone').filter({ hasText: 'First paying customer' }).getByRole('button', { name: /^First paying customer/ }).click()
    await owner.getByTestId('milestone').getByText('Reached').waitFor()
    await owner.locator('[role=progressbar][aria-valuenow="33"]').waitFor()
    await snap(owner, 'owner-person-milestones')
    await sam.reload()
    await sam.getByTestId('milestone').filter({ hasText: 'First paying customer' }).getByLabel('Reached').waitFor()
    await sam.locator('[role=progressbar][aria-valuenow="33"]').waitFor()
    await snap(sam, 'participant-home-milestone')
    await lee.reload()
    assert.equal(await lee.getByTestId('milestone').count(), 0)
    ok("the owner ticks the milestone: progress returns to 33% for both; Lee sees none of Sam's milestones")

    // ---- Calendar and reminders ----
    section('7. Calendar and reminders, with the real back end')
    step = 0
    const localIso = (offset) => {
      const d = new Date()
      d.setDate(d.getDate() + offset)
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    }
    await nav(owner, 'Reminders').click()
    await owner.getByText('No reminders').waitFor()
    const addReminder = async (title, { date, repeat, person } = {}) => {
      await owner.getByRole('button', { name: 'New reminder' }).first().click()
      const d = owner.getByRole('dialog')
      await d.getByLabel('What should you remember?').fill(title)
      if (date) await d.getByLabel('When?').fill(date)
      if (repeat) await d.getByLabel('Repeat').selectOption({ label: repeat })
      if (person) await d.getByLabel(/About someone/).selectOption({ label: person })
      await d.getByRole('button', { name: 'Save reminder' }).click()
      await d.waitFor({ state: 'detached' })
      await owner.getByTestId('reminder').filter({ hasText: title }).waitFor()
    }
    await addReminder('Call Sam about prices', { person: 'Sam Baker' })
    await addReminder('Weekly check-in', { repeat: 'Every week' })
    await addReminder('Book the workshop room', { date: localIso(3) })
    await owner.getByTestId('reminder').filter({ hasText: 'Call Sam about prices' }).getByText('Sam Baker').waitFor()
    await nav(owner, 'Reminders').getByText('2').waitFor()
    await snap(owner, 'owner-reminders')
    ok('the owner adds three reminders (one about Sam, one weekly, one in 3 days); the menu shows 2 due today')

    await nav(owner, 'Dashboard').click()
    const dueCard = owner.locator('section').filter({ has: owner.getByRole('heading', { name: /Reminders for today/ }) })
    await dueCard.getByTestId('reminder').filter({ hasText: 'Call Sam about prices' }).waitFor()
    assert.equal(await dueCard.getByTestId('reminder').count(), 2)
    await dueCard.getByTestId('reminder').filter({ hasText: 'Call Sam about prices' }).getByRole('button', { name: 'Done' }).click()
    await dueCard.getByTestId('reminder').filter({ hasText: 'Call Sam about prices' }).waitFor({ state: 'detached' })
    await dueCard.getByTestId('reminder').filter({ hasText: 'Weekly check-in' }).getByRole('button', { name: 'Done, next one' }).click()
    await dueCard.getByText('Nothing to follow up today').waitFor()
    assert.equal(sql("select due_on - current_date from public.reminders where title = 'Weekly check-in'"), '7')
    assert.equal(sql("select count(*) from public.reminders where title = 'Call Sam about prices' and done_at is not null"), '1')
    ok('on the dashboard the owner ticks both off: the one-off is closed, the weekly one moves to a week later')

    await nav(owner, 'Calendar').click()
    await owner.getByRole('heading', { name: 'Calendar' }).waitFor()
    const openDay = async (page, iso) => {
      for (let i = 0; i < 2; i++) {
        const cell = page.locator(`[data-testid=calendar-day][data-date="${iso}"]`)
        if (await cell.count()) return cell.click()
        await page.getByRole('button', { name: 'Next month' }).click()
      }
      throw new Error(`day ${iso} not found`)
    }
    const taskDue = sql("select due_on from public.tasks limit 1")
    await openDay(owner, taskDue)
    await owner.getByTestId('day-task').filter({ hasText: 'Write a one-page plan' }).getByText('Sam Baker').waitFor()
    await owner.getByRole('button', { name: 'Today' }).click()
    await openDay(owner, localIso(3))
    await owner.getByTestId('day-items').getByTestId('reminder').filter({ hasText: 'Book the workshop room' }).waitFor()
    await owner.getByRole('button', { name: 'Today' }).click()
    await openDay(owner, localIso(7))
    await owner.getByTestId('day-items').getByTestId('reminder').filter({ hasText: 'Weekly check-in' }).waitFor()
    await owner.getByRole('button', { name: 'Reminder on this day' }).click()
    assert.equal(await owner.getByRole('dialog').getByLabel('When?').inputValue(), localIso(7))
    await owner.getByRole('dialog').getByRole('button', { name: 'Close' }).click()
    await owner.getByRole('button', { name: 'Today' }).click()
    await snap(owner, 'owner-calendar')
    ok("the owner's calendar shows Sam's task on its due date and the reminders on theirs; a new reminder starts on the chosen day")

    await nav(sam, 'Calendar').click()
    await sam.getByRole('heading', { name: 'Calendar' }).waitFor()
    await openDay(sam, taskDue)
    await sam.getByTestId('day-task').filter({ hasText: 'Write a one-page plan' }).waitFor()
    await sam.getByRole('button', { name: 'Today' }).click()
    await openDay(sam, localIso(3))
    await sam.getByText('Nothing on this day').waitFor()
    ok("Sam's calendar shows Sam's own task, and none of the owner's reminders")

    // ---- Everyone has reminders; deadlines remind by themselves ----
    await nav(owner, 'People').click()
    await owner.getByRole('link', { name: /Sam Baker/ }).click()
    await owner.getByRole('button', { name: 'Give a task' }).click()
    await owner.getByLabel('What should they do?').fill('Price list for group walks')
    await owner.getByLabel('Due in').selectOption({ label: '3 days' })
    await owner.getByRole('button', { name: 'Give this task' }).click()
    await owner.getByTestId('task-card').filter({ hasText: 'Price list for group walks' }).waitFor()
    await nav(sam, 'Home').click()
    await sam.reload()
    const samToday = sam.locator('section').filter({ has: sam.getByRole('heading', { name: /Reminders for today/ }) })
    await samToday.getByTestId('deadline').filter({ hasText: 'Price list for group walks' }).getByText(/Due /).waitFor()
    await nav(owner, 'Reminders').click()
    await owner.getByTestId('deadline').filter({ hasText: 'Price list for group walks' }).getByText('Sam Baker').waitFor()
    ok("a task due in 3 days shows up by itself as a reminder: on Sam's Home page, and on the owner's Reminders page with Sam's name")

    await nav(sam, 'Reminders').click()
    await sam.getByTestId('deadline').filter({ hasText: 'Price list for group walks' }).waitFor()
    await sam.getByRole('button', { name: 'New reminder' }).click()
    const samDialog = sam.getByRole('dialog')
    assert.equal(await samDialog.getByLabel(/About someone/).count(), 0)
    await samDialog.getByLabel('What should you remember?').fill('Ask three shops about flyer prices')
    await samDialog.getByRole('button', { name: 'Save reminder' }).click()
    await sam.getByTestId('reminder').filter({ hasText: 'Ask three shops' }).waitFor()
    await nav(sam, 'Reminders').getByText('1').waitFor()
    await snap(sam, 'participant-reminders')
    await owner.reload()
    await owner.getByTestId('deadline').filter({ hasText: 'Price list for group walks' }).waitFor()
    assert.equal(await owner.getByText('Ask three shops').count(), 0)
    ok('Sam adds a reminder of their own (with no way to attach it to a person); the menu shows 1 due; the owner cannot see it')

    await nav(sam, 'Calendar').click()
    await sam.getByTestId('day-items').getByTestId('reminder').filter({ hasText: 'Ask three shops' }).waitFor()
    await snap(sam, 'participant-calendar')
    await sam.getByTestId('day-items').getByTestId('reminder').filter({ hasText: 'Ask three shops' }).getByRole('button', { name: 'Done' }).click()
    await sam.getByText('Nothing on this day').waitFor()
    await nav(sam, 'Tasks').click()
    const groupTask = sam.getByTestId('task-card').filter({ hasText: 'Price list for group walks' })
    await groupTask.getByRole('button', { name: 'Start this task' }).click()
    await groupTask.getByLabel('Your work').fill('Groups of 3: 10 euros each.')
    await groupTask.getByRole('button', { name: 'Hand in' }).click()
    await groupTask.getByText('Waiting for the owner').waitFor()
    await nav(sam, 'Reminders').click()
    await sam.getByText(/No deadlines in the next/).waitFor()
    await owner.reload()
    await owner.getByText(/No deadlines in the next/).waitFor()
    sql("delete from public.tasks where title = 'Price list for group walks'")
    ok('Sam ticks the reminder off on the calendar; after Sam hands the work in, the deadline reminder disappears for both')

    // ---- Phone app and notifications ----
    section('8. Phone app and notifications, with the real back end')
    step = 0
    const manifest = await (await fetch(`${SITE}/manifest.webmanifest`)).json()
    assert.equal(manifest.name, 'VentureTrack')
    assert.equal(manifest.display, 'standalone')
    for (const icon of manifest.icons) {
      const res = await fetch(SITE + icon.src)
      assert.equal(res.status, 200)
      assert.equal(res.headers.get('content-type'), 'image/png')
    }
    assert.match(await (await fetch(`${SITE}/sw.js`)).text(), /showNotification/)
    const swUrl = await owner.evaluate(async () => (await navigator.serviceWorker.ready).active?.scriptURL)
    assert.ok(swUrl.endsWith('/sw.js'))
    ok('the app can be installed: app file, icons and background helper are served, and the helper is running')

    // As if each person had tapped "Allow" when the browser asked about notifications.
    await ownerCtx.grantPermissions(['notifications'], { origin: SITE })
    await samCtx.grantPermissions(['notifications'], { origin: SITE })
    await nav(owner, 'My account').click()
    const phoneCard = owner.locator('section').filter({ has: owner.getByRole('heading', { name: 'Phone app and notifications' }) })
    await phoneCard.getByRole('button', { name: 'Turn on notifications' }).waitFor()
    await snap(owner, 'owner-phone-app')
    await nav(sam, 'Home').click()
    await sam.getByTestId('phone-prompt').getByRole('link', { name: 'Set it up' }).click()
    await sam.getByRole('heading', { name: 'Phone app and notifications' }).waitFor()
    await snap(sam, 'participant-phone-app')
    ok('the profile page explains how to install the app and offers to turn on notifications; Home links to it')

    // Each person's "phone": a fake device pointing at the stand-in push service.
    const ownerDevice = fakeDevice()
    const samDevice = fakeDevice()
    const signedOwner = (await signInApi('owner', OWNER_PASSWORD)).data.access_token
    const signedSam = (await signInApi('sam.b', SAM_NEW_PASSWORD)).data.access_token
    const subscribe = (token, device, path) => api('/rest/v1/rpc/save_push_subscription', {
      method: 'POST', token,
      body: { p_endpoint: `${pushOrigin}/${path}`, p_p256dh: device.p256dh, p_auth: device.authB64, p_time_zone: 'Europe/Riga', p_device: 'Test phone' },
    })
    assert.ok((await subscribe(signedOwner, ownerDevice, 'owner')).ok)
    assert.ok((await subscribe(signedSam, samDevice, 'sam')).ok)
    await owner.reload()
    await owner.getByTestId('device-count').getByText('1 device').waitFor()

    /** Wait for the next push to `path`, check its signature, and decrypt it. */
    const nextPush = async (path, device, after) => {
      for (let i = 0; i < 80; i++) {
        const hit = pushService.received.find((r, index) => index >= after && r.path === `/${path}`)
        if (hit) {
          assert.equal(hit.headers['content-encoding'], 'aes128gcm')
          verifyVapid(hit.headers.authorization, pushOrigin, VAPID_PUBLIC)
          return decrypt(device, hit.body)
        }
        await sleep(250)
      }
      throw new Error(`no notification arrived at /${path}`)
    }
    const mark = () => pushService.received.length

    let from = mark()
    await nav(owner, 'Messages').click()
    await owner.getByRole('link', { name: /Sam Baker/ }).click()
    await owner.getByLabel('Write a message').fill('Can we talk tomorrow at 10?')
    await owner.getByRole('button', { name: 'Send message' }).click()
    let note = await nextPush('sam', samDevice, from)
    assert.equal(note.title, 'Message from Administrator')
    assert.equal(note.body, 'Can we talk tomorrow at 10?')
    assert.equal(note.url, `/app/messages/${sql("select id from public.profiles where role = 'admin'")}`)
    ok('a message from the owner reaches Sam\'s phone within seconds: signed by VentureTrack, readable only by Sam\'s device, and opening the conversation')

    from = mark()
    await nav(owner, 'People').click()
    await owner.getByRole('link', { name: /Sam Baker/ }).click()
    await owner.getByRole('button', { name: 'Give a task' }).click()
    await owner.getByLabel('What should they do?').fill('Ask two vets for a quote')
    await owner.getByRole('button', { name: 'Give this task' }).click()
    note = await nextPush('sam', samDevice, from)
    assert.deepEqual([note.title, note.body, note.url], ['New task', 'Ask two vets for a quote', '/app/tasks'])

    from = mark()
    const pushTaskId = sql("select id from public.tasks where title = 'Ask two vets for a quote'")
    await api('/rest/v1/rpc/start_task', { method: 'POST', token: signedSam, body: { p_task_id: pushTaskId } })
    await api('/rest/v1/rpc/submit_task', { method: 'POST', token: signedSam, body: { p_task_id: pushTaskId, p_body: 'Both said 40 euros.' } })
    note = await nextPush('owner', ownerDevice, from)
    assert.deepEqual([note.title, note.body], ['Sam Baker handed in work', 'Ask two vets for a quote'])

    from = mark()
    await api('/rest/v1/rpc/review_task', { method: 'POST', token: signedOwner, body: { p_task_id: pushTaskId, p_approve: true } })
    note = await nextPush('sam', samDevice, from)
    assert.equal(note.title, 'Your work was approved')
    sql(`delete from public.tasks where id = '${pushTaskId}'`)
    ok('tasks and feedback notify the right person: Sam hears about a new task and the approval, the owner hears that work was handed in')

    from = mark()
    await api('/rest/v1/help_requests', { method: 'POST', token: signedSam, body: { body: 'Is 40 euros a fair price?' } })
    note = await nextPush('owner', ownerDevice, from)
    assert.deepEqual([note.title, note.body], ['Sam Baker asked for help', 'Is 40 euros a fair price?'])
    sql("update public.help_requests set resolved_at = now(), resolved_by = (select id from public.profiles where role = 'admin') where resolved_at is null")

    from = mark()
    await api('/rest/v1/rpc/create_poll', { method: 'POST', token: signedOwner, body: { p_question: 'Pizza or soup on Friday?', p_options: ['Pizza', 'Soup'], p_allow_multiple: false } })
    note = await nextPush('sam', samDevice, from)
    assert.deepEqual([note.title, note.body, note.url], ['New poll', 'Pizza or soup on Friday?', '/app/polls'])
    sql("delete from public.polls where question = 'Pizza or soup on Friday?'")
    ok('help requests reach the owner, and new polls reach the participants')

    from = mark()
    await api('/rest/v1/reminders', { method: 'POST', token: signedSam, body: { title: 'Call the printer', due_on: localIso(0) } })
    sql('delete from private.push_digests; select private.queue_digests(true);')
    note = await nextPush('sam', samDevice, from)
    assert.equal(note.title, 'Your day in VentureTrack')
    assert.match(note.body, /1 reminder/)
    assert.equal(note.url, '/app/reminders')
    sql("delete from public.reminders where title = 'Call the printer'")
    ok("the morning summary tells Sam about today's reminder and opens the Reminders page")

    from = mark()
    assert.ok((await api('/rest/v1/rpc/push_test', { method: 'POST', token: signedSam, body: {} })).ok)
    note = await nextPush('sam', samDevice, from)
    assert.equal(note.title, 'Notifications are on')
    assert.ok((await subscribe(signedOwner, fakeDevice(), 'gone')).ok)
    from = mark()
    await api('/rest/v1/rpc/send_message', { method: 'POST', token: signedSam, body: { p_to: sql("select id from public.profiles where role = 'admin'"), p_body: 'See you at 10.' } })
    await nextPush('owner', ownerDevice, from)
    for (let i = 0; i < 40 && sql(`select count(*) from public.push_subscriptions where endpoint = '${pushOrigin}/gone'`) !== '0'; i++) await sleep(250)
    assert.equal(sql(`select count(*) from public.push_subscriptions where endpoint = '${pushOrigin}/gone'`), '0')
    ok('"Send me a test" works, and a device the push service no longer knows is forgotten automatically')

    // What a phone shows: hand the background helper a push, the way the phone's push service does.
    // (The full Chromium build is used here: the stripped-down one never displays notifications.)
    const fullBrowser = await chromium.launch({ channel: 'chromium' })
    const phone = await (await fullBrowser.newContext({ permissions: ['notifications'] })).newPage()
    await phone.goto(SITE)
    await phone.evaluate(async () => (await navigator.serviceWorker.ready).active?.state)
    const cdp = await phone.context().newCDPSession(phone)
    const registrations = []
    cdp.on('ServiceWorker.workerRegistrationUpdated', (e) => registrations.push(...e.registrations))
    await cdp.send('ServiceWorker.enable')
    for (let i = 0; i < 40 && !registrations.length; i++) await sleep(100)
    await cdp.send('ServiceWorker.deliverPushMessage', {
      origin: SITE + '/',
      registrationId: registrations[0].registrationId,
      data: JSON.stringify({ title: 'Message from Sam Baker', body: 'See you at 10.', url: '/admin/messages' }),
    })
    let shown = []
    for (let i = 0; i < 40 && !shown.length; i++) {
      shown = await phone.evaluate(async () => (await (await navigator.serviceWorker.ready).getNotifications()).map((n) => [n.title, n.body]))
      if (!shown.length) await sleep(100)
    }
    await fullBrowser.close()
    assert.deepEqual(shown[0], ['Message from Sam Baker', 'See you at 10.'])
    ok('when a push arrives, the app shows it as a notification with its title and text')
    sql("delete from public.messages where body in ('Can we talk tomorrow at 10?', 'See you at 10.')")

    // ---- Security: try every door, straight at the back end ----
    section('9. Security (talking to the back end directly, skipping the screens)')
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


    // ---- Tasks, files and messages ----
    const leeToken = (await signInApi('lee.p', LEE_PASSWORD)).data.access_token
    const leeId = sql("select id from public.profiles where username = 'lee.p'")
    const taskId = sql("select id from public.tasks limit 1")
    const samFile = sql("select storage_path from public.task_attachments order by file_name limit 1")

    for (const table of ['tasks', 'task_submissions', 'task_attachments']) {
      assert.deepEqual((await api(`/rest/v1/${table}?select=id`, { token: leeToken })).data, [])
      assert.ok(!(await api(`/rest/v1/${table}?select=id`)).ok)
    }
    ok("Lee can read none of Sam's tasks, handed-in work or file records; a visitor is refused outright")

    const download = (token) => fetch(`${API}/storage/v1/object/authenticated/submissions/${samFile}`, { headers: { apikey: ANON, Authorization: `Bearer ${token}` } })
    assert.equal((await download(samToken)).status, 200)
    assert.equal((await download(ownerToken)).status, 200)
    assert.ok((await download(leeToken)).status >= 400)
    assert.ok((await download(ANON)).status >= 400)
    assert.ok((await fetch(`${API}/storage/v1/object/public/submissions/${samFile}`)).status >= 400)
    const leeSign = await api(`/storage/v1/object/sign/submissions/${samFile}`, { method: 'POST', token: leeToken, body: { expiresIn: 60 } })
    assert.ok(!leeSign.ok)
    ok("Sam's files open for Sam and the owner only: not for Lee, not for visitors, and there is no public address")

    const upload = (token, path) => fetch(`${API}/storage/v1/object/submissions/${path}`, {
      method: 'POST', headers: { apikey: ANON, Authorization: `Bearer ${token}`, 'Content-Type': 'text/plain' }, body: 'planted',
    })
    assert.ok((await upload(leeToken, `${samId}/${taskId}/planted.txt`)).status >= 400)
    assert.ok((await upload(ANON, `${leeId}/x/planted.txt`)).status >= 400)
    const overwrite = await fetch(`${API}/storage/v1/object/submissions/${samFile}`, {
      method: 'PUT', headers: { apikey: ANON, Authorization: `Bearer ${samToken}`, 'Content-Type': 'text/plain' }, body: 'swapped',
    })
    assert.ok(overwrite.status >= 400)
    const removal = await api('/storage/v1/object/submissions', { method: 'DELETE', token: samToken, body: { prefixes: [samFile] } })
    assert.equal((await download(ownerToken)).status, 200, `a handed-in file must survive a delete attempt (${removal.status})`)
    ok("nobody can put files into someone else's folder, and a handed-in file cannot be swapped or deleted")

    const rpcCall = (name, token, body) => api(`/rest/v1/rpc/${name}`, { method: 'POST', token, body })
    assert.ok(!(await rpcCall('review_task', samToken, { p_task_id: taskId, p_approve: true })).ok)
    assert.ok(!(await api(`/rest/v1/tasks?id=eq.${taskId}`, { method: 'PATCH', token: samToken, body: { status: 'not_started' } })).ok)
    assert.ok(!(await api('/rest/v1/tasks', { method: 'POST', token: samToken, body: { participant_id: samId, title: 'Self-made' } })).ok)
    assert.ok(!(await api(`/rest/v1/tasks?id=eq.${taskId}`, { method: 'PATCH', token: ownerToken, body: { status: 'not_started' } })).ok)
    assert.ok(!(await rpcCall('submit_task', leeToken, { p_task_id: taskId, p_body: 'mine' })).ok)
    assert.equal(sql('select count(*) from public.tasks'), '1')
    assert.equal(sql(`select status from public.tasks where id = '${taskId}'`), 'completed')
    ok('Sam cannot approve, create or change tasks; Lee cannot hand in for Sam; even the owner cannot set a status by hand')

    const ownerMessages = (await api('/rest/v1/messages?select=body', { token: ownerToken })).data.map((m) => m.body)
    assert.ok(ownerMessages.includes('Thank you!') && !ownerMessages.some((b) => /flyers|Yes please/.test(b)))
    const leeMessages = (await api('/rest/v1/messages?select=body', { token: leeToken })).data.map((m) => m.body)
    assert.deepEqual(leeMessages.sort(), ['Hi Lee, want to swap flyers?', 'Yes please!'])
    assert.ok(!(await api('/rest/v1/messages?select=body')).ok)
    ok('messages are readable only by the two people in them: the owner cannot read Sam and Lee, Lee cannot read Sam and the owner')

    const forged = await api('/rest/v1/messages', { method: 'POST', token: leeToken, body: { sender_id: ownerId, recipient_id: samId, body: 'forged' } })
    assert.ok(!forged.ok)
    assert.ok(!(await api('/rest/v1/messages?sender_id=eq.' + samId, { method: 'PATCH', token: leeToken, body: { body: 'edited' } })).ok)
    assert.ok(!(await api('/rest/v1/messages?sender_id=eq.' + leeId, { method: 'DELETE', token: leeToken })).ok)
    assert.equal(sql("select count(*) from public.messages where body in ('forged', 'edited')"), '0')
    assert.equal(sql('select count(*) from public.messages'), '4')
    ok('a message cannot be forged in someone else\'s name, edited or deleted')

    const directory = (await rpcCall('directory', leeToken, {})).data
    assert.deepEqual(Object.keys(directory[0]).sort(), ['full_name', 'id', 'is_owner'])
    assert.ok(!(await rpcCall('directory', ANON, {})).ok)
    ok('participants can see each other\'s names and nothing else (no e-mail, no username)')

    // ---- Money and shared spreadsheets ----
    assert.deepEqual((await api('/rest/v1/finance_entries?select=id', { token: leeToken })).data, [])
    assert.equal((await api('/rest/v1/finance_entries?select=id', { token: samToken })).data.length, 2)
    assert.ok(!(await api('/rest/v1/finance_entries?select=id')).ok)
    await api('/rest/v1/finance_entries?money_in=gte.0', { method: 'PATCH', token: leeToken, body: { money_in: 1 } })
    await api('/rest/v1/finance_entries?money_in=gte.0', { method: 'PATCH', token: ownerToken, body: { money_in: 1 } })
    await api('/rest/v1/finance_entries?money_in=gte.0', { method: 'DELETE', token: leeToken })
    assert.ok(!(await api('/rest/v1/finance_entries', { method: 'POST', token: leeToken, body: { participant_id: samId, month: '2026-03-01', money_in: 5 } })).ok)
    assert.equal(sql('select sum(money_in) || \'/\' || count(*) from public.finance_entries'), '1300.00/2')
    ok("Sam's money numbers: Lee cannot read, change, delete or add to them; the owner can read but not change them")

    const hiddenFile = sql("select storage_path from public.shared_files where status = 'rejected' limit 1")
    const openFile = sql("select storage_path from public.shared_files where status = 'approved' limit 1")
    const getShared = (path, token) => fetch(`${API}/storage/v1/object/authenticated/shared/${path}`, { headers: { apikey: ANON, Authorization: `Bearer ${token}` } })
    assert.equal((await getShared(openFile, leeToken)).status, 200)
    assert.ok((await getShared(openFile, ANON)).status >= 400)
    assert.equal((await getShared(hiddenFile, samToken)).status, 200)
    assert.equal((await getShared(hiddenFile, ownerToken)).status, 200)
    assert.ok((await getShared(hiddenFile, leeToken)).status >= 400)
    assert.deepEqual((await api('/rest/v1/shared_files?select=title', { token: leeToken })).data.map((f) => f.title), ['budget-template'])
    ok('a file that is not approved opens only for its uploader and the owner; an approved one opens for members but not for visitors')

    const putShared = (token, path, type) => fetch(`${API}/storage/v1/object/shared/${path}`, {
      method: 'POST', headers: { apikey: ANON, Authorization: `Bearer ${token}`, 'Content-Type': type }, body: 'x',
    })
    assert.ok((await putShared(leeToken, `${leeId}/virus.exe`, 'application/octet-stream')).status >= 400)
    assert.ok((await putShared(leeToken, `${leeId}/page.html`, 'text/html')).status >= 400)
    assert.ok((await putShared(leeToken, `${leeId}/fake.xlsx`, 'text/html')).status >= 400)
    assert.ok((await putShared(leeToken, `${samId}/planted.csv`, 'text/csv')).status >= 400)
    assert.equal((await putShared(leeToken, `${leeId}/mine.csv`, 'text/csv')).status, 200)
    const hiddenId = sql("select id from public.shared_files where status = 'rejected' limit 1")
    assert.ok(!(await rpcCall('review_shared_file', leeToken, { p_id: hiddenId, p_approve: true })).ok)
    assert.ok(!(await rpcCall('review_shared_file', samToken, { p_id: hiddenId, p_approve: true })).ok)
    assert.ok(!(await api(`/rest/v1/shared_files?id=eq.${hiddenId}`, { method: 'PATCH', token: samToken, body: { status: 'approved' } })).ok)
    assert.ok(!(await rpcCall('share_file', leeToken, { p_path: hiddenFile, p_title: 'Mine now', p_file_name: 'x.xlsx' })).ok)
    assert.equal(sql(`select status from public.shared_files where id = '${hiddenId}'`), 'rejected')
    ok('only spreadsheets can be uploaded, only into your own folder, and nobody but the owner can approve a file')

    // ---- Polls ----
    const pollId = sql("select id from public.polls limit 1")
    const optionOf = (label) => sql(`select id from public.poll_options where label = '${label}'`)
    sql(`select 1 from public.polls; update public.polls set closed_at = null where id = '${pollId}'`)
    for (const token of [ownerToken, samToken, leeToken]) {
      const theirs = (await api('/rest/v1/poll_votes?select=voter_id', { token })).data
      assert.ok(theirs.every((v) => v.voter_id !== samId) || token === samToken, 'nobody but Sam can read Sam\'s vote')
    }
    assert.equal((await api('/rest/v1/poll_votes?select=voter_id', { token: ownerToken })).data.length, 0)
    ok('votes are anonymous: not even the owner can read who voted for what')

    assert.ok(!(await api('/rest/v1/poll_votes', { method: 'POST', token: leeToken, body: { poll_id: pollId, option_id: optionOf('Monday'), voter_id: samId } })).ok)
    assert.ok(!(await rpcCall('cast_vote', leeToken, { p_poll_id: pollId, p_option_ids: [optionOf('Monday'), optionOf('Tuesday')] })).ok)
    assert.ok(!(await rpcCall('create_poll', samToken, { p_question: 'Mine', p_options: ['a', 'b'], p_allow_multiple: false })).ok)
    assert.ok(!(await rpcCall('close_poll', samToken, { p_poll_id: pollId })).ok)
    await api(`/rest/v1/polls?id=eq.${pollId}`, { method: 'DELETE', token: samToken })
    assert.ok(!(await api('/rest/v1/polls?select=id')).ok)
    assert.equal(sql(`select count(*) from public.polls where id = '${pollId}'`), '1')
    assert.equal(sql(`select count(*) from public.poll_votes where poll_id = '${pollId}'`), '2')
    ok('nobody can vote in someone else\'s name or pick two on a one-choice poll; participants cannot create, close or delete polls; visitors see nothing')

    // ---- Reminders ----
    assert.deepEqual((await api('/rest/v1/reminders?select=title', { token: samToken })).data.filter((r) => !/Ask three shops/.test(r.title)), [])
    assert.ok(!(await api('/rest/v1/reminders?select=id')).ok)
    assert.ok(!(await api('/rest/v1/reminders', { method: 'POST', token: samToken, body: { title: 'About me', due_on: '2026-12-01', participant_id: samId } })).ok)
    await api('/rest/v1/reminders', { method: 'POST', token: samToken, body: { title: 'Planted', due_on: '2026-12-01', owner_id: ownerId } })
    assert.equal(sql(`select count(*) from public.reminders where title = 'Planted' and owner_id = '${ownerId}'`), '0')
    assert.deepEqual((await api('/rest/v1/reminders?select=title', { token: ownerToken })).data.filter((r) => /Ask three shops/.test(r.title)), [])
    const reminderId = sql("select id from public.reminders where title = 'Book the workshop room'")
    assert.ok(!(await rpcCall('complete_reminder', samToken, { p_id: reminderId })).ok)
    await api(`/rest/v1/reminders?id=eq.${reminderId}`, { method: 'DELETE', token: samToken })
    assert.equal(sql(`select count(*) from public.reminders where id = '${reminderId}' and done_at is null`), '1')
    ok("each person's reminders are private: Sam sees none of the owner's, the owner none of Sam's; Sam cannot attach one to a person, plant one on the owner, or tick off or delete the owner's")

    // ---- Phone notifications ----
    assert.deepEqual((await api('/rest/v1/push_subscriptions?select=endpoint', { token: samToken })).data.map((d) => d.endpoint), [`${pushOrigin}/sam`])
    await api(`/rest/v1/push_subscriptions?endpoint=eq.${encodeURIComponent(pushOrigin + '/owner')}`, { method: 'DELETE', token: samToken })
    assert.equal(sql(`select count(*) from public.push_subscriptions where endpoint = '${pushOrigin}/owner'`), '1')
    assert.ok(!(await rpcCall('push_claim_batch', samToken, { p_limit: 10 })).ok)
    assert.ok(!(await rpcCall('push_claim_batch', ANON, { p_limit: 10 })).ok)
    assert.ok(!(await rpcCall('save_push_subscription', ANON, { p_endpoint: 'https://evil.example/x', p_p256dh: samDevice.p256dh, p_auth: samDevice.authB64, p_time_zone: 'UTC' })).ok)
    assert.equal((await api('/functions/v1/send-push', { method: 'POST', body: {} })).status, 401)
    assert.equal((await api('/functions/v1/send-push', { method: 'POST', body: {}, headers: { 'x-push-secret': 'guess' } })).status, 401)
    ok("nobody can see or remove someone else's devices, read the notification queue, or make the server send notifications")

    // ---- Removing people ----
    section('10. Blocking and deleting, with the real back end')
    step = 0
    const leeBefore = sql(`select count(*) from storage.objects where name like '${leeId}/%'`)
    assert.ok(Number(leeBefore) >= 1, 'Lee should have at least one stored file before deletion')

    await nav(owner, 'People').click()
    await owner.getByRole('link', { name: /Sam Baker/ }).click()
    await owner.getByRole('button', { name: 'Block sign-in' }).click()
    await owner.getByRole('status').getByText('Blocked').waitFor()
    await owner.getByText('Blocked since').waitFor()
    assert.equal(await owner.getByRole('link', { name: 'Message', exact: true }).count(), 0)
    assert.equal((await signInApi('sam.b', SAM_NEW_PASSWORD)).status, 401)
    assert.ok(!(await rpcCall('send_message', samToken, { p_to: ownerId, p_body: 'still here?' })).ok)
    assert.ok(!(await rpcCall('send_message', ownerToken, { p_to: samId, p_body: 'hello?' })).ok)
    await sam.getByRole('button', { name: 'Sign out' }).click()
    await sam.getByLabel('Username').fill('sam.b')
    await sam.getByLabel('Password', { exact: true }).fill(SAM_NEW_PASSWORD)
    await sam.getByRole('button', { name: 'Sign in' }).click()
    await sam.getByRole('alert').getByText('do not match').waitFor()
    await snap(owner, 'owner-person-blocked')
    ok('the owner blocks Sam: Sam cannot sign in, cannot send with an old session, and nobody can message Sam')

    await owner.getByRole('button', { name: 'Unblock' }).click()
    await owner.getByRole('status').getByText('Unblocked').waitFor()
    sql('delete from private.sign_in_attempts;')
    assert.equal((await signInApi('sam.b', SAM_NEW_PASSWORD)).status, 200)
    assert.equal(sql('select count(*) from public.tasks'), '1')
    ok("the owner unblocks Sam: Sam can sign in again and nothing of Sam's was lost")

    await nav(owner, 'People').click()
    await owner.getByRole('link', { name: /Lee Park/ }).click()
    await owner.getByRole('button', { name: 'Delete for good' }).click()
    const confirmBox = owner.getByLabel(/To confirm, type their full name/)
    await confirmBox.fill('Lee')
    assert.equal(await owner.getByRole('button', { name: 'Delete Lee for good' }).isDisabled(), true)
    await confirmBox.fill('Lee Park')
    await owner.getByRole('button', { name: 'Delete Lee for good' }).click()
    await owner.getByRole('heading', { name: 'People' }).waitFor()
    await owner.getByRole('link', { name: /Sam Baker/ }).waitFor()
    assert.equal(await owner.getByRole('link', { name: /Lee Park/ }).count(), 0)
    ok('deleting needs the full name typed in; then Lee is gone from the People list')

    assert.equal(sql(`select count(*) from auth.users where id = '${leeId}'`), '0')
    assert.equal(sql(`select count(*) from public.profiles where id = '${leeId}'`), '0')
    assert.equal(sql(`select count(*) from public.messages where sender_id = '${leeId}' or recipient_id = '${leeId}'`), '0')
    assert.equal(sql(`select count(*) from public.poll_votes where voter_id = '${leeId}'`), '0')
    assert.equal(sql(`select count(*) from storage.objects where name like '${leeId}/%'`), '0')
    assert.equal((await signInApi('lee.p', LEE_PASSWORD)).status, 401)
    assert.ok(!(await api('/rest/v1/profiles?select=id', { token: leeToken })).data?.length)
    ok("Lee's account, messages, votes and stored files are erased, and Lee cannot sign in")

    for (const action of ['block', 'delete']) {
      const res = await api('/functions/v1/manage-account', { method: 'POST', token: samToken, body: { action, profile_id: ownerId } })
      assert.equal(res.status, 403)
    }
    assert.equal((await api('/functions/v1/manage-account', { method: 'POST', token: ownerToken, body: { action: 'delete', profile_id: ownerId } })).status, 404)
    assert.equal(sql(`select count(*) from auth.users where id = '${ownerId}'`), '1')
    ok("a participant cannot block or delete anyone, and nobody can block or delete the owner's account")

    await nav(owner, 'People').click()
    const leeAgain = await inviteAndGetLink('Lee Park', 'lee@example.com')
    assert.match(leeAgain, /verify/)
    ok('the same e-mail address can be invited again after deletion')

    const bundle = execFileSync('sh', ['-c', 'cat dist/assets/*.js'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
    assert.ok(!bundle.includes(SERVICE) && !bundle.includes('service_role'))
    ok('the secret server key is not inside the app that browsers download')
  } finally {
    await browser.close()
    // Stop the preview server and the process it started.
    try { process.kill(-server.pid) } catch {}
    pushService.server.close()
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
