import { useState, useRef, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
import { importBackup } from '@/lib/importData'
import type { ImportResult } from '@/lib/importData'
import { Upload, CheckCircle, AlertCircle, Loader2, ChevronDown, ChevronRight, Save, Plus, Trash2, Key } from 'lucide-react'

// ── Business settings hook ────────────────────────────────────
export interface LabourRates {
  standard: number   // standard painter $/hr
  lead: number       // leading hand $/hr
  sub: number        // subcontractor $/hr
  overhead: number   // overhead $/hr
  hpd: number        // hours per day default
  charge_rate: number // charge-out rate to client $/hr
}

export interface PaintProduct {
  id: string
  product: string
  cat: 'interior' | 'exterior' | 'specialty'
  use: string
  size: string
  finish: string
  coverage: number  // m² per litre
  rrp: number
  yours: number     // your cost price
}

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
  rates: LabourRates
  paint_products: PaintProduct[]
  ai_api_key: string
}

const DEFAULT_RATES: LabourRates = {
  standard: 65,
  lead: 75,
  sub: 70,
  overhead: 12,
  hpd: 8,
  charge_rate: 65,
}

const DEFAULT_PAINT_PRODUCTS: PaintProduct[] = [
  { id: 'p1',  product: 'Dulux Ceiling White Flat',         cat: 'interior',  use: 'Interior ceilings',             size: '15L', finish: 'Flat',       coverage: 14, rrp: 149, yours: 120 },
  { id: 'p2',  product: 'Dulux Wash and Wear Low Sheen',    cat: 'interior',  use: 'Interior walls',                size: '15L', finish: 'Low Sheen',  coverage: 16, rrp: 189, yours: 155 },
  { id: 'p3',  product: 'Dulux Wash and Wear Low Sheen',    cat: 'interior',  use: 'Interior walls',                size: '4L',  finish: 'Low Sheen',  coverage: 16, rrp: 72,  yours: 58 },
  { id: 'p4',  product: 'Dulux Aquanamel Semi-Gloss',       cat: 'interior',  use: 'Doors trims skirtings',         size: '4L',  finish: 'Semi-Gloss', coverage: 12, rrp: 89,  yours: 72 },
  { id: 'p5',  product: 'Dulux Aquanamel Gloss',            cat: 'interior',  use: 'Doors and trims gloss',         size: '4L',  finish: 'Gloss',      coverage: 12, rrp: 89,  yours: 72 },
  { id: 'p6',  product: 'Dulux Acrylic Undercoat',          cat: 'interior',  use: 'Interior primer undercoat',     size: '10L', finish: 'Flat',       coverage: 12, rrp: 125, yours: 99 },
  { id: 'p7',  product: 'Dulux Oil Based Undercoat',        cat: 'interior',  use: 'Oil based primer',              size: '4L',  finish: 'Flat',       coverage: 12, rrp: 79,  yours: 64 },
  { id: 'p8',  product: 'Berger Breathe Easy Low Sheen',    cat: 'interior',  use: 'Interior walls low VOC',        size: '15L', finish: 'Low Sheen',  coverage: 15, rrp: 165, yours: 135 },
  { id: 'p9',  product: 'Dulux Weathershield Low Sheen',    cat: 'exterior',  use: 'Exterior walls and boards',     size: '15L', finish: 'Low Sheen',  coverage: 14, rrp: 225, yours: 185 },
  { id: 'p10', product: 'Dulux Weathershield Low Sheen',    cat: 'exterior',  use: 'Exterior walls',                size: '4L',  finish: 'Low Sheen',  coverage: 14, rrp: 82,  yours: 67 },
  { id: 'p11', product: 'Dulux Weathershield Semi-Gloss',   cat: 'exterior',  use: 'Exterior trims fascia doors',   size: '4L',  finish: 'Semi-Gloss', coverage: 12, rrp: 86,  yours: 70 },
  { id: 'p12', product: 'Dulux Weathershield Exterior Primer', cat: 'exterior', use: 'Exterior primer',            size: '4L',  finish: 'Flat',       coverage: 12, rrp: 72,  yours: 58 },
  { id: 'p13', product: 'Acratex Render Coat',              cat: 'exterior',  use: 'Textured render walls',         size: '15L', finish: 'Texture',    coverage: 6,  rrp: 210, yours: 172 },
  { id: 'p14', product: 'Dulux Roof and Trim',              cat: 'exterior',  use: 'Roof coating',                  size: '10L', finish: 'Low Sheen',  coverage: 10, rrp: 165, yours: 135 },
  { id: 'p15', product: 'Dulux Super Grip Medium',          cat: 'exterior',  use: 'Concrete driveways',            size: '10L', finish: 'Medium',     coverage: 6,  rrp: 145, yours: 118 },
  { id: 'p16', product: 'Cutek CD50 Clear',                 cat: 'specialty', use: 'Deck timber oil clear',         size: '4L',  finish: 'Oil',        coverage: 8,  rrp: 95,  yours: 79 },
]

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
  rates: DEFAULT_RATES,
  paint_products: DEFAULT_PAINT_PRODUCTS,
  ai_api_key: '',
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
      <label className="text-xs font-medium text-gray-500">{label}</label>
      <input type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
        className="bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-blue-500 placeholder-gray-600" />
    </div>
  )
}

function TextAreaField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-medium text-gray-500">{label}</label>
      <textarea value={value} onChange={e => onChange(e.target.value)} rows={2}
        className="bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-blue-500 resize-none" />
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
  const [showKey, setShowKey] = useState(false)
  const [newProduct, setNewProduct] = useState<Partial<PaintProduct> | null>(null)

  useEffect(() => {
    if (savedSettings) setBiz(p => ({
      ...p,
      ...savedSettings,
      rates: { ...DEFAULT_RATES, ...(savedSettings.rates ?? {}) },
      paint_products: savedSettings.paint_products?.length ? savedSettings.paint_products : DEFAULT_PAINT_PRODUCTS,
    }))
  }, [savedSettings])

  function set(k: keyof BusinessSettings) {
    return (v: string) => setBiz(p => ({ ...p, [k]: v }))
  }
  function setRate(k: keyof LabourRates) {
    return (v: string) => setBiz(p => ({ ...p, rates: { ...p.rates, [k]: parseFloat(v) || 0 } }))
  }

  function deleteProduct(id: string) {
    setBiz(p => ({ ...p, paint_products: p.paint_products.filter(x => x.id !== id) }))
  }
  function saveProduct() {
    if (!newProduct?.product || !newProduct.use) return
    const prod: PaintProduct = {
      id: `pp-${Date.now()}`,
      product: newProduct.product ?? '',
      cat: (newProduct.cat as any) ?? 'interior',
      use: newProduct.use ?? '',
      size: newProduct.size ?? '15L',
      finish: newProduct.finish ?? '',
      coverage: Number(newProduct.coverage) || 12,
      rrp: Number(newProduct.rrp) || 0,
      yours: Number(newProduct.yours) || 0,
    }
    setBiz(p => ({ ...p, paint_products: [...p.paint_products, prod] }))
    setNewProduct(null)
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
      <h1 className="text-xl font-bold text-gray-900">Settings</h1>

      {/* ── Business Profile ─────────────────────────────────── */}
      <section className="bg-white rounded-xl border border-gray-200 p-6 space-y-5">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-gray-900">Business profile</h2>
            <p className="text-xs text-gray-500 mt-0.5">Used on invoices, quotes, and printed documents</p>
          </div>
          <button onClick={handleSaveBiz} disabled={bizSaving}
            className="flex items-center gap-1.5 text-sm bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-gray-900 font-semibold px-4 py-1.5 rounded-lg transition-colors">
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

        <div className="space-y-3 pt-2 border-t border-gray-200">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Bank account (for invoices)</p>
          <div className="grid grid-cols-3 gap-3">
            <Field label="BSB" value={biz.bsb} onChange={set('bsb')} placeholder="067-873" />
            <Field label="Account number" value={biz.account_no} onChange={set('account_no')} placeholder="2252 1951" />
            <Field label="Account name" value={biz.account_name} onChange={set('account_name')} />
          </div>
        </div>

        <div className="space-y-3 pt-2 border-t border-gray-200">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Defaults</p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Field label="Default labour rate ($/hr)" value={biz.default_labour_rate} onChange={set('default_labour_rate')} type="number" />
            <Field label="Default markup %" value={biz.default_markup_pct} onChange={set('default_markup_pct')} type="number" />
            <Field label="Quote valid (days)" value={biz.quote_valid_days} onChange={set('quote_valid_days')} type="number" />
            <Field label="Invoice terms (days)" value={biz.invoice_terms} onChange={set('invoice_terms')} />
          </div>
        </div>

        <div className="space-y-3 pt-2 border-t border-gray-200">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Labour rates</p>
          <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
            <Field label="Standard ($/hr)" value={biz.rates.standard} onChange={setRate('standard')} type="number" />
            <Field label="Lead hand ($/hr)" value={biz.rates.lead} onChange={setRate('lead')} type="number" />
            <Field label="Sub ($/hr)" value={biz.rates.sub} onChange={setRate('sub')} type="number" />
            <Field label="Overhead ($/hr)" value={biz.rates.overhead} onChange={setRate('overhead')} type="number" />
            <Field label="Charge rate ($/hr)" value={biz.rates.charge_rate} onChange={setRate('charge_rate')} type="number" />
            <Field label="Hours per day" value={biz.rates.hpd} onChange={setRate('hpd')} type="number" />
          </div>
        </div>

        <div className="space-y-3 pt-2 border-t border-gray-200">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Document footers</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <TextAreaField label="Quote footer / scope notes" value={biz.quote_footer} onChange={set('quote_footer')} />
            <TextAreaField label="Invoice footer" value={biz.invoice_footer} onChange={set('invoice_footer')} />
          </div>
        </div>
      </section>

      {/* ── AI API Key ───────────────────────────────────────── */}
      <section className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
        <div className="flex items-center gap-2">
          <Key size={16} className="text-blue-600" />
          <div>
            <h2 className="text-base font-semibold text-gray-900">AI API key</h2>
            <p className="text-xs text-gray-500 mt-0.5">Used for AI quote builder and invoice reader. Key is stored locally in your Supabase account only.</p>
          </div>
        </div>
        <div className="flex gap-2">
          <div className="flex-1 relative">
            <input
              type={showKey ? 'text' : 'password'}
              value={biz.ai_api_key}
              onChange={e => setBiz(p => ({ ...p, ai_api_key: e.target.value }))}
              placeholder="sk-..."
              className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-blue-500 placeholder-gray-600 font-mono"
            />
          </div>
          <button onClick={() => setShowKey(v => !v)} className="px-3 py-2 bg-gray-50 rounded-lg text-xs text-gray-500 hover:text-gray-900 border border-gray-200">
            {showKey ? 'Hide' : 'Show'}
          </button>
          <button onClick={handleSaveBiz} disabled={bizSaving} className="flex items-center gap-1.5 text-sm bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-gray-900 font-semibold px-4 py-2 rounded-lg">
            {bizSaving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />} Save
          </button>
        </div>
      </section>

      {/* ── Paint products ───────────────────────────────────── */}
      <section className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-gray-900">Paint products</h2>
            <p className="text-xs text-gray-500 mt-0.5">Products used in the quote builder and paint calculator. Edit your cost price and coverage.</p>
          </div>
          <div className="flex gap-2">
            <button onClick={() => setNewProduct({ cat: 'interior', size: '15L', coverage: 12 })}
              className="flex items-center gap-1.5 text-xs bg-gray-50 border border-gray-200 hover:border-blue-500/50 text-gray-600 px-3 py-1.5 rounded-lg">
              <Plus size={12} /> Add product
            </button>
            <button onClick={handleSaveBiz} disabled={bizSaving}
              className="flex items-center gap-1.5 text-sm bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-gray-900 font-semibold px-4 py-1.5 rounded-lg">
              {bizSaving ? <Loader2 size={13} className="animate-spin" /> : bizSaved ? <CheckCircle size={13} /> : <Save size={13} />}
              {bizSaved ? 'Saved' : 'Save'}
            </button>
          </div>
        </div>

        {newProduct && (
          <div className="bg-gray-50/60 rounded-lg p-3 grid grid-cols-2 md:grid-cols-4 gap-2 border border-blue-500/30">
            <Field label="Product name" value={newProduct.product ?? ''} onChange={v => setNewProduct(p => ({ ...p, product: v }))} />
            <Field label="Use / surface" value={newProduct.use ?? ''} onChange={v => setNewProduct(p => ({ ...p, use: v }))} />
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-gray-500">Category</label>
              <select value={newProduct.cat ?? 'interior'} onChange={e => setNewProduct(p => ({ ...p, cat: e.target.value as any }))}
                className="bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-blue-500">
                <option value="interior">Interior</option>
                <option value="exterior">Exterior</option>
                <option value="specialty">Specialty</option>
              </select>
            </div>
            <Field label="Size" value={newProduct.size ?? ''} onChange={v => setNewProduct(p => ({ ...p, size: v }))} placeholder="15L" />
            <Field label="Finish" value={newProduct.finish ?? ''} onChange={v => setNewProduct(p => ({ ...p, finish: v }))} />
            <Field label="Coverage (m²/L)" value={newProduct.coverage ?? ''} onChange={v => setNewProduct(p => ({ ...p, coverage: v as any }))} type="number" />
            <Field label="RRP ($)" value={newProduct.rrp ?? ''} onChange={v => setNewProduct(p => ({ ...p, rrp: v as any }))} type="number" />
            <Field label="Your cost ($)" value={newProduct.yours ?? ''} onChange={v => setNewProduct(p => ({ ...p, yours: v as any }))} type="number" />
            <div className="col-span-2 md:col-span-4 flex gap-2 justify-end pt-1">
              <button onClick={() => setNewProduct(null)} className="text-xs px-3 py-1.5 rounded-lg bg-gray-200 text-gray-500 hover:text-gray-900">Cancel</button>
              <button onClick={saveProduct} className="text-xs px-4 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-gray-900 font-semibold">Add</button>
            </div>
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-gray-500 border-b border-gray-200">
                <th className="text-left py-2 pr-3 font-medium">Product</th>
                <th className="text-left py-2 pr-3 font-medium">Use</th>
                <th className="text-left py-2 pr-3 font-medium">Cat</th>
                <th className="text-left py-2 pr-3 font-medium">Size</th>
                <th className="text-right py-2 pr-3 font-medium">Coverage</th>
                <th className="text-right py-2 pr-3 font-medium">RRP</th>
                <th className="text-right py-2 pr-3 font-medium">Your cost</th>
                <th className="py-2 w-6"></th>
              </tr>
            </thead>
            <tbody>
              {biz.paint_products.map(p => (
                <tr key={p.id} className="border-b border-gray-200/50 hover:bg-gray-50/30">
                  <td className="py-2 pr-3 text-gray-200 font-medium">{p.product}</td>
                  <td className="py-2 pr-3 text-gray-500">{p.use}</td>
                  <td className="py-2 pr-3">
                    <span className={`px-1.5 py-0.5 rounded text-xs ${p.cat === 'interior' ? 'bg-blue-500/20 text-blue-300' : p.cat === 'exterior' ? 'bg-green-500/20 text-green-300' : 'bg-purple-500/20 text-purple-300'}`}>
                      {p.cat}
                    </span>
                  </td>
                  <td className="py-2 pr-3 text-gray-500">{p.size}</td>
                  <td className="py-2 pr-3 text-right text-gray-600">{p.coverage} m²/L</td>
                  <td className="py-2 pr-3 text-right text-gray-500">${p.rrp}</td>
                  <td className="py-2 pr-3 text-right text-blue-500 font-medium">${p.yours}</td>
                  <td className="py-2">
                    <button onClick={() => deleteProduct(p.id)} className="text-gray-600 hover:text-red-400 transition-colors">
                      <Trash2 size={13} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* ── Data Import ──────────────────────────────────────── */}
      <section className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
        <div>
          <h2 className="text-base font-semibold text-gray-900">Import V16 backup</h2>
          <p className="text-sm text-gray-500 mt-1">
            Upload a JSON backup file exported from the previous app. All existing records
            with matching IDs will be updated; new records will be added. No data will be deleted.
          </p>
        </div>

        <label
          className={`flex flex-col items-center justify-center gap-3 w-full h-36 rounded-xl border-2 border-dashed cursor-pointer transition-colors
            ${importing ? 'border-blue-500/40 bg-blue-600/5' : 'border-gray-200 hover:border-blue-500/50 hover:bg-gray-50/60'}`}
        >
          <input ref={fileRef} type="file" accept=".json" className="hidden" onChange={handleFile} disabled={importing} />
          {importing
            ? <Loader2 size={24} className="animate-spin text-blue-600" />
            : <Upload size={24} className="text-gray-500" />
          }
          <div className="text-center">
            <p className="text-sm font-medium text-gray-600">
              {importing ? 'Importing…' : 'Click to choose a JSON backup file'}
            </p>
            <p className="text-xs text-gray-500 mt-0.5">Only .json files exported from the V16 app</p>
          </div>
        </label>

        {progress.length > 0 && (
          <div className="bg-[#f5f4f0] rounded-lg p-3 max-h-40 overflow-y-auto space-y-1">
            {progress.map((msg, i) => (
              <p key={i} className="text-xs text-gray-500 font-mono">{msg}</p>
            ))}
            {importing && <p className="text-xs text-blue-600 font-mono animate-pulse">Processing…</p>}
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
              className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-900 mt-1"
            >
              {showCounts ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              Breakdown by table
            </button>
            {showCounts && (
              <div className="grid grid-cols-2 gap-x-6 gap-y-1 pt-1">
                {Object.entries(result.counts).filter(([, v]) => v > 0).map(([k, v]) => (
                  <div key={k} className="flex justify-between text-xs">
                    <span className="text-gray-500">{k}</span>
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
      <section className="bg-white rounded-xl border border-gray-200 p-6 space-y-3">
        <h2 className="text-base font-semibold text-gray-900">Account</h2>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-gray-600">{user?.email}</p>
            <p className="text-xs text-gray-500 mt-0.5">Logged in</p>
          </div>
        </div>
      </section>
    </div>
  )
}
