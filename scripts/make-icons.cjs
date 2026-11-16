// Draws the app icons from the sprout logo. Run: node scripts/make-icons.cjs
// (needs Playwright's Chromium). Output goes to public/icons/.
const { chromium } = require('playwright')
const fs = require('node:fs')

const SPROUT = `<path d="M14 9.536V7a4 4 0 0 1 4-4h1.5a.5.5 0 0 1 .5.5V5a4 4 0 0 1-4 4 4 4 0 0 0-4 4c0 2 1 3 1 5a5 5 0 0 1-1 3"/>
<path d="M4 9a5 5 0 0 1 8 4 5 5 0 0 1-8-4"/><path d="M5 21h14"/>`
const FOREST = '#0f2b1f'
const LIME = '#c4ef5b'

// glyph: share of the canvas the sprout takes; radius: corner rounding (0 = square, for "maskable").
const svg = ({ size, bg, fg, glyph, radius }) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  ${bg ? `<rect width="${size}" height="${size}" rx="${radius * size}" fill="${bg}"/>` : ''}
  <g transform="translate(${(size * (1 - glyph)) / 2} ${(size * (1 - glyph)) / 2}) scale(${(size * glyph) / 24})"
     fill="none" stroke="${fg}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${SPROUT}</g>
</svg>`

const ICONS = [
  { file: 'icon-192.png', size: 192, bg: LIME, fg: FOREST, glyph: 0.6, radius: 0.22 },
  { file: 'icon-512.png', size: 512, bg: LIME, fg: FOREST, glyph: 0.6, radius: 0.22 },
  { file: 'maskable-512.png', size: 512, bg: LIME, fg: FOREST, glyph: 0.46, radius: 0 },
  { file: 'apple-touch-icon.png', size: 180, bg: LIME, fg: FOREST, glyph: 0.58, radius: 0 },
  { file: 'badge-96.png', size: 96, bg: null, fg: '#ffffff', glyph: 0.84, radius: 0 },
]

;(async () => {
  const browser = await chromium.launch()
  const page = await browser.newPage()
  for (const icon of ICONS) {
    await page.setViewportSize({ width: icon.size, height: icon.size })
    await page.setContent(`<html><body style="margin:0;background:transparent">${svg(icon)}</body></html>`)
    await page.locator('svg').screenshot({ path: `public/icons/${icon.file}`, omitBackground: true })
  }
  fs.writeFileSync('public/icons/icon.svg', svg({ size: 512, bg: LIME, fg: FOREST, glyph: 0.6, radius: 0.22 }))
  await browser.close()
  console.log('Icons written to public/icons/')
})()
