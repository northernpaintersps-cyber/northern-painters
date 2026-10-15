// The quote document.
//
// Lifted out of QuotingTool unchanged, because three things needed it out
// here: the combined-parts document builds on the same pieces, the letterhead
// has to read your business settings instead of the literals it was carrying,
// and none of it could be tested while it was private to a page component.
//
// Everything below the header is as it was, so a single-line quote prints
// byte for byte what it printed before — which a test pins against output
// captured from the old implementation.

import type { BusinessSettings } from '@/pages/SettingsPage'

export function defaultQuoteNo(): string {
  const d = new Date()
  return String(d.getDate()).padStart(2, '0') + String(d.getMonth() + 1).padStart(2, '0')
    + String(d.getFullYear()).slice(-2)
}

// The standard wording V16 pre-fills its export dialog with. These are what the
// client actually reads, so they stay fixed rather than carrying internal detail.
export const QUOTE_INCLUSIONS = [
  'All surface preparation as described',
  'Supply and application of all specified paint systems',
  'Masking and protection of adjacent areas',
  'Full site clean-up and removal of waste',
]
/** Surface preparation reads differently per trade. Cabinets are degreased and
 *  scuffed rather than filled and gapped, so the job type picks the list. */
const SURFACE_PREP_STANDARD = [
  'Fill and sand all nail, screw and imperfection penetrations to a smooth finish',
  'Seal paintable gaps at joints, trims and corners with flexible paintable sealant',
  'Spot-prime all bare, cut or exposed substrates as required',
  'Light sanding and dust-off between coats',
  'Final tack-off and inspection prior to each coat',
]
const SURFACE_PREP_BY_TYPE: Record<string, string[]> = {
  'Kitchen cabinets': [
    'Cleaning and degreasing',
    'Sanding/scuffing',
    'Priming',
    'Light sanding and dust-off between coats',
    'Final tack-off and inspection prior to each coat',
  ],
}
export const surfacePrepFor = (jobType: string): string[] =>
  SURFACE_PREP_BY_TYPE[jobType] ?? SURFACE_PREP_STANDARD

export const QUOTE_EXCLUSIONS = [
  'Supply or installation of scaffolding',
  'Repairs to defective substrates beyond standard preparation',
  'Repainting required due to damage by other trades after completion',
  'Changes to colours or finishes beyond the approved schedule',
]
export const QUOTE_TERMS_TEXT =
  'Progress claims will be required for the duration of works. The schedule and '
  + 'milestone breakdown are to be agreed with the client prior to commencement. '
  + 'A deposit may be required to secure the booking and purchase materials.'

export function buildQuoteHTML(o: {
  docType: string; to: string; proj: string; site: string
  /** Kept separate from proj, which the user may retitle freely. */
  jobType: string
  qno: string; dur: string
  /** Letterhead and footer from Settings. Omitted, the literals below stand. */
  biz?: {
    website?: string; phone?: string; address?: string
    licence?: string; abn?: string
    quote_footer?: string; quote_valid_days?: number
  } | null
  /** `part` is set only when the quote is priced in groups. */
  coatRows: { sub: string; sys: string; coats: string; app: string; mat: string; part?: string }[]
  lines: { desc: string; total: number }[]
  origin: string
}): string {
  const esc = (v: any) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const money = (n: number) => '$' + n.toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const date = new Date().toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' })
  const fileTitle = [o.docType, o.qno, `${o.site} ${o.proj}`.trim()].filter(Boolean)
    .join('_').replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '')

  const exGST = o.lines.reduce((s, l) => s + l.total, 0)
  const bullets = (items: string[]) => items.map(x => `<li>${esc(x)}</li>`).join('')
  const scope = `This quotation covers the supply and application of all specified coating `
    + `systems to ${o.site}. Works include surface preparation, priming where required, and `
    + `application of finish coats to all nominated substrates, in accordance with the `
    + `finishes schedule and AS/NZS 2311:2017.`

  // V16 falls back to a hardcoded ceilings/walls/trims example when nothing is
  // quoted. That puts work the client is not buying into a document they sign,
  // so the section is left out instead.
  // The Part column appears only when the quote is split, so an ordinary
  // quote's table is exactly as it was.
  const showPart = o.coatRows.some(r => r.part)
  const coatBody = o.coatRows
    .map(r => `<tr>${showPart ? `<td>${esc(r.part || '')}</td>` : ''}`
      + `<td>${esc(r.sub)}</td><td>${esc(r.sys)}</td>`
      + `<td style="text-align:center">${esc(r.coats)}</td>`
      + `<td>${esc(r.app)}</td><td>${esc(r.mat)}</td></tr>`)
    .join('')

  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${esc(fileTitle)}</title><style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:Arial,Helvetica,sans-serif;font-size:11.5px;color:#1a1a18;padding:28px 32px;max-width:860px;margin:0 auto}
.hdr{display:flex;justify-content:space-between;align-items:center;padding-bottom:14px;border-bottom:3px solid #1a1a18;margin-bottom:18px}
.contact{text-align:right;font-size:10.5px;color:#555;line-height:1.8}
h1{font-size:22px;font-weight:700;margin-bottom:14px}
.meta{display:grid;grid-template-columns:110px 1fr;gap:2px 10px;font-size:11.5px;margin-bottom:16px;max-width:420px}
.meta .lbl{font-weight:700}
h2{font-size:12px;font-weight:700;margin:14px 0 6px;border-bottom:1.5px solid #1a1a18;padding-bottom:3px;text-transform:uppercase;letter-spacing:.4px}
p{line-height:1.6;margin-bottom:8px}
ul{margin-left:18px;margin-bottom:8px}li{margin-bottom:3px;line-height:1.5}
table{width:100%;border-collapse:collapse;margin-bottom:10px;font-size:11px}
.ct th{background:#f0efec;padding:6px 8px;text-align:left;border:1px solid #ccc;font-size:10.5px;font-weight:700}
.ct td{border:1px solid #ccc;padding:5px 8px}
.pt th{background:#1a1a18;color:#fff;padding:7px 10px;text-align:left;font-size:11px}
.pt td{border:1px solid #ddd;padding:6px 10px}
.pt tr:nth-child(even) td{background:#fafaf8}
.tot-row td{font-weight:700;background:#f0efec;border:1px solid #ccc;padding:7px 10px}
.footer{display:flex;justify-content:space-between;align-items:flex-end;margin-top:24px;padding-top:12px;border-top:1px solid #ccc}
.gst-note{background:#fefce8;border:1px solid #fde68a;border-radius:6px;padding:8px 12px;font-size:11px;margin-top:6px;font-weight:600}
@media print{button{display:none}body{padding:16px}.pt,.ct{break-inside:avoid}h2{break-after:avoid}.footer{break-inside:avoid}}
</style></head><body contenteditable="true">
<div style="display:inline-block;background:${o.docType === 'Estimate' ? '#fefce8' : '#1a1a18'};color:${o.docType === 'Estimate' ? '#92400e' : '#fff'};font-size:11px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;padding:4px 12px;border-radius:4px;margin-bottom:14px">${esc(o.docType)}</div>
<div class="hdr">
  <img src="${o.origin}/np-logo.png" alt="Northern Painters" style="width:300px;height:auto;display:block">
  <div class="contact">${esc(o.biz?.website || 'www.northernpaintersps.com.au')}<br>Ph: ${esc(o.biz?.phone || '0449 783 461')}<br>${esc(o.biz?.address || 'Northern Rivers NSW')}<br><span style="font-size:9.5px;color:#aaa">Lic. No: ${esc(o.biz?.licence || '478971C')} &nbsp;|&nbsp; ABN ${esc(o.biz?.abn || '46 435 825 953')}</span></div>
</div>
<h1>${esc(o.docType)}</h1>
<div class="meta">
  <span class="lbl">To:</span><span>${esc(o.to)}</span>
  <span class="lbl">Project:</span><span>${esc(o.proj)}</span>
  <span class="lbl">Site Location:</span><span>${esc(o.site)}</span>
  <span class="lbl">Date Issued:</span><span>${date}</span>
  <span class="lbl">Quote No:</span><span>${esc(o.qno || '—')}</span>
</div>
<h2>Scope of Works</h2>
<p>${esc(scope)}</p>
<p><strong>Inclusions:</strong></p><ul>${bullets(QUOTE_INCLUSIONS)}</ul>
${coatBody ? `<h2>Coating System</h2>
<table class="ct"><thead><tr>${showPart ? '<th>Part</th>' : ''}<th>Substrate</th><th>System</th><th style="width:70px;text-align:center">Coats</th><th>Application Method</th><th>Materials</th></tr></thead>
<tbody>${coatBody}</tbody></table>` : ''}
<h2>Surface Preparation</h2>
<ul>${bullets(surfacePrepFor(o.jobType))}</ul>
<h2>Exclusions</h2><ul>${bullets(QUOTE_EXCLUSIONS)}</ul>
<h2>Work Plan and Duration</h2>
<ul><li>Estimated duration: <strong>${esc(o.dur || 'To be confirmed')}</strong></li><li>Works subject to access availability and weather conditions</li><li>Scheduling to be confirmed prior to commencement</li></ul>
<h2>Standards and Compliances</h2>
<ul>
  <li>AS/NZS 2311:2017 — Guide to the Painting of Buildings</li>
  <li>Manufacturer technical data sheets and specified curing requirements</li>
  <li>NSW Guide to Standards and Tolerances (2017) — workmanship expectations</li>
</ul>
<h2>Completion and Handover</h2>
<ul>
  <li>Removal of all masking, protection and associated materials</li>
  <li>Full site clean-up on completion</li>
  <li>Final walkthrough inspection with client prior to sign-off</li>
</ul>
<h2>Pricing</h2>
<table class="pt"><thead><tr><th style="width:55px">Qty</th><th>Description</th><th style="width:110px">Price</th><th style="width:110px">Total</th></tr></thead>
<tbody>
${o.lines.map(l => `<tr><td>1</td><td>${esc(l.desc)}</td><td style="text-align:right">${money(l.total)}</td><td style="text-align:right;font-weight:600">${money(l.total)}</td></tr>`).join('')}
</tbody>
<tfoot>
<tr><td colspan="2"></td><td style="text-align:right;padding:7px 10px;border:1px solid #ddd;font-weight:700">Total ex GST</td><td class="tot-row">${money(exGST)}</td></tr>
</tfoot></table>
<div class="gst-note">Note: 10% GST to be added on top of the quoted price. Total inc. GST: <strong>${money(exGST * 1.1)}</strong></div>${o.biz?.quote_valid_days ? `
<p style="font-size:11px;color:#666;margin-top:6px">This quotation is valid for ${o.biz.quote_valid_days} days from the date issued.</p>` : ''}
<h2>Variations Clause</h2>
<p>Any changes, additional works or variations requested by the client or builder will require a written variation order or revised quotation and may incur additional charges. Work will not proceed on variations until written approval is received.</p>
<h2>Progress Claims and Payment Terms</h2>
<p>${esc(QUOTE_TERMS_TEXT)}</p>
<div class="footer">
  <div style="display:flex;gap:16px;align-items:center">
    <img src="${o.origin}/ft-logo.png" alt="NSW Fair Trading Licensed Contractor" style="height:70px;width:auto">
    <img src="${o.origin}/dulux-badge.png" alt="Dulux Accredited Painter — 5 year workmanship warranty" style="height:60px;width:auto">
  </div>
  <div style="text-align:right">
    <div style="font-size:13px;font-weight:700">NORTHERN PAINTERS</div>
    <div style="font-size:9.5px;color:#666">PAINTING SOLUTIONS<br>Lic. No: ${esc(o.biz?.licence || '478971C')} | ABN ${esc(o.biz?.abn || '46 435 825 953')}</div>
  </div>
</div>
<br><button onclick="window.print()" style="margin-top:12px;padding:10px 24px;background:#1a1a18;color:#fff;border:none;border-radius:6px;font-size:13px;cursor:pointer">Print / Save as PDF</button>
</body></html>`
}
