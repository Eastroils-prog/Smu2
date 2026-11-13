// Sets up a hosted Supabase project for VentureTrack, using only the Supabase
// Management API (HTTPS). Safe to run more than once.
//
//   SUPABASE_ACCESS_TOKEN=sbp_...  node scripts/setup-hosted.mjs [project-name-or-ref] [site-url]
//
// What it does:
//   1. finds the project
//   2. applies any migration in supabase/migrations/ that is not applied yet
//   3. turns off public sign-up and sets the password length
//   4. prints the two PUBLIC values the web app needs
// Edge Functions are deployed separately:  npx supabase functions deploy --use-api --project-ref <ref>
import { readFileSync, readdirSync } from 'node:fs'

const API = 'https://api.supabase.com/v1'
const token = process.env.SUPABASE_ACCESS_TOKEN
const wanted = process.argv[2] ?? 'venturetrack'
const siteUrl = process.argv[3]

async function call(path, { method = 'GET', body } = {}) {
  const res = await fetch(API + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await res.text()
  let data
  try { data = text ? JSON.parse(text) : null } catch { data = text }
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${typeof data === 'string' ? data : JSON.stringify(data)}`)
  return data
}

const projects = await call('/projects')
const project = projects.find((p) => p.id === wanted || p.name.toLowerCase() === wanted.toLowerCase())
if (!project) {
  console.error(`No project called "${wanted}". Found: ${projects.map((p) => p.name).join(', ') || '(none)'}`)
  process.exit(1)
}
const ref = project.id
console.log(`Project: ${project.name} (${ref}), region ${project.region}, status ${project.status}`)

const sql = (query) => call(`/projects/${ref}/database/query`, { method: 'POST', body: { query } })

// The same bookkeeping table the Supabase CLI uses, so both stay in step.
await sql(`
  create schema if not exists supabase_migrations;
  create table if not exists supabase_migrations.schema_migrations (
    version text primary key, statements text[], name text
  );`)
const applied = new Set((await sql('select version from supabase_migrations.schema_migrations')).map((r) => r.version))

for (const file of readdirSync('supabase/migrations').filter((f) => f.endsWith('.sql')).sort()) {
  const [version, ...rest] = file.replace(/\.sql$/, '').split('_')
  if (applied.has(version)) {
    console.log(`Migration ${file}: already applied`)
    continue
  }
  const body = readFileSync(`supabase/migrations/${file}`, 'utf8')
  // One transaction: either the whole migration lands, or none of it.
  await sql(`begin;\n${body}\ninsert into supabase_migrations.schema_migrations (version, name) values ('${version}', '${rest.join('_')}');\ncommit;`)
  console.log(`Migration ${file}: applied`)
}

// One-time links (invitations, password resets) stay valid for 24 hours.
const auth = { disable_signup: true, password_min_length: 10, mailer_otp_exp: 86400 }
if (siteUrl) Object.assign(auth, { site_url: siteUrl, uri_allow_list: siteUrl })
await call(`/projects/${ref}/config/auth`, { method: 'PATCH', body: auth })
console.log(`Auth: public sign-up off, passwords at least 10 characters, links valid 24 hours${siteUrl ? `, site ${siteUrl}` : ''}`)

const keys = await call(`/projects/${ref}/api-keys`)
const anon = keys.find((k) => k.name === 'anon') ?? keys.find((k) => k.type === 'publishable')
console.log('\nPublic values for the web app (.env.local):')
console.log(`VITE_SUPABASE_URL=https://${ref}.supabase.co`)
console.log(`VITE_SUPABASE_PUBLIC_KEY=${anon?.api_key ?? '(not found)'}`)
