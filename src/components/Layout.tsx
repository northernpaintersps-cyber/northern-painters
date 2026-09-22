import { useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '@/lib/auth'
import { useRealtime } from '@/lib/useRealtime'
import {
  LayoutDashboard, Briefcase, FileText, Users, Calendar,
  DollarSign, ClipboardList, Settings, LogOut, Phone,
  BarChart2, Menu, X, MapPin, Receipt, Megaphone, Calculator
} from 'lucide-react'

const nav = [
  { to: '/dashboard',  label: 'Dashboard',   icon: LayoutDashboard },
  { to: '/jobs',       label: 'Jobs',         icon: Briefcase },
  { to: '/invoices',   label: 'Invoices',     icon: FileText },
  { to: '/crew',       label: 'Crew',         icon: Users },
  { to: '/calendar',   label: 'Calendar',     icon: Calendar },
  { to: '/finance',    label: 'Finance',      icon: DollarSign },
  { to: '/enquiries',  label: 'Enquiries',    icon: Phone },
  { to: '/visits',     label: 'Site Visits',  icon: MapPin },
  { to: '/receipts',   label: 'Receipts',     icon: Receipt },
  { to: '/ads',        label: 'Ads Spend',    icon: Megaphone },
  { to: '/quotes',     label: 'Quote Builder',icon: Calculator },
  { to: '/todos',      label: 'To‑do',        icon: ClipboardList },
  { to: '/reports',    label: 'Reports',      icon: BarChart2 },
]

export default function Layout() {
  const { signOut } = useAuth()
  const [mobileOpen, setMobileOpen] = useState(false)
  useRealtime()

  const sidebar = (
    <aside className="flex flex-col h-full bg-gray-900 border-r border-gray-800">
      <div className="px-4 py-5 border-b border-gray-800 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-yellow-400 flex items-center justify-center text-sm shrink-0">🎨</div>
          <div>
            <div className="text-sm font-bold text-white leading-none">Northern</div>
            <div className="text-xs text-gray-400">Painters</div>
          </div>
        </div>
        <button className="lg:hidden text-gray-400 hover:text-white" onClick={() => setMobileOpen(false)}>
          <X size={18} />
        </button>
      </div>

      <nav className="flex-1 px-2 py-3 space-y-0.5 overflow-y-auto">
        {nav.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            onClick={() => setMobileOpen(false)}
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

      <div className="p-2 border-t border-gray-800 space-y-0.5">
        <NavLink to="/settings" onClick={() => setMobileOpen(false)}
          className={({ isActive }) =>
            `flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${isActive ? 'bg-yellow-400 text-gray-900 font-semibold' : 'text-gray-400 hover:text-white hover:bg-gray-800'}`
          }>
          <Settings size={16} /> Settings
        </NavLink>
        <button onClick={signOut} className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-gray-400 hover:text-white hover:bg-gray-800 w-full transition-colors">
          <LogOut size={16} /> Sign out
        </button>
      </div>
    </aside>
  )

  return (
    <div className="flex h-screen bg-gray-950 text-white overflow-hidden">
      {/* Desktop sidebar */}
      <div className="hidden lg:flex lg:w-56 lg:shrink-0 flex-col">{sidebar}</div>

      {/* Mobile sidebar */}
      {mobileOpen && (
        <>
          <div className="fixed inset-0 z-40 bg-black/60" onClick={() => setMobileOpen(false)} />
          <div className="fixed inset-y-0 left-0 z-50 w-56">{sidebar}</div>
        </>
      )}

      {/* Main content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Mobile header */}
        <div className="lg:hidden flex items-center gap-3 px-4 py-3 border-b border-gray-800 bg-gray-900 shrink-0">
          <button onClick={() => setMobileOpen(true)} className="text-gray-400 hover:text-white">
            <Menu size={20} />
          </button>
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-md bg-yellow-400 flex items-center justify-center text-xs">🎨</div>
            <span className="text-sm font-bold">Northern Painters</span>
          </div>
        </div>

        <main className="flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
