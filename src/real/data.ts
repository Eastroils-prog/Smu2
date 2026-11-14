import { useQuery } from '@tanstack/react-query'
import { PROFILE_COLUMNS, supabase, type Profile, type Stage } from '../lib/supabase'
import type { TaskStatus } from '../lib/data'

// Everything here asks the database, which decides what each person may see.

export interface Task {
  id: string
  participant_id: string
  title: string
  description: string | null
  status: TaskStatus
  priority: 'low' | 'medium' | 'high'
  due_on: string | null
  stage_id: string | null
  created_at: string
}

export interface Attachment {
  id: string
  storage_path: string
  file_name: string
  size_bytes: number
  mime_type: string | null
}

export interface Submission {
  id: string
  task_id: string
  body: string | null
  decision: 'pending' | 'approved' | 'revision_requested'
  feedback: string | null
  submitted_at: string
  task_attachments: Attachment[]
}

export interface Message {
  id: string
  sender_id: string
  recipient_id: string
  body: string
  created_at: string
  read_at: string | null
}

export interface Contact {
  id: string
  full_name: string
  is_owner: boolean
}

export const FILE_LIMIT_BYTES = 10 * 1024 * 1024
export const FILE_LIMIT_COUNT = 5

async function unwrap<T>(query: PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<T> {
  const { data, error } = await query
  if (error) throw new Error(error.message)
  return data as T
}

export function useStages() {
  return useQuery({
    queryKey: ['stages'],
    staleTime: 5 * 60_000,
    queryFn: () =>
      unwrap<Stage[]>(supabase.from('stages').select('id, position, name, description').eq('is_archived', false).order('position')),
  })
}

/** Every participant (owner only; a participant gets nothing back). */
export function usePeople() {
  return useQuery({
    queryKey: ['people'],
    queryFn: () => unwrap<Profile[]>(supabase.from('profiles').select(PROFILE_COLUMNS).eq('role', 'participant').order('full_name')),
  })
}

/** The tasks this person may see: their own, or everyone's for the owner. */
export function useTasks() {
  return useQuery({
    queryKey: ['tasks'],
    queryFn: () =>
      unwrap<Task[]>(
        supabase
          .from('tasks')
          .select('id, participant_id, title, description, status, priority, due_on, stage_id, created_at')
          .order('due_on', { ascending: true, nullsFirst: false })
          .order('created_at'),
      ),
  })
}

export function useSubmissions() {
  return useQuery({
    queryKey: ['submissions'],
    queryFn: () =>
      unwrap<Submission[]>(
        supabase
          .from('task_submissions')
          .select('id, task_id, body, decision, feedback, submitted_at, task_attachments(id, storage_path, file_name, size_bytes, mime_type)')
          .order('submitted_at'),
      ),
  })
}

/** My messages, oldest first. Checked again every few seconds so new ones appear. */
export function useMessages() {
  return useQuery({
    queryKey: ['messages'],
    refetchInterval: 5000,
    queryFn: async () => {
      const newest = await unwrap<Message[]>(
        supabase
          .from('messages')
          .select('id, sender_id, recipient_id, body, created_at, read_at')
          .order('created_at', { ascending: false })
          .limit(1000),
      )
      return newest.reverse()
    },
  })
}

/** The people I may write to: names only. */
export function useDirectory() {
  return useQuery({
    queryKey: ['directory'],
    staleTime: 60_000,
    queryFn: () => unwrap<Contact[]>(supabase.rpc('directory')),
  })
}

/** A short-lived private link to one stored file. */
export function useSignedUrl(path: string) {
  return useQuery({
    queryKey: ['signed-url', path],
    staleTime: 50 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.storage.from('submissions').createSignedUrl(path, 3600)
      if (error) throw new Error(error.message)
      return data.signedUrl
    },
  })
}

// ---------- Calculations ----------

/**
 * Verified progress, 0 to 1: stages already passed, plus the approved share of
 * the tasks in the current stage. Only work the owner approved counts.
 */
export function progressOf(person: Pick<Profile, 'id' | 'current_stage_id' | 'status'>, tasks: Task[], stages: Stage[]): number {
  if (stages.length === 0) return 0
  if (person.status === 'completed') return 1
  const index = Math.max(0, stages.findIndex((s) => s.id === person.current_stage_id))
  const mine = tasks.filter((t) => t.participant_id === person.id && t.stage_id === person.current_stage_id)
  const share = mine.length ? mine.filter((t) => t.status === 'completed').length / mine.length : 0
  return (index + share) / stages.length
}

const today = () => new Date().toISOString().slice(0, 10)

export const isLate = (t: Task) =>
  !!t.due_on && t.due_on < today() && t.status !== 'completed' && t.status !== 'submitted'

export function dueLabel(dueOn: string | null): string {
  if (!dueOn) return 'No due date'
  const days = Math.round((Date.parse(`${dueOn}T00:00:00Z`) - Date.parse(`${today()}T00:00:00Z`)) / 86_400_000)
  if (days === 0) return 'Due today'
  if (days === 1) return 'Due tomorrow'
  if (days > 1) return `Due in ${days} days`
  if (days === -1) return 'Due yesterday'
  return `${-days} days late`
}

export function dateInDays(days: number): string {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

export const unreadFrom = (messages: Message[], me: string, other: string) =>
  messages.filter((m) => m.recipient_id === me && m.sender_id === other && !m.read_at).length

export const unreadTotal = (messages: Message[], me: string) =>
  messages.filter((m) => m.recipient_id === me && !m.read_at).length
