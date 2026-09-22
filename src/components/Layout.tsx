import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '@/lib/auth'
import {
  Briefcase, FileText, Users, Calendar, DollarSign,
  ClipboardList, Settings, LogOut, Phone, BarChart2
} from 'lucide-react'

const nav = [
  { to: '/jobs',       label: 'Jobs',       icon: Briefcase },
  { to: '/invoices',   label: 'Invoices',   icon: FileText },
  { to: '/crew',       label: 'Crew',       icon: Users },
  { to: '/calendar',   label: 'Calendar',   icon: Calendar },
  { to: '/finance',    label: 'Finance',    icon: DollarSign },
  { to: '/enquiries',  label: 'Enquiries',  icon: Phone },
  { to: '/todos',      label: 'To‑do',      icon: ClipboardList },
  { to: '/reports',    label: 'Reports',    icon: BarChart2 },
  { to: '/settings',   label: 'Settings',   icon: Settings },
]

export default function Layout() {
  const { signOut } = useAuth()

  return (
    <div className="flex h-screen bg-gray-950 text-white overflow-hidden">
      {/* Sidebar */}
      <aside className="w-56 shrink-0 flex flex-col bg-gray-900 border-r border-gray-800">
        <div className="px-4 py-5 border-b border-gray-800">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-yellow-400 flex items-center justify-center text-sm">🎨</div>
            <div>
              <div className="text-sm font-bold text-white leading-none">Northern</div>
              <div className="text-xs text-gray-400">Painters</div>
            </div>
          </div>
        </div>

        <nav className="flex-1 px-2 py-3 space-y-0.5 overflow-y-auto">
          {nav.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                  isActive
                    ? 'bg-yellow-400 text-gray-900 font-semibold'
                    : 'text-gray-400 hover:text-white hover:bg-gray-800'
                }`
              }
            >
              <Icon size={16} />
              {label}
            </NavLink>
          ))}
        </nav>

        <div className="p-2 border-t border-gray-800">
          <button
            onClick={signOut}
            className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-gray-400 hover:text-white hover:bg-gray-800 w-full transition-colors"
          >
            <LogOut size={16} />
            Sign out
          </button>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 overflow-y-auto">
        <Outlet />
      </main>
    </div>
  )
}
