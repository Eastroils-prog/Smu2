// Packs the sample version into ONE file (dist-single/venturetrack-demo.html)
// that can be shared as a single page. Usage: npm run build:single
import { readFileSync, writeFileSync } from 'node:fs'

const html = readFileSync('dist-single/index.html', 'utf8')
const head = html.match(/<head>([\s\S]*?)<\/head>/)[1]
const body = html.match(/<body>([\s\S]*?)<\/body>/)[1]
// The host page supplies its own charset and viewport tags, so drop ours.
const cleanHead = head.replace(/<meta charset[^>]*>\s*/i, '').replace(/<meta name="viewport"[^>]*>\s*/i, '')
// Put the title first so it is found quickly, then the rest.
const title = cleanHead.match(/<title>[\s\S]*?<\/title>/)[0]
writeFileSync('dist-single/venturetrack-demo.html', `${title}\n${cleanHead.replace(title, '').trim()}\n${body.trim()}\n`)
console.log('Wrote dist-single/venturetrack-demo.html')
