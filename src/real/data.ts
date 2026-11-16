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

export interface FinanceEntry {
  id: string
  participant_id: string
  month: string
  money_in: number
  money_out: number
  note: string | null
}

export interface SharedFile {
  id: string
  uploader_id: string
  title: string
  file_name: string
  storage_path: string
  size_bytes: number
  status: 'pending' | 'approved' | 'rejected'
  review_note: string | null
  created_at: string
}

/** Money months this person may see: their own, or everyone's for the owner. Oldest first. */
export function useFinance() {
  return useQuery({
    queryKey: ['finance'],
    queryFn: async () => {
      const rows = await unwrap<FinanceEntry[]>(
        supabase.from('finance_entries').select('id, participant_id, month, money_in, money_out, note').order('month'),
      )
      // The database sends exact decimals as text; turn them into numbers once, here.
      return rows.map((r) => ({ ...r, money_in: Number(r.money_in), money_out: Number(r.money_out) }))
    },
  })
}

export function useSharedFiles() {
  return useQuery({
    queryKey: ['shared-files'],
    refetchInterval: 30_000,
    queryFn: () =>
      unwrap<SharedFile[]>(
        supabase
          .from('shared_files')
          .select('id, uploader_id, title, file_name, storage_path, size_bytes, status, review_note, created_at')
          .order('created_at', { ascending: false }),
      ),
  })
}

export const money = (amount: number) =>
  new Intl.NumberFormat(undefined, { style: 'currency', currency: 'EUR', maximumFractionDigits: amount % 1 === 0 ? 0 : 2 }).format(amount)

export function monthLabel(month: string, long = false): string {
  return new Date(`${month.slice(0, 7)}-01T12:00:00Z`).toLocaleDateString(undefined, {
    month: long ? 'long' : 'short',
    year: long ? 'numeric' : '2-digit',
    timeZone: 'UTC',
  })
}

/** A short-lived private link to one stored file. */
export function useSignedUrl(path: string, bucket: 'submissions' | 'shared' = 'submissions') {
  return useQuery({
    queryKey: ['signed-url', bucket, path],
    staleTime: 50 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, 3600)
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
export function progressOf(
  person: Pick<Profile, 'id' | 'current_stage_id' | 'status'>,
  tasks: Task[],
  stages: Stage[],
  milestones: Milestone[] = [],
): number {
  if (stages.length === 0) return 0
  if (person.status === 'completed') return 1
  const index = Math.max(0, stages.findIndex((s) => s.id === person.current_stage_id))
  const inStage = <T extends { participant_id: string; stage_id: string | null }>(list: T[]) =>
    list.filter((x) => x.participant_id === person.id && x.stage_id === person.current_stage_id)
  const myTasks = inStage(tasks)
  const myMilestones = inStage(milestones)
  const total = myTasks.length + myMilestones.length
  const done = myTasks.filter((t) => t.status === 'completed').length + myMilestones.filter((m) => m.achieved_at).length
  return (index + (total ? done / total : 0)) / stages.length
}

export interface Milestone {
  id: string
  participant_id: string
  stage_id: string | null
  title: string
  achieved_at: string | null
  created_at: string
}

export interface HelpRequest {
  id: string
  participant_id: string
  body: string
  created_at: string
  resolved_at: string | null
}

export function useMilestones() {
  return useQuery({
    queryKey: ['milestones'],
    queryFn: () =>
      unwrap<Milestone[]>(supabase.from('milestones').select('id, participant_id, stage_id, title, achieved_at, created_at').order('created_at')),
  })
}

export function useHelpRequests() {
  return useQuery({
    queryKey: ['help'],
    refetchInterval: 30_000,
    queryFn: () =>
      unwrap<HelpRequest[]>(
        supabase.from('help_requests').select('id, participant_id, body, created_at, resolved_at').order('created_at', { ascending: false }),
      ),
  })
}

export function useSettings() {
  return useQuery({
    queryKey: ['settings'],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const rows = await unwrap<{ inactivity_days: number }[]>(supabase.from('app_settings').select('inactivity_days'))
      return { inactivityDays: rows[0]?.inactivity_days ?? 7 }
    },
  })
}

export interface Reminder {
  id: string
  participant_id: string | null
  title: string
  note: string | null
  due_on: string
  repeats: 'none' | 'weekly' | 'monthly'
  done_at: string | null
}

/** The owner's reminders (a participant gets none back). Open ones, soonest first. */
export function useReminders(enabled = true) {
  return useQuery({
    queryKey: ['reminders'],
    enabled,
    queryFn: () =>
      unwrap<Reminder[]>(
        supabase.from('reminders').select('id, participant_id, title, note, due_on, repeats, done_at').is('done_at', null).order('due_on'),
      ),
  })
}

/** How many days ahead a task deadline starts showing up as a reminder. */
export const DEADLINE_WINDOW_DAYS = 3

/** Tasks still waiting for work whose deadline is late or within the window. Soonest first. */
export function upcomingDeadlines(tasks: Task[], today: string, withinDays = DEADLINE_WINDOW_DAYS): Task[] {
  const limit = new Date(`${today}T00:00:00Z`)
  limit.setUTCDate(limit.getUTCDate() + withinDays)
  const last = limit.toISOString().slice(0, 10)
  return tasks
    .filter((t) => t.due_on && t.due_on <= last && ['not_started', 'in_progress', 'needs_revision'].includes(t.status))
    .sort((a, b) => (a.due_on ?? '').localeCompare(b.due_on ?? ''))
}

/** Today's date as YYYY-MM-DD in the viewer's own time zone. */
export function localToday(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export const daysSince = (iso: string | null) => (iso ? Math.floor((Date.now() - Date.parse(iso)) / 86_400_000) : Infinity)

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
