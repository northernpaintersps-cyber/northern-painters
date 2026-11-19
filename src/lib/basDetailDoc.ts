// The BAS detail, typeset.
//
// lib/basDetail.ts answers what the figures are; this answers what they look
// like on a page. The CSV there is for an accountant's spreadsheet, where the
// point is to be parsed. This is for the same person reading it, where the
// point is to be read — a quarter checked without widening columns.
//
// One page's worth of structure and no more. The three totals he asked for sit
// at the top because they are the answer; everything below is the evidence for
// them. Money is right-aligned with tabular figures so a column of amounts can
// be scanned rather than read, GST sits beside each amount rather than in a
// second report, and every category carries its own subtotal so a figure can
// be queried without anyone adding up a page by hand.
//
// It prints: the header row repeats across pages, rows do not split across a
// break, and a category heading will not strand itself at the foot of one.

import {
  salesDetail, purchaseDetail, type BASDetailInput, type DetailRow,
} from './basDetail'
import { quarterRange, quarterLabel } from './fy'

const r2 = (x: number) => Math.round(x * 100) / 100

const h = (v: unknown): string =>
  String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

/** 2026-09-30 reads as 30/09/2026 — the way the statements print it. */
const dmy = (iso: string): string => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso
}

const amt = (x: number): string =>
  (x < 0 ? '-$' : '$') + Math.abs(x).toLocaleString('en-AU', {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  })

const STYLE = `
  :root { --ink:#1a1a1a; --mute:#6b6b6b; --rule:rgba(0,0,0,.1); --bg:#fff;
          --band:#f5f4f0; --green:#0a7c4e; --red:#b3261e }
  * { box-sizing:border-box }
  body { margin:0; background:var(--bg); color:var(--ink);
         font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;
         -webkit-print-color-adjust:exact; print-color-adjust:exact }
  .sheet { max-width:980px; margin:0 auto; padding:28px 24px 48px }
  header { border-bottom:2px solid var(--ink); padding-bottom:12px; margin-bottom:18px }
  h1 { font-size:21px; margin:0 0 2px; letter-spacing:-.01em }
  .period { font-size:13px; color:var(--mute) }
  .firm { font-size:13px; font-weight:600; margin-top:6px }
  .note { font-size:11.5px; color:var(--mute); margin-top:8px; line-height:1.45; max-width:68ch }

  .cards { display:grid; gap:10px; grid-template-columns:repeat(auto-fit,minmax(190px,1fr));
           margin:0 0 6px }
  .card { background:var(--band); border-radius:10px; padding:13px 15px }
  .card .k { font-size:10.5px; color:var(--mute); text-transform:uppercase;
             letter-spacing:.05em; margin-bottom:4px }
  .card .v { font-size:21px; font-weight:650; font-variant-numeric:tabular-nums;
             letter-spacing:-.02em }
  .card .n { font-size:11px; color:var(--mute); margin-top:3px }

  h2 { font-size:12px; text-transform:uppercase; letter-spacing:.07em; color:var(--mute);
       margin:28px 0 8px; padding-bottom:5px; border-bottom:1px solid var(--rule) }
  h3 { font-size:13px; margin:18px 0 5px; font-weight:650 }

  table { width:100%; border-collapse:collapse; font-size:12.5px; margin-bottom:2px }
  th { text-align:left; font-size:10.5px; text-transform:uppercase; letter-spacing:.05em;
       color:var(--mute); font-weight:600; padding:0 8px 5px 0;
       border-bottom:1px solid var(--rule) }
  td { padding:5px 8px 5px 0; border-bottom:1px solid rgba(0,0,0,.05); vertical-align:top }
  tbody tr:nth-child(even) { background:rgba(0,0,0,.016) }
  .d { width:74px; white-space:nowrap; color:var(--mute) }
  .p { font-weight:500 }
  .desc { color:var(--mute) }
  .ref { width:116px; font-size:11px; color:var(--mute); word-break:break-word }
  .m { width:116px; text-align:right; white-space:nowrap; padding-right:0;
       font-variant-numeric:tabular-nums }
  .g { width:96px }
  tr.sub td { font-weight:650; border-top:1px solid var(--ink); border-bottom:none;
              padding-top:6px; background:none }
  tr.grand td { font-size:14px; font-weight:700; border-top:2px solid var(--ink);
                border-bottom:none; padding-top:9px; background:none }
  .empty { color:var(--mute); font-style:italic; padding:8px 0 }

  @media print {
    body { font-size:11pt }
    .sheet { max-width:none; padding:0 }
    table { font-size:9.5pt }
    thead { display:table-header-group }
    tr { page-break-inside:avoid }
    h3 { page-break-after:avoid }
    .cards { grid-template-columns:repeat(4,1fr) }
  }
  @media (max-width:560px) {
    .sheet { padding:18px max(16px,env(safe-area-inset-left,0px)) 40px }
    .ref, th.ref { display:none }
    .d { width:62px }
    .m { width:98px }
  }
`

export function basDetailHTML(
  input: BASDetailInput,
  biz?: Partial<{ company_name: string; abn: string }> | null,
): string {
  const { year, quarter } = input
  const [from, to] = quarterRange(year, quarter)
  const sales = salesDetail(input)
  const groups = purchaseDetail(input)
  const b = biz ?? {}

  const salesInc = r2(sales.reduce((s, r) => s + r.amountIncGST, 0))
  const salesGST = r2(sales.reduce((s, r) => s + r.gst, 0))
  const purchInc = r2(groups.reduce((s, g) => s + g.amountIncGST, 0))
  const purchGST = r2(groups.reduce((s, g) => s + g.gst, 0))
  const netGST = r2(salesGST - purchGST)
  // The plural is given, not guessed: "7 categorys" was on the page before
  // anyone read it, which is what rendering the thing is for.
  const plural = (nn: number, one: string, many = `${one}s`) =>
    `${nn} ${nn === 1 ? one : many}`

  // A dash, not $0.00: a GST-free purchase carried no GST, and a column of
  // zeroes reads as a column of figures to check.
  const row = (r: DetailRow): string =>
    `<tr><td class="d">${h(dmy(r.date))}</td>`
    + `<td class="p">${h(r.party)}</td>`
    + `<td class="desc">${h(r.description)}</td>`
    + `<td class="ref">${h(r.reference)}</td>`
    + `<td class="m">${h(amt(r.amountIncGST))}</td>`
    + `<td class="m g">${r.gst ? h(amt(r.gst)) : '&mdash;'}</td></tr>`

  const thead = (party: string): string =>
    `<thead><tr><th class="d">Date</th><th class="p">${h(party)}</th>`
    + '<th class="desc">Description</th><th class="ref">Reference</th>'
    + '<th class="m">Amount inc GST</th><th class="m g">GST</th></tr></thead>'

  const subtotal = (label: string, inc: number, gst: number, cls = 'sub'): string =>
    `<tr class="${cls}"><td colspan="4">${h(label)}</td>`
    + `<td class="m">${h(amt(inc))}</td><td class="m g">${h(amt(gst))}</td></tr>`

  const salesBlock = sales.length
    ? `<table>${thead('Received from')}<tbody>${sales.map(row).join('')}</tbody>`
      + `<tfoot>${subtotal(`Total — ${plural(sales.length, 'invoice')}`, salesInc, salesGST)}</tfoot></table>`
    : '<div class="empty">No sales received in this period.</div>'

  const purchaseBlock = groups.length
    ? groups.map(g =>
        `<h3>${h(g.category)}</h3><table>${thead('Paid to')}`
        + `<tbody>${g.rows.map(row).join('')}</tbody>`
        + `<tfoot>${subtotal(`Subtotal — ${g.category} (${plural(g.rows.length, 'item')})`, g.amountIncGST, g.gst)}</tfoot>`
        + '</table>').join('')
      + `<table><tbody>${subtotal(`Total purchases — ${plural(groups.length, 'category', 'categories')}`, purchInc, purchGST, 'grand')}</tbody></table>`
    : '<div class="empty">No purchases in this period.</div>'

  return `<!doctype html>
<html lang="en-AU"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>BAS detail — ${h(quarterLabel(year, quarter))}</title>
<style>${STYLE}</style></head><body><div class="sheet">
<header>
  <h1>BAS detail — ${h(quarterLabel(year, quarter))}</h1>
  <div class="period">${h(dmy(from))} to ${h(dmy(to))}</div>
  <div class="firm">${h(b.company_name || 'Northern Painters')}${b.abn ? ` &middot; ABN ${h(b.abn)}` : ''}</div>
  <div class="note">${input.basis === 'cash'
    ? 'Cash basis: sales are counted on the date payment was received.'
    : 'Accrual basis: sales are counted on the date the invoice was issued.'}
    Cash-paid purchases and cash jobs are excluded throughout — no GST is claimed or
    collected on either. A description is shown only where the payee does not already
    say it.</div>
</header>
<div class="cards">
  <div class="card"><div class="k">Sales received, inc GST</div>
    <div class="v" style="color:var(--green)">${h(amt(salesInc))}</div>
    <div class="n">${h(plural(sales.length, 'invoice'))}</div></div>
  <div class="card"><div class="k">GST included</div>
    <div class="v">${h(amt(salesGST))}</div><div class="n">GST on those sales</div></div>
  <div class="card"><div class="k">GST on purchases</div>
    <div class="v">${h(amt(purchGST))}</div>
    <div class="n">${h(amt(purchInc))} inc GST</div></div>
  <div class="card"><div class="k">Net GST</div>
    <div class="v" style="color:${netGST > 0 ? 'var(--red)' : 'var(--green)'}">${h(amt(netGST))}</div>
    <div class="n">${netGST > 0 ? 'payable to the ATO' : netGST < 0 ? 'refundable' : 'nothing owing'}</div></div>
</div>
<h2>Sales received</h2>
${salesBlock}
<h2>Purchases and expenses, by category</h2>
${purchaseBlock}
</div></body></html>`
}
