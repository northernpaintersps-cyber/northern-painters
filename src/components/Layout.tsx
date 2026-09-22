import { useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '@/lib/auth'
import { useRealtime } from '@/lib/useRealtime'
import {
  LayoutDashboard, Briefcase, FileText, Users, Calendar,
  DollarSign, ClipboardList, Settings, LogOut, Phone,
  BarChart2, Menu, X, MapPin, Receipt, Megaphone, Calculator,
  Package, GitBranch, UserCheck, Shield, TrendingUp, PieChart,
  Paintbrush, MessageCircle, Banknote
} from 'lucide-react'

const nav = [
  { group: 'Overview', items: [
    { to: '/dashboard',  label: 'Dashboard',    icon: LayoutDashboard },
    { to: '/pipeline',   label: 'Pipeline',      icon: GitBranch },
    { to: '/calendar',   label: 'Calendar',      icon: Calendar },
    { to: '/todos',      label: 'To‑do',         icon: ClipboardList },
  ]},
  { group: 'Work', items: [
    { to: '/jobs',       label: 'Jobs',          icon: Briefcase },
    { to: '/enquiries',  label: 'Enquiries',     icon: Phone },
    { to: '/visits',     label: 'Site Visits',   icon: MapPin },
    { to: '/clients',    label: 'Clients',       icon: UserCheck },
  ]},
  { group: 'Finance', items: [
    { to: '/invoices',      label: 'Invoices',      icon: FileText },
    { to: '/receipts',      label: 'Receipts',      icon: Receipt },
    { to: '/payments',      label: 'Pay Schedules', icon: Banknote },
    { to: '/costs',         label: 'Project Costs', icon: TrendingUp },
    { to: '/profitability', label: 'Profitability', icon: PieChart },
    { to: '/finance',       label: 'Finance',       icon: DollarSign },
    { to: '/reports',       label: 'Reports',       icon: BarChart2 },
  ]},
  { group: 'Resources', items: [
    { to: '/quotes',     label: 'Quote Builder', icon: Calculator },
    { to: '/paintcalc',  label: 'Paint Calc',    icon: Paintbrush },
    { to: '/insights',   label: 'AI Chat',       icon: MessageCircle },
    { to: '/materials',  label: 'Materials',     icon: Package },
    { to: '/crew',       label: 'Crew',          icon: Users },
    { to: '/legal',      label: 'Legal Docs',    icon: Shield },
    { to: '/ads',        label: 'Ads Spend',     icon: Megaphone },
  ]},
]

export default function Layout() {
  const { signOut } = useAuth()
  const [mobileOpen, setMobileOpen] = useState(false)
  useRealtime()

  const sidebar = (
    <aside className="flex flex-col h-full bg-white border-r border-black/10">
      <div className="px-4 py-3.5 border-b border-black/10 flex items-center justify-between">
        <div>
          <div className="text-[13px] font-bold text-gray-900 leading-tight">Northern Painters</div>
          <div className="text-[11px] text-gray-500 mt-0.5">Business Management</div>
        </div>
        <button className="lg:hidden text-gray-500 hover:text-gray-900" onClick={() => setMobileOpen(false)}>
          <X size={16} />
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto py-2">
        {nav.map(({ group, items }) => (
          <div key={group}>
            <div className="px-4 pt-3 pb-1 text-[10px] font-semibold text-gray-400 uppercase tracking-wider">{group}</div>
            {items.map(({ to, label, icon: Icon }) => (
              <NavLink
                key={to}
                to={to}
                onClick={() => setMobileOpen(false)}
                className={({ isActive }) =>
                  `flex items-center gap-2 px-4 py-[7px] text-[13px] border-l-2 transition-colors ${
                    isActive
                      ? 'border-blue-600 bg-[#f5f4f0] text-gray-900 font-medium'
                      : 'border-transparent text-gray-500 hover:bg-[#f5f4f0] hover:text-gray-900'
                  }`
                }
              >
                <Icon size={14} />
                {label}
              </NavLink>
            ))}
          </div>
        ))}
      </nav>

      <div className="border-t border-black/10 py-2">
        <NavLink to="/settings" onClick={() => setMobileOpen(false)}
          className={({ isActive }) =>
            `flex items-center gap-2 px-4 py-[7px] text-[13px] border-l-2 transition-colors ${isActive ? 'border-blue-600 bg-[#f5f4f0] text-gray-900 font-medium' : 'border-transparent text-gray-500 hover:bg-[#f5f4f0] hover:text-gray-900'}`
          }>
          <Settings size={14} /> Settings
        </NavLink>
        <button onClick={signOut} className="flex w-full items-center gap-2 px-4 py-[7px] text-[13px] border-l-2 border-transparent text-gray-500 hover:bg-[#f5f4f0] hover:text-gray-900 transition-colors">
          <LogOut size={14} /> Sign out
        </button>
      </div>
    </aside>
  )

  return (
    <div className="flex h-screen bg-[#f5f4f0] overflow-hidden">
      <div className="hidden lg:flex lg:w-[200px] lg:shrink-0 flex-col">{sidebar}</div>

      {mobileOpen && (
        <>
          <div className="fixed inset-0 z-40 bg-black/40" onClick={() => setMobileOpen(false)} />
          <div className="fixed inset-y-0 left-0 z-50 w-[200px]">{sidebar}</div>
        </>
      )}

      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="lg:hidden flex items-center gap-3 px-4 py-3 border-b border-black/10 bg-white shrink-0">
          <button onClick={() => setMobileOpen(true)} className="text-gray-500 hover:text-gray-900">
            <Menu size={18} />
          </button>
          <span className="text-sm font-bold text-gray-900">Northern Painters</span>
        </div>
        <main className="flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
