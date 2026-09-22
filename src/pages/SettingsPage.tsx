import { useState, useRef } from 'react'
import { useAuth } from '@/lib/auth'
import { importBackup } from '@/lib/importData'
import type { ImportResult } from '@/lib/importData'
import { Upload, CheckCircle, AlertCircle, Loader2, ChevronDown, ChevronRight } from 'lucide-react'

export default function SettingsPage() {
  const { user } = useAuth()

  // ── Import state ──────────────────────────────────────────────
  const fileRef = useRef<HTMLInputElement>(null)
  const [importing, setImporting] = useState(false)
  const [progress, setProgress] = useState<string[]>([])
  const [result, setResult] = useState<ImportResult | null>(null)
  const [importError, setImportError] = useState<string | null>(null)
  const [showCounts, setShowCounts] = useState(false)

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file || !user) return
    setImporting(true)
    setProgress([])
    setResult(null)
    setImportError(null)
    try {
      const text = await file.text()
      const json = JSON.parse(text)
      const res = await importBackup(json, user.id, (msg) =>
        setProgress(prev => [...prev, msg])
      )
      setResult(res)
    } catch (err: any) {
      setImportError(err?.message || 'Import failed')
    } finally {
      setImporting(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-8">
      <h1 className="text-xl font-bold text-white">Settings</h1>

      {/* ── Data Import ──────────────────────────────────────── */}
      <section className="bg-gray-900 rounded-xl border border-gray-800 p-6 space-y-4">
        <div>
          <h2 className="text-base font-semibold text-white">Import V16 backup</h2>
          <p className="text-sm text-gray-400 mt-1">
            Upload a JSON backup file exported from the previous app. All existing records
            with matching IDs will be updated; new records will be added. No data will be deleted.
          </p>
        </div>

        {/* Drop zone */}
        <label
          className={`flex flex-col items-center justify-center gap-3 w-full h-36 rounded-xl border-2 border-dashed cursor-pointer transition-colors
            ${importing ? 'border-yellow-400/40 bg-yellow-400/5' : 'border-gray-700 hover:border-yellow-400/50 hover:bg-gray-800/60'}`}
        >
          <input ref={fileRef} type="file" accept=".json" className="hidden" onChange={handleFile} disabled={importing} />
          {importing
            ? <Loader2 size={24} className="animate-spin text-yellow-400" />
            : <Upload size={24} className="text-gray-500" />
          }
          <div className="text-center">
            <p className="text-sm font-medium text-gray-300">
              {importing ? 'Importing…' : 'Click to choose a JSON backup file'}
            </p>
            <p className="text-xs text-gray-500 mt-0.5">Only .json files exported from the V16 app</p>
          </div>
        </label>

        {/* Progress log */}
        {progress.length > 0 && (
          <div className="bg-gray-950 rounded-lg p-3 max-h-40 overflow-y-auto space-y-1">
            {progress.map((msg, i) => (
              <p key={i} className="text-xs text-gray-400 font-mono">{msg}</p>
            ))}
            {importing && <p className="text-xs text-yellow-400 font-mono animate-pulse">Processing…</p>}
          </div>
        )}

        {/* Result */}
        {result && (
          <div className="rounded-lg border border-green-800/50 bg-green-900/20 p-4 space-y-2">
            <div className="flex items-center gap-2 text-green-400">
              <CheckCircle size={16} />
              <span className="font-semibold text-sm">Import complete — {result.total} records imported</span>
            </div>
            {result.errors.length > 0 && (
              <div className="space-y-1">
                {result.errors.map((e, i) => (
                  <p key={i} className="text-xs text-red-400 font-mono">{e}</p>
                ))}
              </div>
            )}
            <button
              onClick={() => setShowCounts(v => !v)}
              className="flex items-center gap-1 text-xs text-gray-400 hover:text-white mt-1"
            >
              {showCounts ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              Breakdown by table
            </button>
            {showCounts && (
              <div className="grid grid-cols-2 gap-x-6 gap-y-1 pt-1">
                {Object.entries(result.counts).filter(([, v]) => v > 0).map(([k, v]) => (
                  <div key={k} className="flex justify-between text-xs">
                    <span className="text-gray-400">{k}</span>
                    <span className="text-gray-200 font-mono">{v}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {importError && (
          <div className="flex items-start gap-2 rounded-lg border border-red-800/50 bg-red-900/20 p-4">
            <AlertCircle size={16} className="text-red-400 mt-0.5 shrink-0" />
            <div>
              <p className="text-sm font-semibold text-red-400">Import failed</p>
              <p className="text-xs text-red-300 mt-0.5 font-mono">{importError}</p>
            </div>
          </div>
        )}
      </section>

      {/* ── Account ──────────────────────────────────────────── */}
      <section className="bg-gray-900 rounded-xl border border-gray-800 p-6 space-y-3">
        <h2 className="text-base font-semibold text-white">Account</h2>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-gray-300">{user?.email}</p>
            <p className="text-xs text-gray-500 mt-0.5">Logged in</p>
          </div>
        </div>
      </section>
    </div>
  )
}
