import { useState } from 'react'
import { useAuth } from '@/lib/auth'

export default function Login() {
  const { signIn } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    const { error } = await signIn(email, password)
    setLoading(false)
    if (error) setError(error.message)
  }

  return (
    <div className="min-h-screen bg-[#f5f4f0] flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-blue-600 mb-4">
            <span className="text-2xl">🎨</span>
          </div>
          <h1 className="text-2xl font-bold text-gray-900">Northern Painters</h1>
          <p className="text-gray-500 text-sm mt-1">Business Management</p>
        </div>

        <form onSubmit={handleSubmit} className="bg-white rounded-2xl p-6 space-y-4 border border-gray-200">
          <div>
            <label className="block text-sm font-medium text-gray-600 mb-1.5">Email</label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2.5 text-gray-900 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="you@example.com"
              required
              autoComplete="email"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-600 mb-1.5">Password</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2.5 text-gray-900 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="••••••••"
              required
              autoComplete="current-password"
            />
          </div>
          {error && (
            <p className="text-red-400 text-sm bg-red-400/10 rounded-lg px-3 py-2">{error}</p>
          )}
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-gray-900 font-semibold rounded-lg py-2.5 transition-colors"
          >
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  )
}
