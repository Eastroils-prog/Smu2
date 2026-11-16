// Web Push, written with the browser-standard Web Crypto API only (no
// downloads). Two standards are involved:
//   RFC 8292 (VAPID): we sign a short token so the push service knows the
//                     message comes from us.
//   RFC 8291 (aes128gcm): the message is encrypted so that only the person's
//                     device can read it; the push service sees nothing.

const enc = new TextEncoder()

export function b64urlToBytes(text: string): Uint8Array {
  const base64 = text.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(text.length / 4) * 4, '=')
  return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))
}

export function bytesToB64url(bytes: Uint8Array): string {
  let text = ''
  for (const b of bytes) text += String.fromCharCode(b)
  return btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const p of parts) {
    out.set(p, at)
    at += p.length
  }
  return out
}

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, length: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, length * 8)
  return new Uint8Array(bits)
}

export interface VapidKeys {
  publicKey: string // 65-byte uncompressed P-256 point, base64url
  privateKey: string // 32-byte private scalar, base64url
  subject: string // https:// address (or mailto:) identifying the sender
}

async function vapidHeader(endpoint: string, keys: VapidKeys): Promise<string> {
  const pub = b64urlToBytes(keys.publicKey)
  const signingKey = await crypto.subtle.importKey(
    'jwk',
    { kty: 'EC', crv: 'P-256', d: keys.privateKey, x: bytesToB64url(pub.slice(1, 33)), y: bytesToB64url(pub.slice(33, 65)), ext: true },
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  )
  const header = bytesToB64url(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })))
  const claims = bytesToB64url(
    enc.encode(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: keys.subject })),
  )
  const signature = new Uint8Array(
    await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, signingKey, enc.encode(`${header}.${claims}`)),
  )
  return `vapid t=${header}.${claims}.${bytesToB64url(signature)}, k=${keys.publicKey}`
}

/** Encrypt `payload` for one device (RFC 8291). */
export async function encryptPayload(payload: Uint8Array, p256dh: string, authSecret: string): Promise<Uint8Array> {
  const uaPublic = b64urlToBytes(p256dh)
  const auth = b64urlToBytes(authSecret)
  const local = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', local.publicKey))
  const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, [])
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, local.privateKey, 256))

  const ikm = await hkdf(auth, shared, concat(enc.encode('WebPush: info\0'), uaPublic, asPublic), 32)
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16)
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12)

  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt'])
  // One record: the message, then the "last record" marker 0x02.
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, concat(payload, new Uint8Array([2]))))

  const recordSize = new Uint8Array(4)
  new DataView(recordSize.buffer).setUint32(0, 4096)
  return concat(salt, recordSize, new Uint8Array([asPublic.length]), asPublic, cipher)
}

export interface PushTarget {
  endpoint: string
  p256dh: string
  auth: string
}

/** Send one message to one device. Returns the push service's HTTP status (0 if it could not be reached). */
export async function sendPush(target: PushTarget, message: unknown, keys: VapidKeys): Promise<number> {
  const body = await encryptPayload(enc.encode(JSON.stringify(message)), target.p256dh, target.auth)
  try {
    const res = await fetch(target.endpoint, {
      method: 'POST',
      headers: {
        Authorization: await vapidHeader(target.endpoint, keys),
        'Content-Encoding': 'aes128gcm',
        'Content-Type': 'application/octet-stream',
        TTL: String(24 * 3600),
        Urgency: 'high',
      },
      body,
    })
    await res.body?.cancel()
    return res.status
  } catch (error) {
    console.error('push service unreachable', new URL(target.endpoint).host, String(error))
    return 0
  }
}
