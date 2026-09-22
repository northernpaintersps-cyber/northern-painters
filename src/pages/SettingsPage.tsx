import { useState, useRef, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
import { importBackup } from '@/lib/importData'
import type { ImportResult } from '@/lib/importData'
import { Upload, CheckCircle, AlertCircle, Loader2, ChevronDown, ChevronRight, Save } from 'lucide-react'

// ── Business settings hook ────────────────────────────────────
export interface BusinessSettings {
  company_name: string
  abn: string
  licence: string
  address: string
  phone: string
  email: string
  website: string
  bsb: string
  account_no: string
  account_name: string
  default_labour_rate: number
  default_markup_pct: number
  invoice_terms: string
  quote_valid_days: number
  quote_footer: string
  invoice_footer: string
}

const DEFAULT_SETTINGS: BusinessSettings = {
  company_name: 'Northern Painters',
  abn: '',
  licence: '',
  address: '',
  phone: '',
  email: '',
  website: '',
  bsb: '',
  account_no: '',
  account_name: '',
  default_labour_rate: 65,
  default_markup_pct: 20,
  invoice_terms: 'Payment due within 14 days of invoice date.',
  quote_valid_days: 30,
  quote_footer: 'All surfaces to be cleaned and prepared before painting.\nAll furniture and floor coverings to be protected during works.',
  invoice_footer: 'This invoice is issued in accordance with the Building and Construction Industry Security of Payment Act 1999 (NSW).',
}

export function useBusinessSettings() {
  const { user } = useAuth()
  return useQuery<BusinessSettings>({
    queryKey: ['np_settings_business', user?.id],
    queryFn: async () => {
      const { data } = await (supabase.from('np_settings') as any).select('value').eq('user_id', user!.id).eq('key', 'business').maybeSingle()
      if (!data?.value) return DEFAULT_SETTINGS
      return { ...DEFAULT_SETTINGS, ...(data.value as object) }
    },
    enabled: !!user,
  })
}

function useSaveSettings() {
  const qc = useQueryClient()
  const { user } = useAuth()
  return useMutation({
    mutationFn: async (settings: BusinessSettings) => {
      const { error } = await (supabase.from('np_settings') as any).upsert({
        key: 'business',
        user_id: user!.id,
        value: settings,
        updated_at: new Date().toISOString(),
      })
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['np_settings_business'] }),
  })
}

// ── Field helpers ─────────────────────────────────────────────
function Field({ label, value, onChange, type = 'text', placeholder = '' }: {
  label: string; value: string | number; onChange: (v: string) => void; type?: string; placeholder?: string
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-medium text-gray-400">{label}</label>
      <input type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
        className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-yellow-400 placeholder-gray-600" />
    </div>
  )
}

function TextAreaField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-medium text-gray-400">{label}</label>
      <textarea value={value} onChange={e => onChange(e.target.value)} rows={2}
        className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-yellow-400 resize-none" />
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────
export default function SettingsPage() {
  const { user } = useAuth()
  const { data: savedSettings } = useBusinessSettings()
  const saveSettings = useSaveSettings()

  const [biz, setBiz] = useState<BusinessSettings>(DEFAULT_SETTINGS)
  const [bizSaving, setBizSaving] = useState(false)
  const [bizSaved, setBizSaved] = useState(false)

  useEffect(() => {
    if (savedSettings) setBiz(savedSettings)
  }, [savedSettings])

  function set(k: keyof BusinessSettings) {
    return (v: string) => setBiz(p => ({ ...p, [k]: v }))
  }

  async function handleSaveBiz() {
    setBizSaving(true)
    try {
      await saveSettings.mutateAsync(biz)
      setBizSaved(true)
      setTimeout(() => setBizSaved(false), 2500)
    } finally { setBizSaving(false) }
  }

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
    <div className="p-6 max-w-3xl mx-auto space-y-8">
      <h1 className="text-xl font-bold text-white">Settings</h1>

      {/* ── Business Profile ─────────────────────────────────── */}
      <section className="bg-gray-900 rounded-xl border border-gray-800 p-6 space-y-5">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-white">Business profile</h2>
            <p className="text-xs text-gray-500 mt-0.5">Used on invoices, quotes, and printed documents</p>
          </div>
          <button onClick={handleSaveBiz} disabled={bizSaving}
            className="flex items-center gap-1.5 text-sm bg-yellow-400 hover:bg-yellow-300 disabled:opacity-50 text-gray-900 font-semibold px-4 py-1.5 rounded-lg transition-colors">
            {bizSaving ? <Loader2 size={13} className="animate-spin" /> : bizSaved ? <CheckCircle size={13} /> : <Save size={13} />}
            {bizSaved ? 'Saved' : 'Save'}
          </button>
        </div>

        <div className="space-y-4">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Company</p>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <Field label="Company name" value={biz.company_name} onChange={set('company_name')} />
            <Field label="ABN" value={biz.abn} onChange={set('abn')} placeholder="12 345 678 901" />
            <Field label="Licence number" value={biz.licence} onChange={set('licence')} placeholder="NSW Fair Trading" />
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <Field label="Phone" value={biz.phone} onChange={set('phone')} type="tel" />
            <Field label="Email" value={biz.email} onChange={set('email')} type="email" />
            <Field label="Website" value={biz.website} onChange={set('website')} placeholder="www.example.com.au" />
          </div>
          <Field label="Address" value={biz.address} onChange={set('address')} placeholder="123 Street, City NSW 2000" />
        </div>

        <div className="space-y-3 pt-2 border-t border-gray-800">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Bank account (for invoices)</p>
          <div className="grid grid-cols-3 gap-3">
            <Field label="BSB" value={biz.bsb} onChange={set('bsb')} placeholder="067-873" />
            <Field label="Account number" value={biz.account_no} onChange={set('account_no')} placeholder="2252 1951" />
            <Field label="Account name" value={biz.account_name} onChange={set('account_name')} />
          </div>
        </div>

        <div className="space-y-3 pt-2 border-t border-gray-800">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Defaults</p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Field label="Default labour rate ($/hr)" value={biz.default_labour_rate} onChange={set('default_labour_rate')} type="number" />
            <Field label="Default markup %" value={biz.default_markup_pct} onChange={set('default_markup_pct')} type="number" />
            <Field label="Quote valid (days)" value={biz.quote_valid_days} onChange={set('quote_valid_days')} type="number" />
            <Field label="Invoice terms" value={biz.invoice_terms} onChange={set('invoice_terms')} />
          </div>
        </div>

        <div className="space-y-3 pt-2 border-t border-gray-800">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Document footers</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <TextAreaField label="Quote footer / scope notes" value={biz.quote_footer} onChange={set('quote_footer')} />
            <TextAreaField label="Invoice footer" value={biz.invoice_footer} onChange={set('invoice_footer')} />
          </div>
        </div>
      </section>

      {/* ── Data Import ──────────────────────────────────────── */}
      <section className="bg-gray-900 rounded-xl border border-gray-800 p-6 space-y-4">
        <div>
          <h2 className="text-base font-semibold text-white">Import V16 backup</h2>
          <p className="text-sm text-gray-400 mt-1">
            Upload a JSON backup file exported from the previous app. All existing records
            with matching IDs will be updated; new records will be added. No data will be deleted.
          </p>
        </div>

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

        {progress.length > 0 && (
          <div className="bg-gray-950 rounded-lg p-3 max-h-40 overflow-y-auto space-y-1">
            {progress.map((msg, i) => (
              <p key={i} className="text-xs text-gray-400 font-mono">{msg}</p>
            ))}
            {importing && <p className="text-xs text-yellow-400 font-mono animate-pulse">Processing…</p>}
          </div>
        )}

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
