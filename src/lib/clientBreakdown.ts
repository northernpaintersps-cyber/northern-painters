// The breakdown you hand a client when they ask what they are paying for.
//
// A builder rings and asks to see the labour and materials behind a figure.
// Until now the only answer was the job page, which cannot be shown to anyone:
// it carries what the work COST you in a column beside what it charges, which
// is the margin, which is nobody's business but yours.
//
// So this builds a list from the charge side only, and never imports a cost
// helper. A test asserts that — `labCost`, `matCost` and `lineCost` must not
// appear in this file, because one of them slipping into a client document is
// not a bug you find later, it is a bug the client finds first.
//
// ── What is left out, and what is yours to decide ───────────
//
// Work nobody is charged for is always left out. A line marked Not billable —
// coming back to make good a defect — has a charge of nil. Listing it invites
// an argument about whether it should be credited, when it already has been.
//
// Who did the work is a choice, and it defaults to no. invoiceableLines builds
// a labour description as `sub — labour_desc`, so the subcontractor's name is
// in the string by default, and in a client's inbox that tells a builder who
// you engage and lets them work out what you pay. So labour reads as its phase
// unless you ask for the full log, which some clients do and which is a
// perfectly reasonable thing to hand over — see LabourDetail below.

import type { InvoiceableLine } from './jobBilling'

type Row = Record<string, any>

const n = (v: unknown) => { const x = Number(v); return Number.isFinite(x) ? x : 0 }
const r2 = (v: number) => Math.round(v * 100) / 100

/** Which kinds of line the client asked about. */
export type BreakdownKind = 'all' | 'labour' | 'materials'
export const BREAKDOWN_KINDS: { id: BreakdownKind; label: string }[] = [
  { id: 'all', label: 'Labour and materials' },
  { id: 'labour', label: 'Labour only' },
  { id: 'materials', label: 'Materials only' },
]

/**
 * How much of the labour log the client sees.
 *
 *   phase    One row per phase of the job — "Preparation — 14 hrs". What a
 *            client usually means by a breakdown.
 *   entries  Every entry as it was logged, by date and task, but not by whom.
 *   full     Every entry with the name of who carried it out. The whole log.
 *            Hands the builder your subcontractors, which is sometimes exactly
 *            what is wanted and is never the default.
 */
export type LabourDetail = 'phase' | 'entries' | 'full'
export const LABOUR_DETAIL: { id: LabourDetail; label: string; hint: string }[] = [
  { id: 'phase', label: 'By phase', hint: 'One row per phase of the job' },
  { id: 'entries', label: 'Every entry', hint: 'Each day logged, with the task' },
  { id: 'full', label: 'Full log', hint: 'Each day logged, with the task and who did it' },
]

/** One line as the client sees it. Charge only — never a cost or a margin. */
export interface ClientLine {
  id: string
  kind: 'labour' | 'material'
  date: string
  description: string
  /** Labour only. Lets the list read "42 hrs" and derive a rate if asked. */
  hours?: number
  /**
   * Labour only — the phase on its own, without the note that qualifies it.
   *
   * Kept apart from `description` because grouping has to be by phase and not
   * by the whole string: "Preparation — cutting in" and "Preparation" are the
   * same phase of the job, and grouping on the description would show the
   * client two preparation rows where there was one phase of preparation.
   */
  phase?: string
  chargeExGST: number
}

/**
 * Labour described for the client. The worker's name goes on the front only
 * on the full log, because `invoiceableLines` would otherwise carry it into
 * every document by default.
 */
export function labourDescription(row: Row | undefined, detail: LabourDetail = 'phase'): string {
  const phase = String(row?.phase_name ?? '').trim()
  const desc = String(row?.labour_desc ?? '').trim()
  // The phase is the useful half — "Preparation", "Second coat". Where both
  // exist the phase leads and the note qualifies it.
  const parts = [phase, desc].filter(Boolean)
  // A note that merely repeats the phase is not worth printing twice.
  if (parts.length === 2 && parts[1].toLowerCase() === parts[0].toLowerCase()) parts.pop()
  const what = parts.join(' — ') || 'Painting labour'
  const worker = detail === 'full' ? String(row?.sub ?? '').trim() : ''
  return worker ? `${worker} — ${what}` : what
}

/** Materials described by product, with the supplier only if you want it shown. */
export function materialDescription(row: Row | undefined, showSupplier = false): string {
  const desc = String(row?.mat_desc ?? '').trim()
  const supplier = String(row?.supplier ?? '').trim()
  if (showSupplier && supplier) return [supplier, desc].filter(Boolean).join(' — ')
  return desc || 'Paint and materials'
}

/**
 * The client-facing lines for a job.
 *
 * `lines` comes from invoiceableLines, so the charge arithmetic — rate
 * overrides, materials markup — stays in one place and this cannot disagree
 * with the invoice. The raw rows come along only to describe each line
 * without the subcontractor's name.
 */
export function clientLines(input: {
  lines: InvoiceableLine[]
  labour?: Row[]
  materials?: Row[]
  kind?: BreakdownKind
  showSupplier?: boolean
  /** 'full' puts the name of who did the work into each labour description. */
  labourDetail?: LabourDetail
}): ClientLine[] {
  const kind = input.kind ?? 'all'
  const detail = input.labourDetail ?? 'phase'
  const labourById = new Map((input.labour ?? []).map(r => [String(r.id), r]))
  const matById = new Map((input.materials ?? []).map(r => [String(r.id), r]))

  return input.lines
    // Nil charge means nobody is being billed for it. Not the client's list.
    .filter(l => !l.notBillable)
    .filter(l => kind === 'all'
      || (kind === 'labour' && l.kind === 'labour')
      || (kind === 'materials' && l.kind === 'material'))
    .map((l): ClientLine => ({
      id: l.id,
      kind: l.kind,
      date: l.date ?? '',
      description: l.kind === 'labour'
        ? labourDescription(labourById.get(l.id), detail)
        : materialDescription(matById.get(l.id), input.showSupplier),
      ...(l.kind === 'labour'
        ? {
            hours: r2(n(l.hours)),
            phase: String(labourById.get(l.id)?.phase_name ?? '').trim() || 'Painting labour',
          }
        : {}),
      chargeExGST: r2(n(l.amountExGST)),
    }))
    .sort((a, b) => (a.date || '').localeCompare(b.date || '')
      || a.kind.localeCompare(b.kind)
      || a.description.localeCompare(b.description))
}

/** Only the lines the tick boxes selected. An empty selection means all of them. */
export const selected = (rows: ClientLine[], picked?: Set<string> | null): ClientLine[] =>
  picked && picked.size ? rows.filter(r => picked.has(r.id)) : rows

export interface BreakdownTotals {
  labourHours: number
  labourExGST: number
  materialsExGST: number
  exGST: number
  gst: number
  incGST: number
}

/** What the selected lines come to. `gstRate` is 0 on a cash job. */
export function breakdownTotals(rows: ClientLine[], gstRate = 0.1): BreakdownTotals {
  const lab = rows.filter(r => r.kind === 'labour')
  const mat = rows.filter(r => r.kind === 'material')
  const labourExGST = r2(lab.reduce((s, r) => s + r.chargeExGST, 0))
  const materialsExGST = r2(mat.reduce((s, r) => s + r.chargeExGST, 0))
  const exGST = r2(labourExGST + materialsExGST)
  const gst = r2(exGST * gstRate)
  return {
    labourHours: r2(lab.reduce((s, r) => s + n(r.hours), 0)),
    labourExGST,
    materialsExGST,
    exGST,
    gst,
    incGST: r2(exGST + gst),
  }
}

export interface PhaseGroup { name: string; hours: number; chargeExGST: number }

/**
 * Labour gathered by phase, which is how a client reads it: one row for
 * preparation, one for each coat. Rows keep the order they were first seen in,
 * which is date order, so the list reads as the job progressed.
 */
export function groupLabourByPhase(rows: ClientLine[]): PhaseGroup[] {
  const out: PhaseGroup[] = []
  const at = new Map<string, PhaseGroup>()
  for (const r of rows) {
    if (r.kind !== 'labour') continue
    const key = r.phase || r.description
    let g = at.get(key)
    if (!g) { g = { name: key, hours: 0, chargeExGST: 0 }; at.set(key, g); out.push(g) }
    g.hours = r2(g.hours + n(r.hours))
    g.chargeExGST = r2(g.chargeExGST + r.chargeExGST)
  }
  return out
}

/**
 * The rate a line works out to, for the optional rate column.
 *
 * Derived from the charge and the hours rather than read from the labour row,
 * because the row's charge_rate is what was logged and the charge may have
 * been billed at an agreed rate instead. The figure shown has to be the one
 * that multiplies out to the total, or the client will do the division
 * themselves and find it does not.
 */
export const ratePerHour = (chargeExGST: number, hours: number | undefined): number | null => {
  const h = n(hours)
  return h > 0 ? r2(n(chargeExGST) / h) : null
}

// ── The two things you can do with it ────────────────────────

const money = (v: number) =>
  '$' + n(v).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const auDate = (d: string) => {
  if (!d) return ''
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d)
  return m ? `${m[3]}/${m[2]}/${m[1]}` : d
}

/** 8 reads as "8", 9.5 as "9.5", 9.25 as "9.25" — no trailing noughts. */
const hrs = (h: number) => {
  if (Math.round(h * 100) % 100 === 0) return String(Math.round(h))
  return h.toFixed(2).replace(/0$/, '')
}

export interface BreakdownOptions {
  /** Shown at the top so the client knows which job this answers. */
  jobTitle?: string
  client?: string
  site?: string
  /** 0 on a cash job — then no GST line is printed at all. */
  gstRate?: number
  /** Your charge rate per hour, beside each labour row. Off by default. */
  showRate?: boolean
  /**
   * How the labour reads. Must match what was passed to `clientLines`, or the
   * rows will carry a name the grouping then throws away.
   */
  labourDetail?: LabourDetail
  /** Prints the date each entry was logged. */
  showDates?: boolean
}

/**
 * A plain-text list, for pasting into the reply to the email that asked.
 *
 * Most of these questions arrive by email and want answering in the same
 * email, not as an attachment the builder has to open on a phone on site.
 */
export function buildBreakdownText(rows: ClientLine[], o: BreakdownOptions = {}): string {
  const gstRate = o.gstRate ?? 0.1
  const t = breakdownTotals(rows, gstRate)
  const showDates = o.showDates ?? true
  const out: string[] = []

  const head = [o.jobTitle, o.site].filter(Boolean).join(' — ')
  if (head) out.push(head)
  if (o.client) out.push(o.client)
  if (out.length) out.push('')

  const labour = rows.filter(r => r.kind === 'labour')
  if (labour.length) {
    out.push(`LABOUR${t.labourHours ? ` — ${hrs(t.labourHours)} hrs` : ''}`)
    const groups = (o.labourDetail ?? 'phase') === 'phase' ? groupLabourByPhase(rows) : null
    if (groups) {
      for (const g of groups) {
        const rate = o.showRate ? ratePerHour(g.chargeExGST, g.hours) : null
        out.push(`  ${g.name}${g.hours ? ` — ${hrs(g.hours)} hrs` : ''}`
          + `${rate != null ? ` @ ${money(rate)}/hr` : ''} — ${money(g.chargeExGST)}`)
      }
    } else {
      for (const r of labour) {
        const rate = o.showRate ? ratePerHour(r.chargeExGST, r.hours) : null
        out.push(`  ${showDates && r.date ? auDate(r.date) + '  ' : ''}${r.description}`
          + `${r.hours ? ` — ${hrs(r.hours)} hrs` : ''}`
          + `${rate != null ? ` @ ${money(rate)}/hr` : ''} — ${money(r.chargeExGST)}`)
      }
    }
    out.push(`  Labour total: ${money(t.labourExGST)}`)
    out.push('')
  }

  const mats = rows.filter(r => r.kind === 'material')
  if (mats.length) {
    out.push('MATERIALS')
    for (const r of mats) {
      out.push(`  ${showDates && r.date ? auDate(r.date) + '  ' : ''}${r.description} — ${money(r.chargeExGST)}`)
    }
    out.push(`  Materials total: ${money(t.materialsExGST)}`)
    out.push('')
  }

  if (!labour.length && !mats.length) return 'Nothing selected.'

  out.push(`Total ex GST: ${money(t.exGST)}`)
  if (gstRate > 0) {
    out.push(`GST: ${money(t.gst)}`)
    out.push(`Total inc GST: ${money(t.incGST)}`)
  }
  return out.join('\n')
}

const esc = (v: any) => String(v ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/**
 * The same list as a printable page, on your letterhead.
 *
 * Headed "Breakdown of works" rather than styled as an invoice: it is a
 * record of what was done, and a document that looks like a tax invoice but
 * is not one is a document somebody eventually tries to pay.
 */
export function buildBreakdownHTML(
  rows: ClientLine[],
  o: BreakdownOptions & {
    biz?: Partial<{
      company_name: string; website: string; phone: string; address: string
      licence: string; abn: string
    }> | null
    /** Where the letterhead images are served from. */
    origin?: string
  } = {},
): string {
  const gstRate = o.gstRate ?? 0.1
  const t = breakdownTotals(rows, gstRate)
  const showDates = o.showDates ?? true
  const biz = o.biz ?? {}
  const origin = o.origin ?? ''
  const date = new Date().toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' })

  const labour = rows.filter(r => r.kind === 'labour')
  const mats = rows.filter(r => r.kind === 'material')
  const groups = (o.labourDetail ?? 'phase') === 'phase' ? groupLabourByPhase(rows) : null

  const cols = (kind: 'labour' | 'material') => {
    const c: string[] = []
    if (showDates && !(kind === 'labour' && groups)) c.push('<th style="width:88px">Date</th>')
    c.push('<th>Description</th>')
    if (kind === 'labour') {
      c.push('<th style="width:70px;text-align:right">Hours</th>')
      if (o.showRate) c.push('<th style="width:90px;text-align:right">Rate</th>')
    }
    c.push('<th style="width:110px;text-align:right">Amount</th>')
    return c.join('')
  }

  const labourBody = groups
    ? groups.map(g => {
        const rate = o.showRate ? ratePerHour(g.chargeExGST, g.hours) : null
        return `<tr><td>${esc(g.name)}</td>`
          + `<td class="num">${g.hours ? hrs(g.hours) : '—'}</td>`
          + (o.showRate ? `<td class="num">${rate != null ? money(rate) : '—'}</td>` : '')
          + `<td class="num amt">${money(g.chargeExGST)}</td></tr>`
      }).join('')
    : labour.map(r => {
        const rate = o.showRate ? ratePerHour(r.chargeExGST, r.hours) : null
        return '<tr>'
          + (showDates ? `<td class="dt">${esc(auDate(r.date)) || '—'}</td>` : '')
          + `<td>${esc(r.description)}</td>`
          + `<td class="num">${r.hours ? hrs(r.hours) : '—'}</td>`
          + (o.showRate ? `<td class="num">${rate != null ? money(rate) : '—'}</td>` : '')
          + `<td class="num amt">${money(r.chargeExGST)}</td></tr>`
      }).join('')

  const matsBody = mats.map(r => '<tr>'
    + (showDates ? `<td class="dt">${esc(auDate(r.date)) || '—'}</td>` : '')
    + `<td>${esc(r.description)}</td>`
    + `<td class="num amt">${money(r.chargeExGST)}</td></tr>`).join('')

  /**
   * How many columns that section's table has, so the subtotal row spans all
   * but the last and its figure lands under Amount. Starts at two — the
   * description and the amount itself — and must agree with `cols` above.
   */
  const span = (kind: 'labour' | 'material') => {
    let c = 2
    if (showDates && !(kind === 'labour' && groups)) c++
    if (kind === 'labour') { c++; if (o.showRate) c++ }
    return c
  }

  const meta: string[] = []
  if (o.client) meta.push(`<span class="lbl">To:</span><span>${esc(o.client)}</span>`)
  if (o.jobTitle) meta.push(`<span class="lbl">Project:</span><span>${esc(o.jobTitle)}</span>`)
  if (o.site) meta.push(`<span class="lbl">Site:</span><span>${esc(o.site)}</span>`)
  meta.push(`<span class="lbl">Date:</span><span>${date}</span>`)

  const title = ['Breakdown of works', o.jobTitle, o.site].filter(Boolean).join(' — ')

  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${esc(title)}</title><style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:Arial,Helvetica,sans-serif;font-size:11.5px;color:#1a1a18;padding:28px 32px;max-width:860px;margin:0 auto}
.hdr{display:flex;justify-content:space-between;align-items:center;padding-bottom:14px;border-bottom:3px solid #1a1a18;margin-bottom:18px}
.contact{text-align:right;font-size:10.5px;color:#555;line-height:1.8}
h1{font-size:22px;font-weight:700;margin-bottom:14px}
.meta{display:grid;grid-template-columns:90px 1fr;gap:2px 10px;font-size:11.5px;margin-bottom:16px;max-width:420px}
.meta .lbl{font-weight:700}
h2{font-size:12px;font-weight:700;margin:18px 0 6px;border-bottom:1.5px solid #1a1a18;padding-bottom:3px;text-transform:uppercase;letter-spacing:.4px}
p{line-height:1.6;margin-bottom:8px}
table{width:100%;border-collapse:collapse;margin-bottom:6px;font-size:11px}
th{background:#f0efec;padding:6px 8px;text-align:left;border:1px solid #ccc;font-size:10.5px;font-weight:700}
td{border:1px solid #ddd;padding:5px 8px}
tr:nth-child(even) td{background:#fafaf8}
td.num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
td.amt{font-weight:600}
td.dt{white-space:nowrap;color:#555}
.sub td{font-weight:700;background:#f0efec !important;border:1px solid #ccc}
.grand{margin-top:14px;margin-left:auto;width:min(320px,100%);border-collapse:collapse}
.grand td{border:none;padding:4px 8px;font-size:12px}
.grand td:last-child{text-align:right;font-variant-numeric:tabular-nums}
.grand tr.big td{font-weight:700;font-size:13px;border-top:2px solid #1a1a18;padding-top:7px}
.note{font-size:10.5px;color:#666;margin-top:18px;line-height:1.6}
.footer{display:flex;justify-content:space-between;align-items:flex-end;margin-top:24px;padding-top:12px;border-top:1px solid #ccc}
@media print{button{display:none}body{padding:16px}table{break-inside:avoid}h2{break-after:avoid}.footer{break-inside:avoid}}
</style></head><body>
<div class="hdr">
  ${origin ? `<img src="${origin}/np-logo.png" alt="${esc(biz.company_name || 'Northern Painters')}" style="width:300px;height:auto;display:block">`
    : `<div style="font-size:18px;font-weight:700">${esc(biz.company_name || 'Northern Painters')}</div>`}
  <div class="contact">${esc(biz.website || 'www.northernpaintersps.com.au')}<br>Ph: ${esc(biz.phone || '')}<br>${esc(biz.address || '')}<br><span style="font-size:9.5px;color:#aaa">Lic. No: ${esc(biz.licence || '')} &nbsp;|&nbsp; ABN ${esc(biz.abn || '')}</span></div>
</div>
<h1>Breakdown of Works</h1>
<div class="meta">${meta.join('')}</div>
${labour.length ? `<h2>Labour</h2>
<table><thead><tr>${cols('labour')}</tr></thead><tbody>${labourBody}
<tr class="sub"><td colspan="${span('labour') - 1}">Labour${t.labourHours ? ` — ${hrs(t.labourHours)} hours` : ''}</td><td class="num">${money(t.labourExGST)}</td></tr>
</tbody></table>` : ''}
${mats.length ? `<h2>Materials</h2>
<table><thead><tr>${cols('material')}</tr></thead><tbody>${matsBody}
<tr class="sub"><td colspan="${span('material') - 1}">Materials</td><td class="num">${money(t.materialsExGST)}</td></tr>
</tbody></table>` : ''}
${!labour.length && !mats.length ? '<p>Nothing selected.</p>' : ''}
<table class="grand"><tbody>
<tr><td>Total ex GST</td><td>${money(t.exGST)}</td></tr>
${gstRate > 0 ? `<tr><td>GST</td><td>${money(t.gst)}</td></tr>
<tr class="big"><td>Total inc GST</td><td>${money(t.incGST)}</td></tr>`
  : `<tr class="big"><td>Total</td><td>${money(t.exGST)}</td></tr>`}
</tbody></table>
<p class="note">This is a breakdown of works carried out, provided for your records. It is not a tax invoice and is not a request for payment.</p>
<div class="footer">
  <div style="font-size:10.5px;color:#666">${esc(biz.company_name || 'Northern Painters')}${biz.licence ? ` &nbsp;|&nbsp; Lic. No: ${esc(biz.licence)}` : ''}${biz.abn ? ` &nbsp;|&nbsp; ABN ${esc(biz.abn)}` : ''}</div>
</div>
<br><button onclick="window.print()" style="margin-top:12px;padding:10px 24px;background:#1a1a18;color:#fff;border:none;border-radius:6px;font-size:13px;cursor:pointer">Print / Save as PDF</button>
</body></html>`
}
