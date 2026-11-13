import { useNavigate } from 'react-router-dom'
import { Briefcase, Sprout, UserRound } from 'lucide-react'
import type { Role } from '../../lib/data'
import { useStore } from '../../lib/store'

export function SignIn() {
  const { signIn } = useStore()
  const navigate = useNavigate()

  const enter = (role: Role) => {
    signIn(role)
    navigate(role === 'admin' ? '/admin' : '/app')
  }

  return (
    <div className="gutter flex min-h-full items-center justify-center py-10">
      <div className="flex w-full max-w-md flex-col gap-6">
        <div className="flex items-center gap-3">
          <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-accent text-on-accent">
            <Sprout size={26} />
          </span>
          <div>
            <h1 className="text-3xl font-bold tracking-tight">VentureTrack</h1>
            <p className="text-muted">Guide people from idea to launch.</p>
          </div>
        </div>

        <div className="rounded-2xl border border-line bg-surface p-5">
          <h2 className="text-lg font-semibold">Choose who to be</h2>
          <p className="mt-1 text-sm text-muted">
            This is a sample version, so there is no password yet. Pick a side to look around. You can switch at any time.
          </p>
          <div className="mt-4 flex flex-col gap-3">
            <RoleButton
              onClick={() => enter('admin')}
              icon={<Briefcase size={22} />}
              title="Enter as the owner"
              text="See all your people, chat, give tasks and check work."
            />
            <RoleButton
              onClick={() => enter('participant')}
              icon={<UserRound size={22} />}
              title="Enter as a participant"
              text="See what Maya, one of your people, would see."
            />
          </div>
        </div>

        <p className="rounded-xl bg-warn-soft px-4 py-3 text-sm text-warn">
          <strong>Sample version.</strong> Everyone here is made up. Nothing you type is saved, and it resets when you reload the page.
        </p>
      </div>
    </div>
  )
}

function RoleButton(props: { onClick: () => void; icon: React.ReactNode; title: string; text: string }) {
  return (
    <button
      onClick={props.onClick}
      className="flex items-center gap-4 rounded-xl border border-line bg-surface p-4 text-left transition-colors hover:border-accent hover:bg-accent-soft"
    >
      <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent-strong">
        {props.icon}
      </span>
      <span className="min-w-0">
        <span className="block font-semibold">{props.title}</span>
        <span className="block text-sm text-muted">{props.text}</span>
      </span>
    </button>
  )
}
