// Prepares phone notifications on the LOCAL Supabase stack (safe to run again):
//   * supabase/functions/.env   practice keys for the send-push function (git-ignored)
//   * .env.production.local     the public key the local build uses (git-ignored)
//   * Vault in the local database: where send-push lives and the shared secret
// Usage: node scripts/local-push-setup.mjs   (then restart `supabase functions serve`)
import { createECDH, randomBytes } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

const DB = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
const b64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const ENV = 'supabase/functions/.env'

let env = existsSync(ENV) ? readFileSync(ENV, 'utf8') : ''
const read = (name) => env.match(new RegExp(`^${name}=(.*)$`, 'm'))?.[1]
if (!read('VAPID_PUBLIC_KEY')) {
  const ecdh = createECDH('prime256v1')
  ecdh.generateKeys()
  env += `VAPID_PUBLIC_KEY=${b64url(ecdh.getPublicKey())}\nVAPID_PRIVATE_KEY=${b64url(ecdh.getPrivateKey())}\nVAPID_SUBJECT=https://venturetrack.local\n`
}
if (!read('PUSH_SECRET')) env += `PUSH_SECRET=${b64url(randomBytes(32))}\n`
writeFileSync(ENV, env)

const publicKey = read('VAPID_PUBLIC_KEY')
const local = '.env.production.local'
let prod = existsSync(local) ? readFileSync(local, 'utf8') : ''
prod = prod.replace(/^VITE_VAPID_PUBLIC_KEY=.*\n?/m, '') + `VITE_VAPID_PUBLIC_KEY=${publicKey}\n`
writeFileSync(local, prod)

const sql = (q) => execFileSync('psql', [DB, '-v', 'ON_ERROR_STOP=1', '-Atc', q], { encoding: 'utf8' })
const setSecret = (name, value) =>
  sql(`select vault.update_secret(id, '${value}') from vault.secrets where name = '${name}';
       select vault.create_secret('${value}', '${name}') where not exists (select 1 from vault.secrets where name = '${name}');`)
// The database reaches the functions through the stack's own network.
setSecret('push_function_url', 'http://supabase_kong_Smu2:8000/functions/v1/send-push')
setSecret('push_secret', read('PUSH_SECRET'))
console.log('Local push ready. Public key:', publicKey)
