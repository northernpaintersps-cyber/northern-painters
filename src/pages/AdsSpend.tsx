import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { Modal } from '@/components/ui/Modal'
import { Input, Select } from '@/components/ui/Field'
import { fmtCurrency, genId, today, normaliseDate } from '@/lib/utils'
import { Plus, Loader2, Trash2, TrendingUp } from 'lucide-react'

type Row = Record<string, any>

const PLATFORMS = ['Google Ads', 'Facebook Ads', 'Instagram', 'Other']

// V16 getLeadSource()
function getLeadSource(j: Row): string {
  if (j.lead_source) return j.lead_source
  const n = (j.notes || '').toLowerCase()
  if (/website|google|seo/.test(n)) return 'Website/Google'
  if (/facebook|fb|instagram|insta|social/.test(n)) return 'Facebook/Instagram'
  if (/builder|trade/.test(n)) return 'Builder/Trade'
  if (/referral|word/.test(n)) return 'Referral'
  if (/repeat|existing/.test(n)) return 'Existing Client'
  return 'Other/Unknown'
}

function useTable(table: string) {
  const { user } = useAuth()
  return useQuery({
    queryKey: [table, user?.id],
    queryFn: async () => {
      const { data } = await (supabase.from(table as any) as any).select('*').eq('user_id', user!.id)
      return (data ?? []) as Row[]
    },
    enabled: !!user,
  })
}

function useUpsert() {
  const qc = useQueryClient()
  const { user } = useAuth()
  return useMutation({
    mutationFn: async (row: Row) => {
      const { error } = await (supabase.from('np_ads_spend') as any)
        .upsert({ ...row, user_id: user!.id, updated_at: new Date().toISOString() })
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['np_ads_spend'] }),
  })
}

function useDel() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase.from('np_ads_spend') as any).delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['np_ads_spend'] }),
  })
}

function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <div className={`bg-white border border-black/[0.12] rounded-xl ${className}`}>{children}</div>
}
const CT = 'text-[13px] font-bold mb-3'

export default function AdsSpend() {
  const { data: ads = [], isLoading } = useTable('np_ads_spend')
  const { data: jobs = [] } = useTable('np_jobs')
  const upsert = useUpsert()
  const del = useDel()

  const [modal, setModal] = useState(false)
  const [form, setForm] = useState<Row>({})

  const m = useMemo(() => {
    const totalSpend = ads.reduce((s, a) => s + (a.amount || 0), 0)
    const googleSpend = ads.filter(a => a.platform === 'Google Ads').reduce((s, a) => s + (a.amount || 0), 0)
    const fbSpend = ads.filter(a => a.platform === 'Facebook Ads' || a.platform === 'Instagram').reduce((s, a) => s + (a.amount || 0), 0)

    const webJobs = jobs.filter(j => getLeadSource(j) === 'Website/Google')
    const webEnquiries = webJobs.length
    const webQuotesSent = webJobs.filter(j => ['Sent', 'Negotiating', 'Accepted'].includes(j.quote_status) || j.status).length
    const webWon = webJobs.filter(j => j.quote_status === 'Accepted').length
    const webFinished = webJobs.filter(j => j.status === 'Finished').length
    const webRevenue = webJobs.filter(j => j.status === 'Finished').reduce((s, j) => s + (j.agreed_ex_gst || 0), 0)
    const avgJobValue = webFinished > 0 ? webRevenue / webFinished : 0
    const webQuoted = webJobs.filter(j => ['Sent', 'Negotiating', 'Accepted'].includes(j.quote_status)).length
    const acceptanceRate = webQuoted > 0 ? (webWon / webQuoted) * 100 : null
    const revenuePerLead = webEnquiries > 0 ? webRevenue / webEnquiries : null
    const roi = googleSpend > 0 ? ((webRevenue - googleSpend) / googleSpend) * 100 : null
    const costPerLead = googleSpend > 0 && webEnquiries > 0 ? googleSpend / webEnquiries : null
    const costPerJob = googleSpend > 0 && webWon > 0 ? googleSpend / webWon : null
    const convRate = webEnquiries > 0 ? (webWon / webEnquiries) * 100 : 0

    // Job type breakdown
    const typeBreakdown: Record<string, { count: number; won: number; revenue: number }> = {}
    webJobs.forEach(j => {
      const t = j.type || 'Other'
      if (!typeBreakdown[t]) typeBreakdown[t] = { count: 0, won: 0, revenue: 0 }
      typeBreakdown[t].count++
      if (j.quote_status === 'Accepted') typeBreakdown[t].won++
      if (j.status === 'Finished') typeBreakdown[t].revenue += j.agreed_ex_gst || 0
    })
    const typeRows = Object.entries(typeBreakdown).sort((a, b) => b[1].count - a[1].count)

    // Monthly breakdown
    const months: Record<string, { spend: number; leads: number; won: number; finished: number; revenue: number }> = {}
    const bucket = (p: string) => (months[p] ??= { spend: 0, leads: 0, won: 0, finished: 0, revenue: 0 })
    ads.filter(a => a.platform === 'Google Ads').forEach(a => {
      bucket((a.date || '').slice(0, 7) || 'unknown').spend += a.amount || 0
    })
    webJobs.forEach(j => {
      const raw = normaliseDate(j.quote_sent) ?? normaliseDate(j.sched_start) ?? ''
      const b = bucket(raw ? raw.slice(0, 7) : 'unknown')
      b.leads++
      if (['Accepted', 'Negotiating'].includes(j.quote_status)) b.won++
      if (j.status === 'Finished') { b.finished++; b.revenue += j.agreed_ex_gst || 0 }
    })
    const monthRows = Object.entries(months).filter(([k]) => k !== 'unknown').sort((a, b) => b[0].localeCompare(a[0]))

    return {
      totalSpend, googleSpend, fbSpend, webEnquiries, webQuotesSent, webWon, webFinished,
      webRevenue, avgJobValue, webQuoted, acceptanceRate, revenuePerLead, roi,
      costPerLead, costPerJob, convRate, typeRows, monthRows,
    }
  }, [ads, jobs])

  const roiColor = m.roi === null ? '#666' : m.roi >= 200 ? '#16a34a' : m.roi >= 0 ? '#d97706' : '#dc2626'
  const accColor = m.acceptanceRate === null ? '#666' : m.acceptanceRate >= 60 ? '#16a34a' : m.acceptanceRate >= 40 ? '#d97706' : '#dc2626'
  const funnelMax = m.webEnquiries || 1
  const maxTypeCount = m.typeRows.length ? m.typeRows[0][1].count : 1

  function openNew() {
    setForm({ date: today(), platform: 'Google Ads' })
    setModal(true)
  }
  async function save() {
    await upsert.mutateAsync({
      ...form,
      id: form.id || genId('ads'),
      amount: parseFloat(form.amount) || 0,
      created_at: form.created_at || new Date().toISOString(),
    })
    setModal(false)
  }

  const roiAdvice = m.roi === null
    ? 'Log your Google Ads spend to see ROI calculations.'
    : m.roi >= 300 ? `For every $1 spent on Google Ads you're getting $${(m.roi / 100 + 1).toFixed(1)} back. Excellent ROI — consider increasing budget.`
    : m.roi >= 100 ? `For every $1 spent you're getting $${(m.roi / 100 + 1).toFixed(1)} back. Good ROI — ads are working.`
    : m.roi >= 0 ? `For every $1 spent you're getting $${(m.roi / 100 + 1).toFixed(1)} back. Marginal — review targeting or landing page.`
    : 'Spending more than earning from Google leads. Review ad targeting, budget, or landing page.'

  if (isLoading) return (
    <div className="flex items-center justify-center h-64"><Loader2 size={20} className="animate-spin text-blue-600" /></div>
  )

  const Mini = ({ label, value, color }: { label: string; value: string; color?: string }) => (
    <div className="text-xs">
      <div className="text-[#666] mb-0.5">{label}</div>
      <div className="font-bold text-[15px]" style={color ? { color } : undefined}>{value}</div>
    </div>
  )

  return (
    <div className="p-5">
      <div className="flex items-center justify-between flex-wrap gap-2 mb-4">
        <h2 className="text-[17px] font-semibold text-gray-900 flex items-center gap-2">
          <TrendingUp size={18} className="text-[#2563eb]" /> Ads ROI
        </h2>
        <button onClick={openNew}
          className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white font-medium text-[13px] px-3 py-1.5 rounded-lg">
          <Plus size={14} /> Log Ad Spend
        </button>
      </div>

      <div className="grid gap-2.5 mb-3.5" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(140px,1fr))' }}>
        {[
          { l: 'Total ad spend', v: fmtCurrency(m.totalSpend), c: '#dc2626' },
          { l: 'Revenue (Google leads)', v: fmtCurrency(m.webRevenue), c: '#16a34a' },
          { l: 'ROI', v: m.roi === null ? 'No spend logged' : `${m.roi.toFixed(0)}%`, c: roiColor },
          { l: 'Conversion rate', v: `${m.convRate.toFixed(1)}%`, c: '#2563eb' },
          { l: 'Avg job value', v: m.avgJobValue > 0 ? fmtCurrency(m.avgJobValue) : '—' },
          { l: 'Quote acceptance rate', v: m.acceptanceRate === null ? '—' : `${m.acceptanceRate.toFixed(1)}%`, c: accColor },
          { l: 'Revenue per lead', v: m.revenuePerLead ? fmtCurrency(m.revenuePerLead) : '—', c: '#2563eb' },
          { l: 'Leads with quotes sent', v: String(m.webQuoted) },
        ].map(x => (
          <div key={x.l} className="bg-[#f5f4f0] rounded-lg px-4 py-3.5">
            <div className="text-[11px] text-[#666] mb-1">{x.l}</div>
            <div className="text-xl font-semibold" style={x.c ? { color: x.c } : undefined}>{x.v}</div>
          </div>
        ))}
      </div>

      <div className="grid gap-3.5 mb-3.5" style={{ gridTemplateColumns: '1fr 1fr' }}>
        {/* Funnel */}
        <Card className="p-4">
          <div className={CT}>Conversion funnel — Website / Google leads</div>
          {[
            { label: 'Enquiries / leads', n: m.webEnquiries, color: '#3b82f6' },
            { label: 'Quotes sent', n: m.webQuotesSent, color: '#8b5cf6' },
            { label: 'Jobs won', n: m.webWon, color: '#f59e0b' },
            { label: 'Jobs completed', n: m.webFinished, color: '#10b981' },
          ].map(row => (
            <div key={row.label} className="mb-3">
              <div className="flex justify-between text-xs mb-1">
                <span>{row.label}</span><span className="font-bold">{row.n}</span>
              </div>
              <div className="h-5 rounded" style={{
                background: row.color,
                width: `${Math.round((row.n / funnelMax) * 100)}%`,
                minWidth: row.n > 0 ? 8 : 0,
              }} />
            </div>
          ))}
          <div className="border-t border-black/[0.12] pt-2.5 mt-1 grid grid-cols-2 gap-2">
            <Mini label="Cost per lead" value={m.costPerLead ? fmtCurrency(m.costPerLead) : '—'} />
            <Mini label="Cost per job won" value={m.costPerJob ? fmtCurrency(m.costPerJob) : '—'} />
            <Mini label="Quote acceptance rate" value={m.acceptanceRate === null ? '—' : `${m.acceptanceRate.toFixed(1)}%`} color={accColor} />
            <Mini label="Revenue per lead" value={m.revenuePerLead ? fmtCurrency(m.revenuePerLead) : '—'} color="#185fa5" />
            <Mini label="Avg job value" value={m.avgJobValue ? fmtCurrency(m.avgJobValue) : '—'} />
            <Mini label="Revenue generated" value={fmtCurrency(m.webRevenue)} color="#0a7c4e" />
          </div>
        </Card>

        {/* ROI summary */}
        <Card className="p-4">
          <div className={CT}>ROI summary — Google Ads</div>
          {([
            ['Google Ads spend', fmtCurrency(m.googleSpend)],
            ['Facebook/Instagram spend', fmtCurrency(m.fbSpend)],
            ['Revenue from Google leads', fmtCurrency(m.webRevenue)],
            null,
            ['Gross profit from ads', m.webRevenue - m.googleSpend >= 0
              ? fmtCurrency(m.webRevenue - m.googleSpend)
              : '−' + fmtCurrency(m.googleSpend - m.webRevenue)],
            ['ROI', m.roi === null ? 'Log spend to calculate' : `${m.roi.toFixed(1)}%`],
          ] as ([string, string] | null)[]).map((r, i) => r === null
            ? <hr key={i} className="border-none border-t border-black/[0.08] my-1.5" />
            : (
              <div key={i} className="flex justify-between py-1.5 border-b border-black/[0.05]">
                <span className="text-[12.5px]">{r[0]}</span>
                <span className="font-bold" style={{
                  color: r[0] === 'ROI' ? roiColor
                    : r[0].includes('profit') ? (m.webRevenue - m.googleSpend >= 0 ? '#0a7c4e' : '#dc2626')
                    : undefined,
                }}>{r[1]}</span>
              </div>
            ))}
          <div className="mt-3.5 bg-[#f0fdf4] rounded-lg px-3 py-2.5">
            <div className="text-[11px] text-[#166534] font-semibold mb-1">What this means</div>
            <div className="text-xs text-[#166534]">{roiAdvice}</div>
          </div>
        </Card>
      </div>

      {/* Job type breakdown */}
      <Card className="p-4 mb-3.5">
        <div className={CT}>Job type breakdown — Google leads</div>
        {m.typeRows.length ? (
          <div className="grid gap-3.5" style={{ gridTemplateColumns: '1fr 1fr' }}>
            <div>
              {m.typeRows.map(([type, d]) => (
                <div key={type} className="mb-2.5">
                  <div className="flex justify-between text-xs mb-1">
                    <span className="font-medium">{type}</span>
                    <span className="text-[#666]">
                      {d.count} lead{d.count === 1 ? '' : 's'} · {d.won} won{d.revenue ? ` · ${fmtCurrency(d.revenue)}` : ''}
                    </span>
                  </div>
                  <div className="bg-[#e5e7eb] rounded h-2 overflow-hidden">
                    <div className="h-2 bg-[#2563eb] rounded" style={{ width: `${Math.round((d.count / maxTypeCount) * 100)}%` }} />
                  </div>
                </div>
              ))}
            </div>
            <div>
              <div className="text-[11px] font-bold text-[#666] uppercase mb-2.5">By revenue</div>
              {(() => {
                const withRev = m.typeRows.filter(([, d]) => d.revenue > 0).sort((a, b) => b[1].revenue - a[1].revenue)
                if (!withRev.length) return <div className="text-xs text-[#666]">No completed jobs yet</div>
                return (
                  <>
                    {withRev.map(([type, d]) => (
                      <div key={type} className="flex justify-between py-1.5 border-b border-black/[0.05] text-xs">
                        <span>{type}</span>
                        <span className="font-bold text-[#0a7c4e]">{fmtCurrency(d.revenue)}</span>
                      </div>
                    ))}
                    <div className="mt-2.5 bg-[#f0fdf4] rounded-lg px-2.5 py-2 text-[11px] text-[#166534]">
                      <strong>Best performing type:</strong> {withRev[0][0]} — {fmtCurrency(withRev[0][1].revenue)} revenue from Google leads
                    </div>
                  </>
                )
              })()}
            </div>
          </div>
        ) : (
          <div className="text-center py-5 text-[#666] text-[13px]">
            No Google leads tracked yet. Tag jobs with Lead source: Website / Google to see breakdown.
          </div>
        )}
      </Card>

      {/* Monthly breakdown */}
      {m.monthRows.length > 0 && (
        <Card className="overflow-hidden mb-3.5">
          <div className="px-3.5 py-3 text-[11px] font-bold text-[#666] uppercase border-b border-black/[0.12]">Monthly breakdown</div>
          <div className="overflow-auto max-h-[50vh]">
            <table className="w-full border-collapse text-[12.5px]">
              <thead>
                <tr>
                  {['Month','Ad spend','Leads','Won','Completed','Revenue','ROI'].map((h, i) => (
                    <th key={i} className={`px-2.5 py-[7px] border-b border-black/[0.12] text-[#666] font-medium whitespace-nowrap bg-[#fafaf8] sticky top-0 z-[2] ${i ? 'text-right' : 'text-left'}`}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {m.monthRows.map(([period, d]) => {
                  const mRoi = d.spend > 0 ? ((d.revenue - d.spend) / d.spend) * 100 : null
                  const [yr, mo] = period.split('-')
                  const label = new Date(parseInt(yr), parseInt(mo) - 1, 1).toLocaleDateString('en-AU', { month: 'short', year: 'numeric' })
                  return (
                    <tr key={period} className="border-b border-black/[0.06]">
                      <td className="px-2.5 py-[7px] font-medium">{label}</td>
                      <td className="px-2.5 py-[7px] text-right text-[#dc2626]">{fmtCurrency(d.spend)}</td>
                      <td className="px-2.5 py-[7px] text-right">{d.leads}</td>
                      <td className="px-2.5 py-[7px] text-right">{d.won}</td>
                      <td className="px-2.5 py-[7px] text-right">{d.finished}</td>
                      <td className="px-2.5 py-[7px] text-right font-semibold text-[#0a7c4e]">{d.revenue ? fmtCurrency(d.revenue) : '—'}</td>
                      <td className="px-2.5 py-[7px] text-right font-bold" style={{
                        color: mRoi === null ? '#666' : mRoi >= 100 ? '#16a34a' : mRoi >= 0 ? '#d97706' : '#dc2626',
                      }}>{mRoi === null ? '—' : `${mRoi.toFixed(0)}%`}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Spend log */}
      <Card className="overflow-hidden">
        <div className="px-3.5 py-3 text-[11px] font-bold text-[#666] uppercase border-b border-black/[0.12]">Ad spend log</div>
        <div className="overflow-auto max-h-[50vh]">
          <table className="w-full border-collapse text-[12.5px]">
            <thead>
              <tr>
                {['Date','Platform','Amount','Notes',''].map((h, i) => (
                  <th key={i} className="text-left px-2.5 py-[7px] border-b border-black/[0.12] text-[#666] font-medium whitespace-nowrap bg-[#fafaf8] sticky top-0 z-[2]">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[...ads].sort((a, b) => (b.date || '').localeCompare(a.date || '')).map(a => (
                <tr key={a.id} className="border-b border-black/[0.06] hover:bg-[#fafaf8]">
                  <td className="px-2.5 py-[7px]">{a.date || '—'}</td>
                  <td className="px-2.5 py-[7px]">{a.platform || '—'}</td>
                  <td className="px-2.5 py-[7px] font-medium">{fmtCurrency(a.amount)}</td>
                  <td className="px-2.5 py-[7px] text-[#666]">{a.notes || ''}</td>
                  <td className="px-2.5 py-[7px]">
                    <button onClick={() => { if (confirm('Delete this entry?')) del.mutate(a.id) }}
                      className="px-1.5 py-1 rounded-md bg-white border border-black/20 hover:bg-[#f5f4f0] text-[#c0392b]"><Trash2 size={12} /></button>
                  </td>
                </tr>
              ))}
              {ads.length === 0 && (
                <tr><td colSpan={5} className="text-center py-5 text-[#666]">No ad spend logged yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <Modal open={modal} onClose={() => setModal(false)} title="Log Ad Spend">
        <div className="grid grid-cols-2 gap-3">
          <Input label="Date" type="date" value={form.date || ''} onChange={e => setForm(p => ({ ...p, date: e.target.value }))} />
          <Select label="Platform" value={form.platform || 'Google Ads'} onChange={e => setForm(p => ({ ...p, platform: e.target.value }))} options={PLATFORMS} />
          <Input label="Amount ($)" type="number" step="0.01" value={form.amount ?? ''} onChange={e => setForm(p => ({ ...p, amount: e.target.value }))} />
          <Input label="Notes" value={form.notes || ''} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} />
        </div>
        <div className="flex justify-end gap-2 mt-5 pt-4 border-t border-black/10">
          <button onClick={() => setModal(false)} className="px-4 py-2 text-[13px] rounded-lg bg-[#f5f4f0] text-gray-600 border border-black/10 hover:bg-gray-200">Cancel</button>
          <button onClick={save} className="px-5 py-2 text-[13px] rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold">Save</button>
        </div>
      </Modal>
    </div>
  )
}
