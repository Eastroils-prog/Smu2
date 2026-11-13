import type { ReactNode } from 'react'
import { NavLink, Navigate, Outlet, useNavigate } from 'react-router-dom'
import {
  ArrowLeftRight, CheckSquare, LayoutDashboard, LogOut, MessageCircle, Sprout, TrendingUp, User, Users,
} from 'lucide-react'
import { unreadCount, type Role } from '../lib/data'
import { useStore } from '../lib/store'

interface NavItem {
  to: string
  label: string
  icon: ReactNode
  end?: boolean
  badge?: number
}

/** The frame around every signed-in page: side menu on big screens, bottom tabs on phones. */
export function Shell({ forRole }: { forRole: Role }) {
  const { role, state, meId, signIn, signOut } = useStore()
  const navigate = useNavigate()

  if (role === null) return <Navigate to="/" replace />
  if (role !== forRole) return <Navigate to={role === 'admin' ? '/admin' : '/app'} replace />

  const me = state.people.find((p) => p.id === meId)
  const adminUnread = state.people.reduce((n, p) => n + unreadCount(state, p.id, 'admin'), 0)
  const toCheck = state.tasks.filter((t) => t.status === 'submitted').length

  const items: NavItem[] =
    forRole === 'admin'
      ? [
          { to: '/admin', label: 'Dashboard', icon: <LayoutDashboard size={19} />, end: true },
          { to: '/admin/people', label: 'People', icon: <Users size={19} /> },
          { to: '/admin/messages', label: 'Messages', icon: <MessageCircle size={19} />, badge: adminUnread },
          { to: '/admin/tasks', label: 'Tasks', icon: <CheckSquare size={19} />, badge: toCheck },
        ]
      : [
          { to: '/app', label: 'Home', icon: <LayoutDashboard size={19} />, end: true },
          { to: '/app/tasks', label: 'Tasks', icon: <CheckSquare size={19} /> },
          { to: '/app/messages', label: 'Messages', icon: <MessageCircle size={19} />, badge: unreadCount(state, meId, 'participant') },
          { to: '/app/progress', label: 'Progress', icon: <TrendingUp size={19} /> },
          { to: '/app/profile', label: 'Profile', icon: <User size={19} /> },
        ]

  const switchRole = () => {
    const next: Role = forRole === 'admin' ? 'participant' : 'admin'
    signIn(next)
    navigate(next === 'admin' ? '/admin' : '/app')
  }
  const leave = () => {
    signOut()
    navigate('/')
  }

  return (
    <div className="min-h-full">
      <div className="gutter border-b border-line bg-warn-soft py-2 text-warn">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-4 gap-y-1 text-sm">
          <p>
            <strong>Sample version.</strong> These people are made up and nothing is saved.
          </p>
          <button onClick={switchRole} className="inline-flex items-center gap-1.5 font-semibold underline underline-offset-2">
            <ArrowLeftRight size={14} />
            {forRole === 'admin' ? 'See it as a participant (Maya)' : 'See it as the owner'}
          </button>
        </div>
      </div>

      <div className="gutter">
        <div className="mx-auto grid max-w-6xl gap-6 py-5 md:grid-cols-[13rem_minmax(0,1fr)] md:py-8">
          <aside className="flex items-center justify-between gap-3 md:sticky md:top-8 md:flex-col md:items-stretch md:justify-start md:self-start">
            <div className="flex items-center gap-2 px-1">
              <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-accent text-on-accent">
                <Sprout size={20} />
              </span>
              <div className="leading-tight">
                <p className="font-display text-lg font-bold">VentureTrack</p>
                <p className="text-xs text-muted">{forRole === 'admin' ? 'Owner view' : me?.name}</p>
              </div>
            </div>

            <nav aria-label="Main" className="hidden flex-col gap-1 md:mt-4 md:flex">
              {items.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) =>
                    `flex items-center gap-3 rounded-xl px-3 py-2.5 font-medium ${
                      isActive ? 'bg-accent-soft text-accent-strong' : 'text-muted hover:bg-sunken hover:text-ink'
                    }`
                  }
                >
                  {item.icon}
                  <span className="flex-1">{item.label}</span>
                  {!!item.badge && <CountDot n={item.badge} />}
                </NavLink>
              ))}
            </nav>

            <button
              onClick={leave}
              className="flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium text-muted hover:bg-sunken hover:text-ink md:mt-4"
            >
              <LogOut size={17} />
              Sign out
            </button>
          </aside>

          <main className="flex min-w-0 flex-col gap-5 pb-24 md:pb-0">
            <Outlet />
          </main>
        </div>
      </div>

      <nav aria-label="Main" className="tabbar fixed inset-x-0 bottom-0 z-20 border-t border-line bg-surface md:hidden">
        <div className="gutter flex justify-around">
          {items.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `relative flex min-w-0 flex-1 flex-col items-center gap-0.5 py-2.5 text-[11px] font-medium ${
                  isActive ? 'text-accent-strong' : 'text-muted'
                }`
              }
            >
              <span className="relative">
                {item.icon}
                {!!item.badge && (
                  <span className="absolute -top-1.5 -right-2.5">
                    <CountDot n={item.badge} />
                  </span>
                )}
              </span>
              {item.label}
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  )
}

function CountDot({ n }: { n: number }) {
  return (
    <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-accent px-1.5 text-[11px] font-semibold text-on-accent tabular-nums">
      {n}
    </span>
  )
}
