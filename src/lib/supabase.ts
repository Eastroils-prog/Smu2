import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
// The publishable ("anon") key is meant to be public. The locks are in the database.
const key = import.meta.env.VITE_SUPABASE_PUBLIC_KEY as string | undefined

export const isDemo = !url || !key

// Read the address bar before the Supabase client tidies it up: an e-mail link
// that has expired comes back with an error here.
const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''))
export const linkError: string | null = hash.get('error_code') ?? hash.get('error')

export const supabase: SupabaseClient = isDemo
  ? (null as unknown as SupabaseClient)
  : createClient(url!, key!, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } })

export const functionsUrl = `${url}/functions/v1`
export const publicKey = key ?? ''

export interface Profile {
  id: string
  role: 'admin' | 'participant'
  username: string | null
  email: string
  full_name: string
  business_idea: string | null
  current_goals: string | null
  current_stage_id: string | null
  status: 'invited' | 'active' | 'completed'
  joined_at: string | null
  archived_at: string | null
  last_active_at: string | null
}

export interface Stage {
  id: string
  position: number
  name: string
  description: string | null
}

export interface Invitation {
  id: string
  email: string
  full_name: string
  status: 'pending' | 'accepted' | 'revoked' | 'expired'
  expires_at: string
  created_at: string
}

export const PROFILE_COLUMNS =
  'id, role, username, email, full_name, business_idea, current_goals, current_stage_id, status, joined_at, archived_at, last_active_at'
