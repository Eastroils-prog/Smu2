// Click-through check of the sample version.
// Run `npm run build:demo` first, then `npm run test:e2e`.
const { chromium } = require('playwright')
const { spawn } = require('node:child_process')
const assert = require('node:assert/strict')

const PORT = 4174
const URL = `http://localhost:${PORT}/`
const shots = process.env.SHOTS_DIR

async function main() {
  const server = spawn('npx', ['vite', 'preview', '--mode', 'demo', '--outDir', 'dist-demo', '--port', String(PORT), '--strictPort'], { stdio: 'ignore', detached: true })
  const browser = await chromium.launch()
  const problems = []
  let step = 0
  const ok = (label) => console.log(`  ok ${++step}. ${label}`)

  try {
    for (let i = 0; i < 40; i++) {
      try { if ((await fetch(URL)).ok) break } catch {}
      await new Promise((r) => setTimeout(r, 250))
    }

    for (const size of [{ name: 'phone', width: 390, height: 844 }, { name: 'desktop', width: 1280, height: 800 }]) {
      console.log(`\n${size.name} (${size.width}px)`)
      step = 0
      const page = await browser.newPage({ viewport: size })
      page.on('console', (m) => m.type() === 'error' && problems.push(`[${size.name}] console: ${m.text()}`))
      page.on('pageerror', (e) => problems.push(`[${size.name}] page error: ${e.message}`))
      const snap = async (name) => {
        const wide = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)
        if (wide) problems.push(`[${size.name}] "${name}" scrolls sideways`)
        if (shots) await page.screenshot({ path: `${shots}/${size.name}-${name}.png`, fullPage: true })
      }
      const nav = (label) => page.locator('nav:visible').getByRole('link', { name: label }).click()
      const percent = async () => Number(await page.getByRole('progressbar').first().getAttribute('aria-valuenow'))

      await page.goto(URL)
      await page.getByRole('heading', { name: 'VentureTrack' }).waitFor()
      await snap('sign-in')
      ok('sign-in page opens')

      // --- Owner ---
      await page.getByLabel('Username').fill('owner')
      await page.getByLabel('Password', { exact: true }).fill('wrong')
      await page.getByRole('button', { name: 'Sign in' }).click()
      await page.getByRole('alert').waitFor()
      ok('a wrong password is refused')
      await page.getByLabel('Password', { exact: true }).fill('demo1234')
      await page.getByRole('button', { name: 'Sign in' }).click()
      await page.getByRole('heading', { name: 'Dashboard' }).waitFor()
      await snap('owner-dashboard')
      ok('owner dashboard opens')

      await nav('People')
      await page.getByRole('link', { name: /Maya Lindqvist/ }).click()
      const before = await percent()
      assert.equal(before, 40)
      await snap('owner-person')
      ok(`Maya starts at ${before}% verified progress`)

      await nav('Tasks')
      await snap('owner-tasks')
      const plan = page.getByTestId('task-card').filter({ hasText: 'Write a one-page business plan' })
      await plan.getByLabel(/Your feedback/).fill('Clear plan. Approved!')
      await plan.getByRole('button', { name: 'Approve' }).click()
      await page.getByRole('button', { name: 'To check (1)' }).waitFor()
      ok('owner approves handed-in work')

      await page.getByRole('button', { name: 'Give a task' }).click()
      await page.getByLabel('What should they do?').fill('Design a flyer')
      await page.getByRole('button', { name: 'Give this task' }).click()
      await page.getByRole('button', { name: /^All \(12\)/ }).waitFor()
      ok('owner gives a new task')

      await nav('People')
      await page.getByLabel('Search people by name').fill('maya')
      assert.equal(await page.locator('main li').count(), 1)
      await page.getByRole('link', { name: /Maya Lindqvist/ }).click()
      const after = await percent()
      assert.ok(after > before, `progress should rise after approval (${before} -> ${after})`)
      ok(`search works, and progress rose to ${after}% after approval`)

      await page.getByRole('button', { name: /Business model agreed/ }).click()
      assert.ok((await percent()) > after)
      ok('ticking a milestone moves the bar')

      await page.getByRole('tab', { name: /Private notes/ }).click()
      await page.getByLabel('New private note').fill('Check prices next week.')
      await page.getByRole('button', { name: 'Save note' }).click()
      await page.getByText('Check prices next week.').waitFor()
      ok('private note is saved')

      await page.getByRole('tab', { name: /Messages/ }).click()
      await page.getByLabel('Write a message').fill('I approved your plan. Well done!')
      await page.getByRole('button', { name: 'Send message' }).click()
      await page.getByTestId('chat-thread').getByText('I approved your plan. Well done!').waitFor()
      await snap('owner-chat')
      ok('owner sends a message')

      await nav('People')
      await page.getByRole('button', { name: 'Invite a person' }).click()
      await page.getByLabel('Their name').fill('Sam Example')
      await page.getByLabel('Their e-mail').fill('sam@example.com')
      await page.getByRole('button', { name: 'Send invitation' }).click()
      await page.getByRole('link', { name: /Sam Example/ }).waitFor()
      ok('invited person appears in the list')

      await nav('Messages')
      await snap('owner-inbox')
      await page.getByRole('button', { name: /Aiko Tanaka/ }).click()
      await page.getByTestId('chat-thread').getByText(/record the lesson again/).waitFor()
      ok('owner inbox opens a conversation')

      // --- Participant ---
      await page.getByRole('button', { name: /See it as a participant/ }).click()
      await page.getByRole('heading', { name: 'Hello, Maya' }).waitFor()
      assert.ok((await percent()) > after)
      await snap('participant-home')
      ok('participant home shows the new progress')

      await nav('Messages')
      await snap('participant-inbox')
      await page.getByRole('button', { name: /Aiko Tanaka/ }).click()
      await page.getByTestId('chat-thread').getByText(/flyer for my maths lessons/).waitFor()
      await page.getByLabel('Write a message').fill('Yes, let us swap flyers!')
      await page.getByRole('button', { name: 'Send message' }).click()
      await page.getByTestId('chat-thread').getByText('Yes, let us swap flyers!').waitFor()
      await snap('participant-chat')
      ok('participant messages another participant')
      await page.getByRole('button', { name: 'All conversations' }).click()
      await page.getByRole('button', { name: /The owner/ }).click()
      await page.getByTestId('chat-thread').getByText('I approved your plan. Well done!').waitFor()
      await page.getByLabel('Write a message').fill('Thank you!')
      await page.getByRole('button', { name: 'Send message' }).click()
      await page.getByTestId('chat-thread').getByText('Thank you!').waitFor()
      ok('participant sees the owner message and replies')

      await nav('Tasks')
      await page.getByTestId('task-card').filter({ hasText: 'Design a flyer' }).getByRole('button', { name: 'Start this task' }).click()
      const prices = page.getByTestId('task-card').filter({ hasText: 'Set your prices' })
      await prices.getByLabel('Your work').fill('One loaf €24 a month, two loaves €42.')
      await prices.locator('input[type=file]').setInputFiles([
        { name: 'price-list.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64') },
        { name: 'costs.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 sample') },
      ])
      assert.equal(await prices.getByTestId('attachment').count(), 2)
      await prices.getByRole('button', { name: 'Remove costs.pdf' }).click()
      await prices.locator('input[type=file]').setInputFiles({ name: 'costs.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 sample') })
      await prices.getByRole('button', { name: 'Hand in' }).click()
      assert.equal(await prices.getByTestId('attachment').count(), 2)
      assert.equal(await prices.locator('img').count(), 1)
      await prices.getByText('Waiting for the owner').waitFor()
      assert.equal(await page.getByRole('button', { name: 'Approve' }).count(), 0)
      await snap('participant-tasks')
      ok('participant hands in work with a picture and a file, and has no Approve button')

      await nav('Progress')
      await page.getByText('You are here').waitFor()
      await snap('participant-progress')
      ok('progress page opens')

      await nav('Profile')
      await page.getByLabel('Your goals').fill('Sign up 50 households.')
      await page.getByRole('button', { name: 'Save changes' }).click()
      await page.getByRole('status').getByText('Saved').waitFor()
      ok('profile saves')

      await nav('Home')
      await page.getByRole('button', { name: 'Ask for help' }).click()
      await page.getByLabel('What do you need help with?').fill('How do I price delivery?')
      await page.getByRole('button', { name: 'Send request' }).click()
      await page.getByText('Help requested').waitFor()
      ok('help request is sent')

      // --- Back to the owner: did everything arrive? ---
      await page.getByRole('button', { name: /See it as the owner/ }).click()
      await page.getByRole('heading', { name: 'Dashboard' }).waitFor()
      await page.getByRole('link', { name: /Maya Lindqvist/ }).click()
      await page.getByText('How do I price delivery?').waitFor()
      await page.getByRole('button', { name: 'Mark as handled' }).click()
      await page.getByRole('tab', { name: /Tasks/ }).click()
      assert.equal(await page.getByTestId('task-card').filter({ hasText: 'Set your prices' }).getByTestId('attachment').count(), 2)
      await snap('owner-review-attachments')
      await nav('Messages')
      assert.equal(await page.getByText('Yes, let us swap flyers!').count(), 0)
      await page.getByRole('button', { name: /Aiko Tanaka/ }).click()
      assert.equal(await page.getByText('Yes, let us swap flyers!').count(), 0)
      await nav('People')
      await page.getByRole('link', { name: /Maya Lindqvist/ }).click()
      await page.getByRole('tab', { name: /Tasks/ }).click()
      await page.getByTestId('task-card').filter({ hasText: 'Set your prices' }).getByRole('button', { name: 'Ask for changes' }).click()
      await page.getByTestId('task-card').filter({ hasText: 'Set your prices' }).getByText('Needs changes').waitFor()
      ok('owner sees the help request and the attached files, cannot see the participants\' private chat, and asks for changes')

      await page.getByRole('button', { name: 'Sign out' }).click()
      await page.getByRole('heading', { name: 'Sign in' }).waitFor()
      ok('sign out returns to the sign-in page')
      await page.close()
    }
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
  console.error('\nFAILED:', e.message)
  process.exit(1)
})
