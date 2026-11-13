import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'
import {
  DEMO_PARTICIPANT_ID,
  STAGES,
  newId,
  seed,
  type DemoState,
  type Priority,
  type Role,
} from './data'

// The demo keeps everything in the browser's memory. Refreshing the page
// starts again from the sample data. The real app will save to the database.

interface NewTask {
  personId: string
  title: string
  description: string
  due: string
  priority: Priority
}

interface Store {
  state: DemoState
  role: Role | null
  /** The participant whose eyes we are looking through in participant view. */
  meId: string
  signIn: (role: Role) => void
  signOut: () => void
  sendMessage: (personId: string, from: Role, body: string) => void
  markRead: (personId: string, viewer: Role) => void
  createTask: (task: NewTask) => void
  startTask: (taskId: string) => void
  submitTask: (taskId: string, text: string) => void
  reviewTask: (taskId: string, approve: boolean, feedback: string) => void
  toggleMilestone: (milestoneId: string) => void
  advanceStage: (personId: string) => void
  addNote: (personId: string, body: string) => void
  invite: (name: string, email: string) => void
  updateProfile: (personId: string, patch: { name: string; idea: string; goals: string }) => void
  requestHelp: (personId: string, text: string) => void
  resolveHelp: (personId: string) => void
}

const Ctx = createContext<Store | null>(null)

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<DemoState>(seed)
  const [role, setRole] = useState<Role | null>(null)

  const store = useMemo<Store>(() => {
    const now = () => new Date().toISOString()
    const touch = (s: DemoState, personId: string): DemoState => ({
      ...s,
      people: s.people.map((p) => (p.id === personId ? { ...p, lastActive: now() } : p)),
    })

    return {
      state,
      role,
      meId: DEMO_PARTICIPANT_ID,
      signIn: setRole,
      signOut: () => setRole(null),

      sendMessage: (personId, from, body) =>
        setState((s) => {
          const next = {
            ...s,
            messages: [...s.messages, { id: newId(), personId, from, body, at: now(), read: false }],
          }
          return from === 'participant' ? touch(next, personId) : next
        }),

      markRead: (personId, viewer) =>
        setState((s) =>
          s.messages.some((m) => m.personId === personId && m.from !== viewer && !m.read)
            ? {
                ...s,
                messages: s.messages.map((m) =>
                  m.personId === personId && m.from !== viewer ? { ...m, read: true } : m,
                ),
              }
            : s,
        ),

      createTask: (task) =>
        setState((s) => {
          const person = s.people.find((p) => p.id === task.personId)
          return {
            ...s,
            tasks: [
              ...s.tasks,
              { ...task, id: newId(), stage: person?.stage ?? 0, status: 'not_started' as const },
            ],
          }
        }),

      startTask: (taskId) =>
        setState((s) => ({
          ...s,
          tasks: s.tasks.map((t) => (t.id === taskId ? { ...t, status: 'in_progress' as const } : t)),
        })),

      submitTask: (taskId, text) =>
        setState((s) => {
          const task = s.tasks.find((t) => t.id === taskId)
          const next = {
            ...s,
            tasks: s.tasks.map((t) =>
              t.id === taskId ? { ...t, status: 'submitted' as const, submission: text } : t,
            ),
          }
          return task ? touch(next, task.personId) : next
        }),

      reviewTask: (taskId, approve, feedback) =>
        setState((s) => ({
          ...s,
          tasks: s.tasks.map((t) =>
            t.id === taskId
              ? {
                  ...t,
                  status: approve ? ('completed' as const) : ('needs_revision' as const),
                  feedback: feedback || (approve ? 'Approved.' : 'Please take another look.'),
                }
              : t,
          ),
        })),

      toggleMilestone: (milestoneId) =>
        setState((s) => ({
          ...s,
          milestones: s.milestones.map((m) => (m.id === milestoneId ? { ...m, achieved: !m.achieved } : m)),
        })),

      advanceStage: (personId) =>
        setState((s) => ({
          ...s,
          people: s.people.map((p) => {
            if (p.id !== personId) return p
            return p.stage >= STAGES.length - 1
              ? { ...p, status: 'completed' as const }
              : { ...p, stage: p.stage + 1 }
          }),
        })),

      addNote: (personId, body) =>
        setState((s) => ({ ...s, notes: [{ id: newId(), personId, body, at: now() }, ...s.notes] })),

      invite: (name, email) =>
        setState((s) => ({
          ...s,
          people: [
            ...s.people,
            {
              id: newId(), name, email, joined: now(), idea: '', goals: '',
              stage: 0, status: 'invited' as const, lastActive: now(),
            },
          ],
        })),

      updateProfile: (personId, patch) =>
        setState((s) => ({
          ...s,
          people: s.people.map((p) => (p.id === personId ? { ...p, ...patch } : p)),
        })),

      requestHelp: (personId, text) =>
        setState((s) =>
          touch(
            { ...s, people: s.people.map((p) => (p.id === personId ? { ...p, helpRequest: text } : p)) },
            personId,
          ),
        ),

      resolveHelp: (personId) =>
        setState((s) => ({
          ...s,
          people: s.people.map((p) => (p.id === personId ? { ...p, helpRequest: undefined } : p)),
        })),
    }
  }, [state, role])

  return <Ctx.Provider value={store}>{children}</Ctx.Provider>
}

export function useStore(): Store {
  const store = useContext(Ctx)
  if (!store) throw new Error('useStore must be used inside StoreProvider')
  return store
}
