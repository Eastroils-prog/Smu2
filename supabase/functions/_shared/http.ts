// Small helpers shared by the Edge Functions. No external imports on purpose:
// fewer moving parts, nothing to download at start-up.

export const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
export const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
// The service-role key never leaves the server. It is only read here.
export const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

export function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  })
}

export async function readBody(req: Request): Promise<Record<string, unknown>> {
  try {
    const body = await req.json()
    return body && typeof body === 'object' ? body : {}
  } catch {
    return {}
  }
}

export const asString = (v: unknown, max = 500): string => (typeof v === 'string' ? v.slice(0, max) : '')

interface RpcResult {
  ok: boolean
  status: number
  data: unknown
  /** The database's own error message, e.g. "too_many_attempts". */
  message: string
}

/** Call a database function. `authorization` decides whose permissions apply. */
export async function rpc(name: string, args: unknown, authorization: string): Promise<RpcResult> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, Authorization: authorization, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  })
  const text = await res.text()
  let data: unknown = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = text
  }
  const message = !res.ok && data && typeof data === 'object' ? String((data as { message?: unknown }).message ?? '') : ''
  return { ok: res.ok, status: res.status, data, message }
}

export const asService = `Bearer ${SERVICE_KEY}`
