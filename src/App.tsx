import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from '@/lib/auth'
import Layout from '@/components/Layout'
import Login from '@/pages/Login'
import Dashboard from '@/pages/Dashboard'
import Jobs from '@/pages/Jobs'
import Invoices from '@/pages/Invoices'
import Crew from '@/pages/Crew'
import CalendarPage from '@/pages/CalendarPage'
import Finance from '@/pages/Finance'
import Enquiries from '@/pages/Enquiries'
import Todos from '@/pages/Todos'
import Reports from '@/pages/Reports'
import SettingsPage from '@/pages/SettingsPage'
import SiteVisits from '@/pages/SiteVisits'

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { session, loading } = useAuth()
  if (loading) return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center">
      <div className="w-6 h-6 border-2 border-yellow-400 border-t-transparent rounded-full animate-spin" />
    </div>
  )
  return session ? <>{children}</> : <Navigate to="/login" replace />
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route element={<RequireAuth><Layout /></RequireAuth>}>
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/jobs/*" element={<Jobs />} />
        <Route path="/invoices/*" element={<Invoices />} />
        <Route path="/crew/*" element={<Crew />} />
        <Route path="/calendar" element={<CalendarPage />} />
        <Route path="/finance" element={<Finance />} />
        <Route path="/enquiries/*" element={<Enquiries />} />
        <Route path="/todos" element={<Todos />} />
        <Route path="/reports" element={<Reports />} />
        <Route path="/visits" element={<SiteVisits />} />
        <Route path="/settings" element={<SettingsPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  )
}
