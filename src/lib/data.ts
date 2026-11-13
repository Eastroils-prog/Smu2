// SAMPLE DATA for the click-through demo. Every person here is made up.
// In the real app this file is replaced by the database.

export type Role = 'admin' | 'participant'
export type TaskStatus = 'not_started' | 'in_progress' | 'submitted' | 'needs_revision' | 'completed'
export type Priority = 'low' | 'medium' | 'high'

export interface Stage {
  name: string
  description: string
}

export interface Person {
  id: string
  name: string
  email: string
  joined: string
  idea: string
  goals: string
  stage: number
  status: 'invited' | 'active' | 'completed'
  lastActive: string
  helpRequest?: string
}

/** A file or picture attached to handed-in work. */
export interface Attachment {
  id: string
  name: string
  size: number
  isImage: boolean
  /** Lets the browser show the picture. Only present for images. */
  url?: string
}

export interface Task {
  id: string
  personId: string
  title: string
  description: string
  stage: number
  due: string
  priority: Priority
  status: TaskStatus
  submission?: string
  attachments?: Attachment[]
  feedback?: string
}

export interface Milestone {
  id: string
  personId: string
  stage: number
  title: string
  achieved: boolean
}

/** A message between two people. `from` and `to` are person ids, or OWNER_ID for the owner. */
export interface Message {
  id: string
  from: string
  to: string
  body: string
  at: string
  read: boolean
}

export interface Note {
  id: string
  personId: string
  body: string
  at: string
}

export interface DemoState {
  people: Person[]
  tasks: Task[]
  milestones: Milestone[]
  messages: Message[]
  notes: Note[]
}

export const STAGES: Stage[] = [
  { name: 'Business idea', description: 'Define the problem, the customer and the core idea.' },
  { name: 'Market research', description: 'Understand the market, competitors and demand.' },
  { name: 'Business planning', description: 'Business model, finances and a written plan.' },
  { name: 'Product development', description: 'Build the first version of the product or service.' },
  { name: 'Marketing and validation', description: 'Test with real customers and refine the offer.' },
  { name: 'Launch preparation', description: 'Legal, operational and go-to-market readiness.' },
]

/** The id that stands for the owner in messages. */
export const OWNER_ID = 'admin'

/** Sign-in details for the sample version. They are shown on the sign-in page; they protect nothing. */
export const DEMO_ACCOUNTS: { username: string; password: string; role: Role; label: string }[] = [
  { username: 'owner', password: 'demo1234', role: 'admin', label: 'The owner' },
  { username: 'maya', password: 'demo1234', role: 'participant', label: 'Maya, a participant' },
]

/** The participant you become when you choose "participant" on the sign-in page. */
export const DEMO_PARTICIPANT_ID = 'p1'

let counter = 0
export const newId = () => `x${Date.now().toString(36)}${counter++}`

/** A moment `days` days from now (negative = in the past), so the demo never looks stale. */
export function daysFromNow(days: number, hour = 10, minute = 0): string {
  const d = new Date()
  d.setDate(d.getDate() + days)
  d.setHours(hour, minute, 0, 0)
  return d.toISOString()
}

export function seed(): DemoState {
  const people: Person[] = [
    {
      id: 'p1',
      name: 'Maya Lindqvist',
      email: 'maya@example.com',
      joined: daysFromNow(-64),
      idea: 'A weekly sourdough bread subscription for my neighbourhood, delivered by bike.',
      goals: 'Sign up 40 households and rent a shared kitchen by spring.',
      stage: 2,
      status: 'active',
      lastActive: daysFromNow(0, 9, 12),
    },
    {
      id: 'p2',
      name: 'Tomás Rivera',
      email: 'tomas@example.com',
      joined: daysFromNow(-58),
      idea: 'A bike repair van that comes to your office car park.',
      goals: 'Get three office buildings to book a monthly visit.',
      stage: 1,
      status: 'active',
      lastActive: daysFromNow(-9, 16, 40),
    },
    {
      id: 'p3',
      name: 'Aiko Tanaka',
      email: 'aiko@example.com',
      joined: daysFromNow(-80),
      idea: 'Short maths lessons on video chat for kids aged 9 to 12.',
      goals: 'Run a paid trial with 10 families.',
      stage: 3,
      status: 'active',
      lastActive: daysFromNow(-1, 18, 5),
    },
    {
      id: 'p4',
      name: 'Daniel Okafor',
      email: 'daniel@example.com',
      joined: daysFromNow(-12),
      idea: 'Turning old office furniture into desks for home workers.',
      goals: 'Work out who would buy this and at what price.',
      stage: 0,
      status: 'active',
      lastActive: daysFromNow(-2, 11, 30),
      helpRequest: 'I am stuck on who my customer is. Can we talk this week?',
    },
    {
      id: 'p5',
      name: 'Leila Haddad',
      email: 'leila@example.com',
      joined: daysFromNow(-120),
      idea: 'Ready-to-heat meal boxes for older people who live alone.',
      goals: 'Reach 25 weekly customers before launch.',
      stage: 4,
      status: 'active',
      lastActive: daysFromNow(0, 8, 3),
    },
    {
      id: 'p6',
      name: 'Jonas Berg',
      email: 'jonas@example.com',
      joined: daysFromNow(-1),
      idea: '',
      goals: '',
      stage: 0,
      status: 'invited',
      lastActive: daysFromNow(-1),
    },
  ]

  const tasks: Task[] = [
    // Maya — stage 2 (Business planning)
    {
      id: 't1', personId: 'p1', stage: 2, priority: 'high', status: 'submitted', due: daysFromNow(1),
      title: 'Write a one-page business plan',
      description: 'One page only: who buys, what they pay, what it costs you, and how you reach them.',
      submission: 'Here is my one-pager. 40 households at €24 a month covers the kitchen rent and flour with about €310 left over. I reach people with flyers and the street group chat.',
    },
    {
      id: 't2', personId: 'p1', stage: 2, priority: 'medium', status: 'completed', due: daysFromNow(-10),
      title: 'List your monthly costs',
      description: 'Every cost you can think of, even small ones.',
      submission: 'Kitchen rent €380, flour and ingredients €210, bags and labels €45, bike upkeep €15.',
      feedback: 'Clear and complete. Good work.',
    },
    {
      id: 't3', personId: 'p1', stage: 2, priority: 'medium', status: 'in_progress', due: daysFromNow(3),
      title: 'Set your prices',
      description: 'Pick a price for one loaf a week and two loaves a week. Say why.',
    },
    {
      id: 't4', personId: 'p1', stage: 1, priority: 'medium', status: 'completed', due: daysFromNow(-30),
      title: 'Talk to 5 possible customers',
      description: 'Ask what bread they buy now and what annoys them about it.',
      submission: 'Spoke to 7 neighbours. 5 said they would pay for delivery.',
      feedback: 'Great, seven is more than I asked for.',
    },
    // Tomás — stage 1, has gone quiet with late work
    {
      id: 't5', personId: 'p2', stage: 1, priority: 'high', status: 'in_progress', due: daysFromNow(-4),
      title: 'Find 3 competitors and their prices',
      description: 'Who else fixes bikes near offices? What do they charge?',
    },
    {
      id: 't6', personId: 'p2', stage: 1, priority: 'low', status: 'not_started', due: daysFromNow(6),
      title: 'Count the bikes at two office buildings',
      description: 'Visit at 9am and count the bikes in the racks.',
    },
    // Aiko — stage 3
    {
      id: 't7', personId: 'p3', stage: 3, priority: 'high', status: 'needs_revision', due: daysFromNow(2),
      title: 'Record your first sample lesson',
      description: 'Ten minutes, one topic. Send the link.',
      submission: 'Link to my fractions lesson is in the message thread.',
      feedback: 'Good energy. The sound cuts out after minute 6, please record that part again.',
    },
    {
      id: 't8', personId: 'p3', stage: 3, priority: 'medium', status: 'completed', due: daysFromNow(-8),
      title: 'Choose your video tool',
      description: 'Compare two tools and pick one.',
      submission: 'Picked the one that lets parents join without an account.',
      feedback: 'Sensible choice.',
    },
    // Daniel — stage 0
    {
      id: 't9', personId: 'p4', stage: 0, priority: 'medium', status: 'not_started', due: daysFromNow(5),
      title: 'Describe your customer in three sentences',
      description: 'Who are they, what do they need, and why would they pick you?',
    },
    // Leila — stage 4
    {
      id: 't10', personId: 'p5', stage: 4, priority: 'high', status: 'submitted', due: daysFromNow(4),
      title: 'Run a two-week paid trial',
      description: 'At least 8 paying customers. Report what they said.',
      submission: '11 customers paid for two weeks. 9 want to continue. Most asked for smaller portions.',
    },
    {
      id: 't11', personId: 'p5', stage: 4, priority: 'medium', status: 'completed', due: daysFromNow(-14),
      title: 'Design the menu card',
      description: 'One page, large print.',
      submission: 'Menu card attached, printed at 16pt.',
      feedback: 'Easy to read. Approved.',
    },
  ]

  const milestones: Milestone[] = [
    { id: 'm1', personId: 'p1', stage: 2, title: 'First budget finished', achieved: true },
    { id: 'm2', personId: 'p1', stage: 2, title: 'Business model agreed', achieved: false },
    { id: 'm3', personId: 'p2', stage: 1, title: 'Competitor list finished', achieved: false },
    { id: 'm4', personId: 'p3', stage: 3, title: 'First lesson ready to show', achieved: false },
    { id: 'm5', personId: 'p4', stage: 0, title: 'Customer clearly described', achieved: false },
    { id: 'm6', personId: 'p5', stage: 4, title: 'First paying customers', achieved: true },
    { id: 'm7', personId: 'p5', stage: 4, title: 'Offer adjusted after feedback', achieved: false },
  ]

  const messages: Message[] = [
    { id: 'c1', from: 'admin', to: 'p1', read: true, at: daysFromNow(-2, 14, 10), body: 'Hi Maya, how is the one-page plan going?' },
    { id: 'c2', from: 'p1', to: 'admin', read: true, at: daysFromNow(-2, 15, 2), body: 'Nearly done. I am not sure about the delivery cost though.' },
    { id: 'c3', from: 'admin', to: 'p1', read: true, at: daysFromNow(-2, 15, 20), body: 'Count your own time too. Even €5 an hour makes the numbers more honest.' },
    { id: 'c4', from: 'p1', to: 'admin', read: false, at: daysFromNow(0, 9, 12), body: 'I handed in the plan this morning. Could you take a look?' },
    { id: 'c5', from: 'admin', to: 'p2', read: false, at: daysFromNow(-6, 10, 0), body: 'Hi Tomás, the competitor list was due. Do you need a hand?' },
    { id: 'c6', from: 'p3', to: 'admin', read: false, at: daysFromNow(-1, 18, 5), body: 'I will record the lesson again on Thursday. Is the weekend OK as a new deadline?' },
    { id: 'c7', from: 'admin', to: 'p4', read: true, at: daysFromNow(-11, 9, 30), body: 'Welcome, Daniel! Start with the first task when you are ready.' },
    { id: 'c8', from: 'p5', to: 'admin', read: true, at: daysFromNow(-3, 12, 45), body: 'Trial is running. Eleven customers so far!' },
    { id: 'c9', from: 'admin', to: 'p5', read: true, at: daysFromNow(-3, 13, 15), body: 'That is brilliant. Ask each of them one question: what would make you cancel?' },
    // Participants can also talk to each other.
    { id: 'c10', from: 'p5', to: 'p1', read: true, at: daysFromNow(-5, 17, 20), body: 'Hi Maya! How did you find your shared kitchen? I am looking for one too.' },
    { id: 'c11', from: 'p1', to: 'p5', read: true, at: daysFromNow(-5, 18, 2), body: 'Through the community centre. I can send you the contact.' },
    { id: 'c12', from: 'p3', to: 'p1', read: false, at: daysFromNow(-1, 20, 15), body: 'Would your bread customers like a flyer for my maths lessons? Happy to swap!' },
  ]

  const notes: Note[] = [
    { id: 'n1', personId: 'p1', at: daysFromNow(-20), body: 'Very organised. Tends to underprice. Push on prices.' },
    { id: 'n2', personId: 'p2', at: daysFromNow(-7), body: 'Started a new job, may have less time. Check in by phone.' },
  ]

  return { people, tasks, milestones, messages, notes }
}

// ---------- Calculations ----------

/** Verified progress, 0 to 1. Only work the owner has checked counts. */
export function progressOf(state: DemoState, personId: string): number {
  const person = state.people.find((p) => p.id === personId)
  if (!person) return 0
  if (person.status === 'completed') return 1
  return (person.stage + stageShare(state, personId, person.stage)) / STAGES.length
}

/** How much of one stage has been checked and approved, 0 to 1. */
export function stageShare(state: DemoState, personId: string, stage: number): number {
  const tasks = state.tasks.filter((t) => t.personId === personId && t.stage === stage)
  const miles = state.milestones.filter((m) => m.personId === personId && m.stage === stage)
  const total = tasks.length + miles.length
  if (total === 0) return 0
  const done = tasks.filter((t) => t.status === 'completed').length + miles.filter((m) => m.achieved).length
  return done / total
}

export const isOverdue = (t: Task) =>
  t.status !== 'completed' && t.status !== 'submitted' && new Date(t.due).getTime() < startOfToday()

function startOfToday() {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

export function daysSince(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)
}

/** The conversation between two people, oldest first. */
export function threadBetween(state: DemoState, a: string, b: string): Message[] {
  return state.messages.filter((m) => (m.from === a && m.to === b) || (m.from === b && m.to === a))
}

/** How many messages `other` sent to `me` that `me` has not opened yet. */
export function unreadFrom(state: DemoState, me: string, other: string): number {
  return state.messages.filter((m) => m.to === me && m.from === other && !m.read).length
}

/** All unopened messages waiting for `me`. */
export function unreadTotal(state: DemoState, me: string): number {
  return state.messages.filter((m) => m.to === me && !m.read).length
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export interface Attention {
  label: string
  tone: 'warn' | 'danger' | 'info'
}

/** Why the owner should look at this person. Empty list = all good. */
export function attentionFor(state: DemoState, person: Person): Attention[] {
  if (person.status !== 'active') return []
  const out: Attention[] = []
  if (person.helpRequest) out.push({ label: 'Asked for help', tone: 'danger' })
  const late = state.tasks.filter((t) => t.personId === person.id && isOverdue(t)).length
  if (late) out.push({ label: late === 1 ? '1 late task' : `${late} late tasks`, tone: 'danger' })
  const quiet = daysSince(person.lastActive)
  if (quiet >= 7) out.push({ label: `Quiet for ${quiet} days`, tone: 'warn' })
  const toCheck = state.tasks.filter((t) => t.personId === person.id && t.status === 'submitted').length
  if (toCheck) out.push({ label: 'Work to check', tone: 'info' })
  if (unreadFrom(state, OWNER_ID, person.id)) out.push({ label: 'Unread message', tone: 'info' })
  return out
}

// ---------- Words ----------

export const STATUS_LABEL: Record<TaskStatus, string> = {
  not_started: 'Not started',
  in_progress: 'In progress',
  submitted: 'Handed in',
  needs_revision: 'Needs changes',
  completed: 'Approved',
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}

export function formatDue(iso: string): string {
  const days = Math.round((new Date(iso).setHours(0, 0, 0, 0) - startOfToday()) / 86_400_000)
  if (days === 0) return 'Due today'
  if (days === 1) return 'Due tomorrow'
  if (days > 1) return `Due in ${days} days`
  if (days === -1) return 'Due yesterday'
  return `${-days} days late`
}

export function formatWhen(iso: string): string {
  const d = new Date(iso)
  const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  const days = Math.round((startOfToday() - new Date(iso).setHours(0, 0, 0, 0)) / 86_400_000)
  if (days <= 0) return `Today ${time}`
  if (days === 1) return `Yesterday ${time}`
  return `${formatDate(iso)} ${time}`
}

export const initials = (name: string) =>
  name
    .split(' ')
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase()
