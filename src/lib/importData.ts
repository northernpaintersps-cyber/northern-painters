import { supabase } from './supabase'

// ── Sanitisers ────────────────────────────────────────────────
function toDate(v: any): string | null {
  if (v == null || v === '' || v === 'null' || v === 'undefined') return null
  const s = String(v).trim()
  const dmySlash = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (dmySlash) {
    const [, d, m, y] = dmySlash
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
  }
  const dmyDash = s.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/)
  if (dmyDash) {
    const [, d, m, y] = dmyDash
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
  }
  return s
}
function toNum(v: any): number | null {
  if (v == null || v === '' || v === 'null' || v === 'undefined') return null
  const n = Number(v)
  return isNaN(n) ? null : n
}
function toBool(v: any): boolean {
  if (v == null || v === '') return false
  return Boolean(v)
}
function uid(prefix: string, ...parts: any[]): string {
  const base = parts.map(p => String(p ?? '').replace(/\s+/g, '').slice(0, 10)).join('-')
  return `${prefix}-${base || Date.now()}-${Math.random().toString(36).slice(2, 6)}`
}

// ── Mappers ───────────────────────────────────────────────────
function mapJob(j: any, userId: string) {
  return {
    id: j.id,
    user_id: userId,
    client: j.client ?? null,
    address: j.address ?? null,
    type: j.type ?? null,
    terms: j.terms ?? null,
    job_desc: j.desc ?? j.job_desc ?? null,
    status: j.jobStatus ?? j.status ?? null,
    quote_status: j.quoteStatus ?? j.quote_status ?? null,
    quote_ex_gst: toNum(j.quoteExGST ?? j.quote_ex_gst),
    agreed_ex_gst: toNum(j.agreedExGST ?? j.agreed_ex_gst),
    est_labour_ex: toNum(j.estLabourEx ?? j.est_labour_ex),
    est_materials_ex: toNum(j.estMaterialsEx ?? j.est_materials_ex),
    labour_rate: toNum(j.labourRate ?? j.labour_rate),
    sched_start: toDate(j.schedStart ?? j.sched_start),
    est_days: toNum(j.estDays ?? j.est_days),
    quote_no: j.quoteNo ?? j.quote_no ?? null,
    quote_sent: toDate(j.quoteSent ?? j.quote_sent),
    weather: j.weather ?? null,
    on_books: j.onBooks ?? j.on_books ?? null,
    lead_source: j.leadSource ?? j.lead_source ?? null,
    notes: j.notes ?? null,
    drive_link: j.driveLink ?? j.drive_link ?? null,
    assigned_crew: j.assignedCrew ?? j.assigned_crew ?? null,
    scheduled_dates: j.scheduledDates ?? j.scheduled_dates ?? [],
    attachments: j.attachments ?? [],
    extra: {},
    updated_at: j.updatedAt ?? j.updated_at ?? new Date().toISOString(),
    created_at: j.createdAt ?? j.created_at ?? new Date().toISOString(),
  }
}

function mapLabour(l: any, userId: string) {
  const id = l.entryId ?? l.id ?? uid('lab', l.jobId, l.date, l.sub)
  return {
    id,
    user_id: userId,
    job_id: l.jobId ?? l.job_id ?? null,
    client: l.client ?? null,
    date: toDate(l.date),
    sub: l.sub ?? null,
    hours: toNum(l.hours),
    rate: toNum(l.rate),
    cost: toNum(l.cost),
    charge_rate: toNum(l.chargeRate ?? l.charge_rate),
    billable: toNum(l.billable),
    billing_type: l.billingType ?? l.billing_type ?? null,
    paid: toBool(l.paid),
    worker_payment_type: l.workerPaymentType ?? l.worker_payment_type ?? 'ABN',
    labour_desc: l.desc ?? l.labour_desc ?? null,
    notes: l.notes ?? null,
    clock_in: toDate(l.clockIn ?? l.clock_in),
    clock_out: toDate(l.clockOut ?? l.clock_out),
    updated_at: new Date().toISOString(),
    created_at: toDate(l.createdAt ?? l.created_at) ?? new Date().toISOString(),
  }
}

// V16 exports costs as unified array with _src: 'material' | 'receipt' | 'expense'
function mapCost(c: any, userId: string, _src: string) {
  const id = c.entryId ?? c.id ?? uid(_src.slice(0, 3), c.jobId, c.date, c.supplier ?? c.item)
  const base = {
    id,
    user_id: userId,
    job_id: c.jobId ?? c.job_id ?? null,
    client: c.client ?? null,
    date: toDate(c.date),
    supplier: c.supplier ?? null,
    notes: c.notes ?? null,
    updated_at: new Date().toISOString(),
    created_at: toDate(c.createdAt ?? c.created_at) ?? new Date().toISOString(),
  }
  if (_src === 'material') {
    return {
      ...base,
      mat_desc: c.item ?? c.desc ?? c.mat_desc ?? null,
      cost_ex_gst: toNum(c.costExGST ?? c.cost_ex_gst),
      gst: toNum(c.gst),
      total_inc_gst: toNum(c.totalIncGST ?? c.total_inc_gst),
      category: c.category ?? null,
      billing_type: c.billingType ?? c.billing_type ?? null,
      receipt_no: c.receipt ?? c.invoiceNo?.toString() ?? c.receiptNo ?? c.receipt_no ?? null,
    }
  }
  if (_src === 'receipt') {
    return {
      ...base,
      rec_desc: c.item ?? c.desc ?? c.rec_desc ?? null,
      cost_ex_gst: toNum(c.amount ?? c.costExGST ?? c.cost_ex_gst),
      gst: toNum(c.gst),
      total_inc_gst: toNum(c.totalIncGST ?? c.total_inc_gst ?? c.amount),
      category: c.method ?? c.category ?? null,
    }
  }
  // expense
  return {
    ...base,
    exp_desc: c.item ?? c.desc ?? c.exp_desc ?? null,
    amount_ex_gst: toNum(c.amountExGST ?? c.costExGST ?? c.amount_ex_gst),
    gst: toNum(c.gst),
    category: c.category ?? null,
  }
}

function mapInvoice(inv: any, userId: string, idx: number) {
  const ex = toNum(inv.agreedExGST ?? inv.agreed_ex_gst) ?? 0
  // invNo may be "Cash" (duplicate), so append index to guarantee uniqueness
  const rawId = String(inv.invNo ?? inv.id ?? `inv-${idx}`)
  const id = rawId === 'Cash' ? `Cash-${inv.jobId ?? ''}-${idx}` : rawId
  return {
    id,
    user_id: userId,
    job_id: inv.jobId ?? inv.job_id ?? null,
    client: inv.client ?? null,
    date: toDate(inv.date),
    date_paid: toDate(inv.datePaid ?? inv.date_paid),
    due_date: toDate(inv.dueDate ?? inv.due_date),
    agreed_ex_gst: ex,
    gst: toNum(inv.gst) ?? ex * 0.1,
    total_inc_gst: toNum(inv.incGST ?? inv.total_inc_gst) ?? ex * 1.1,
    deposit: toNum(inv.deposit),
    deposit_date: toDate(inv.depositDate ?? inv.deposit_date),
    notes: inv.desc ?? inv.notes ?? null,
    inv_status: inv.status ?? inv.inv_status ?? null,
    received: toNum(inv.received),
    manual_paid: toBool(inv.manualPaid ?? inv.manual_paid),
    extra: inv.lineItems?.length ? { line_items: inv.lineItems, mat_markup: inv.matMarkup ?? 0 } : {},
    updated_at: new Date().toISOString(),
    created_at: toDate(inv.createdAt ?? inv.created_at) ?? new Date().toISOString(),
  }
}

function mapCrew(c: any, userId: string) {
  return {
    id: c.id,
    user_id: userId,
    name: c.name ?? null,
    role: c.role ?? null,
    rate: toNum(c.rate),
    charge_rate: toNum(c.chargeRate ?? c.charge_rate),
    payment_type: c.paymentType ?? c.payment_type ?? 'ABN',
    phone: c.phone ?? null,
    email: c.email ?? null,
    notes: c.notes ?? null,
    updated_at: new Date().toISOString(),
    created_at: toDate(c.createdAt ?? c.created_at) ?? new Date().toISOString(),
  }
}

function mapAssignment(a: any, userId: string) {
  return {
    id: a.id ?? uid('asgn', a.jobId, a.date, a.crewName),
    user_id: userId,
    job_id: a.jobId ?? a.job_id ?? null,
    crew_name: a.crewName ?? a.crew_name ?? a.crewId ?? null,
    date: toDate(a.date),
    hours: toNum(a.hours),
    notes: a.notes ?? null,
    updated_at: new Date().toISOString(),
    created_at: toDate(a.createdAt ?? a.created_at) ?? new Date().toISOString(),
  }
}

function mapEnquiry(e: any, userId: string) {
  const id = e.id ?? uid('enq', e.date, e.client)
  return {
    id,
    user_id: userId,
    date: toDate(e.date),
    client: e.client ?? null,
    address: e.address ?? null,
    phone: e.phone ?? null,
    email: e.email ?? null,
    source: e.source ?? null,
    job_type: e.jobType ?? e.job_type ?? null,
    action: e.action ?? null,
    attachments: e.attachments ?? [],
    notes: e.notes ?? null,
    enq_status: e.status ?? e.enq_status ?? null,
    converted_to_job: e.convertedToJob ?? e.converted_to_job ?? null,
    job_id: e.convertedJobId ?? e.job_id ?? null,
    updated_at: new Date().toISOString(),
    created_at: toDate(e.createdAt ?? e.created_at) ?? new Date().toISOString(),
  }
}

function mapVariation(v: any, userId: string) {
  return {
    id: v.id ?? uid('var', v.jobId, v.date),
    user_id: userId,
    job_id: v.jobId ?? v.job_id ?? null,
    date: toDate(v.date),
    var_desc: v.desc ?? v.var_desc ?? null,
    amount_ex_gst: toNum(v.amountExGST ?? v.amount_ex_gst),
    var_status: v.status ?? v.var_status ?? null,
    notes: v.notes ?? null,
    updated_at: new Date().toISOString(),
    created_at: toDate(v.createdAt ?? v.created_at) ?? new Date().toISOString(),
  }
}

function mapTodo(t: any, userId: string) {
  return {
    id: t.id ?? uid('todo', t.text?.slice(0, 10)),
    user_id: userId,
    todo_text: t.text ?? t.todo_text ?? null,
    done: toBool(t.done),
    due: toDate(t.due),
    job_id: t.jobId ?? t.job_id ?? null,
    priority: t.priority ?? 'Normal',
    updated_at: new Date().toISOString(),
    created_at: toDate(t.createdAt ?? t.created_at) ?? new Date().toISOString(),
  }
}

function mapCalendarEvent(ev: any, userId: string) {
  return {
    id: ev.id ?? uid('cal', ev.date, ev.title?.slice(0, 10)),
    user_id: userId,
    title: ev.title ?? null,
    date: toDate(ev.date),
    end_date: toDate(ev.endDate ?? ev.end_date),
    color: ev.type ?? ev.color ?? null,
    notes: ev.notes ?? null,
    job_id: ev.jobId ?? ev.job_id ?? null,
    time: ev.time ?? null,
    updated_at: new Date().toISOString(),
    created_at: toDate(ev.createdAt ?? ev.created_at) ?? new Date().toISOString(),
  }
}

function mapPaySchedule(p: any, userId: string) {
  return {
    id: p.jobId ?? p.id ?? uid('ps', p.client),
    user_id: userId,
    worker: p.client ?? p.worker ?? null,
    period_start: toDate(p.milestones?.[0]?.dueDate ?? p.period_start),
    period_end: toDate(p.milestones?.[p.milestones?.length - 1]?.dueDate ?? p.period_end),
    amount: toNum(p.totalValue ?? p.amount),
    paid: toBool(p.milestones?.every((m: any) => m.received) ?? p.paid),
    notes: JSON.stringify(p.milestones ?? []),
    updated_at: new Date().toISOString(),
    created_at: toDate(p.createdAt ?? p.created_at) ?? new Date().toISOString(),
  }
}

function mapAdsSpend(a: any, userId: string) {
  return {
    id: a.entryId ?? a.id ?? uid('ads', a.date, a.platform),
    user_id: userId,
    date: toDate(a.date),
    platform: a.platform ?? null,
    amount: toNum(a.amount),
    notes: a.notes ?? null,
    updated_at: new Date().toISOString(),
    created_at: toDate(a.createdAt ?? a.created_at) ?? new Date().toISOString(),
  }
}

// ── Batch upsert with deduplication ──────────────────────────
async function batchUpsert(table: string, rows: any[], chunkSize = 50): Promise<{ count: number; errors: string[] }> {
  if (!rows.length) return { count: 0, errors: [] }
  // Deduplicate by id — keep last occurrence
  const seen = new Map<string, any>()
  for (const r of rows) if (r?.id != null) seen.set(String(r.id), r)
  const deduped = Array.from(seen.values())
  const errors: string[] = []
  let count = 0
  for (let i = 0; i < deduped.length; i += chunkSize) {
    const chunk = deduped.slice(i, i + chunkSize)
    const { error } = await (supabase.from(table as any) as any).upsert(chunk, { onConflict: 'id' })
    if (error) errors.push(`${table}: ${error.message}`)
    else count += chunk.length
  }
  return { count, errors }
}

// ── Main import ───────────────────────────────────────────────
export interface ImportResult {
  counts: Record<string, number>
  errors: string[]
  total: number
}

function getArr(json: any, ...keys: string[]): any[] {
  for (const k of keys) {
    if (Array.isArray(json[k]) && json[k].length) return json[k]
  }
  return []
}

export async function importBackup(json: any, userId: string, onProgress?: (msg: string) => void): Promise<ImportResult> {
  const report: Record<string, number> = {}
  const allErrors: string[] = []

  // ── Jobs ──────────────────────────────────────────────────
  const rawJobs = getArr(json, 'jobs', 'JOBS')
  onProgress?.(`Importing ${rawJobs.length} jobs…`)
  const mappedJobs = rawJobs.filter(j => j?.id).map(j => mapJob(j, userId))
  const r1 = await batchUpsert('np_jobs', mappedJobs)
  report.jobs = r1.count; allErrors.push(...r1.errors)

  // ── Labour ────────────────────────────────────────────────
  const rawLabour = getArr(json, 'labour', 'LABOUR')
  onProgress?.(`Importing ${rawLabour.length} labour entries…`)
  const mappedLabour = rawLabour.map(l => mapLabour(l, userId))
  const r2 = await batchUpsert('np_labour', mappedLabour)
  report.labour = r2.count; allErrors.push(...r2.errors)

  // ── Costs (materials + receipts + expenses unified in V16) ─
  // V16 exports as `costs` array with _src field; older exports use separate arrays
  const rawCosts = getArr(json, 'costs')
  const rawMats = rawCosts.length
    ? rawCosts.filter((c: any) => c._src !== 'receipt' && c._src !== 'expense')
    : getArr(json, 'materials', 'MATERIALS')
  const rawReceipts = rawCosts.length
    ? rawCosts.filter((c: any) => c._src === 'receipt')
    : getArr(json, 'receipts', 'RECEIPTS')
  const rawExpenses = rawCosts.length
    ? rawCosts.filter((c: any) => c._src === 'expense')
    : getArr(json, 'expenses', 'EXPENSES')

  onProgress?.(`Importing ${rawMats.length} materials…`)
  const mappedMats = rawMats.map((m: any) => mapCost(m, userId, 'material'))
  const r3 = await batchUpsert('np_materials', mappedMats)
  report.materials = r3.count; allErrors.push(...r3.errors)

  onProgress?.(`Importing ${rawReceipts.length} receipts…`)
  const mappedReceipts = rawReceipts.map((r: any) => mapCost(r, userId, 'receipt'))
  const r4 = await batchUpsert('np_receipts', mappedReceipts)
  report.receipts = r4.count; allErrors.push(...r4.errors)

  onProgress?.(`Importing ${rawExpenses.length} expenses…`)
  const mappedExpenses = rawExpenses.map((e: any) => mapCost(e, userId, 'expense'))
  const r5 = await batchUpsert('np_expenses', mappedExpenses)
  report.expenses = r5.count; allErrors.push(...r5.errors)

  // ── Invoices ──────────────────────────────────────────────
  const rawInvoices = getArr(json, 'invoices', 'INVOICES')
  onProgress?.(`Importing ${rawInvoices.length} invoices…`)
  const mappedInvoices = rawInvoices.map((inv: any, i: number) => mapInvoice(inv, userId, i))
  const r6 = await batchUpsert('np_invoices', mappedInvoices)
  report.invoices = r6.count; allErrors.push(...r6.errors)

  // ── Crew ──────────────────────────────────────────────────
  const rawCrew = getArr(json, 'crew', 'CREW')
  onProgress?.(`Importing ${rawCrew.length} crew…`)
  const mappedCrew = rawCrew.filter((c: any) => c?.id).map((c: any) => mapCrew(c, userId))
  const r7 = await batchUpsert('np_crew', mappedCrew)
  report.crew = r7.count; allErrors.push(...r7.errors)

  // ── Assignments ───────────────────────────────────────────
  const rawAssign = getArr(json, 'assignments', 'ASSIGNMENTS')
  onProgress?.(`Importing ${rawAssign.length} assignments…`)
  const mappedAssign = rawAssign.map((a: any) => mapAssignment(a, userId))
  const r8 = await batchUpsert('np_assignments', mappedAssign)
  report.assignments = r8.count; allErrors.push(...r8.errors)

  // ── Enquiries ─────────────────────────────────────────────
  const rawEnq = getArr(json, 'enquiries', 'ENQUIRIES')
  onProgress?.(`Importing ${rawEnq.length} enquiries…`)
  const mappedEnq = rawEnq.map((e: any) => mapEnquiry(e, userId))
  const r9 = await batchUpsert('np_enquiries', mappedEnq)
  report.enquiries = r9.count; allErrors.push(...r9.errors)

  // ── Variations ────────────────────────────────────────────
  const rawVar = getArr(json, 'variations', 'VARIATIONS')
  onProgress?.(`Importing ${rawVar.length} variations…`)
  const mappedVar = rawVar.map((v: any) => mapVariation(v, userId))
  const r10 = await batchUpsert('np_variations', mappedVar)
  report.variations = r10.count; allErrors.push(...r10.errors)

  // ── Todos ─────────────────────────────────────────────────
  const rawTodos = getArr(json, 'todos', 'TODOS')
  onProgress?.(`Importing ${rawTodos.length} todos…`)
  const mappedTodos = rawTodos.map((t: any) => mapTodo(t, userId))
  const r11 = await batchUpsert('np_todos', mappedTodos)
  report.todos = r11.count; allErrors.push(...r11.errors)

  // ── Calendar events ───────────────────────────────────────
  const rawCal = getArr(json, 'calendarEvents', 'CALENDAR_EVENTS')
  onProgress?.(`Importing ${rawCal.length} calendar events…`)
  const mappedCal = rawCal.map((e: any) => mapCalendarEvent(e, userId))
  const r12 = await batchUpsert('np_calendar_events', mappedCal)
  report.calendarEvents = r12.count; allErrors.push(...r12.errors)

  // ── Pay schedules ─────────────────────────────────────────
  const rawPS = getArr(json, 'paySchedules', 'PAY_SCHEDULES')
  onProgress?.(`Importing ${rawPS.length} pay schedules…`)
  const mappedPS = rawPS.map((p: any) => mapPaySchedule(p, userId))
  const r13 = await batchUpsert('np_pay_schedules', mappedPS)
  report.paySchedules = r13.count; allErrors.push(...r13.errors)

  // ── Ads spend ─────────────────────────────────────────────
  const rawAds = getArr(json, 'adsSpend', 'ADS_SPEND')
  onProgress?.(`Importing ${rawAds.length} ads entries…`)
  const mappedAds = rawAds.map((a: any) => mapAdsSpend(a, userId))
  const r14 = await batchUpsert('np_ads_spend', mappedAds)
  report.adsSpend = r14.count; allErrors.push(...r14.errors)

  // ── Rates + paint products ────────────────────────────────
  await importV16Settings(json, userId, onProgress, allErrors)

  const total = Object.values(report).reduce((a, b) => a + b, 0)
  return { counts: report, errors: allErrors, total }
}

async function importV16Settings(json: any, userId: string, onProgress: ((msg: string) => void) | undefined, errors: string[]) {
  const rates = json.rates
  const matPrices: any[] = getArr(json, 'matPrices', 'MAT_PRICES')
  if (!rates && !matPrices.length) return
  try {
    const { data: existing } = await (supabase.from('np_settings') as any)
      .select('value').eq('user_id', userId).eq('key', 'business').maybeSingle()
    const current: any = existing?.value ?? {}
    const update: any = { ...current }
    if (rates) {
      onProgress?.('Importing labour rates…')
      update.rates = {
        standard:    rates.standard    ?? current.rates?.standard    ?? 65,
        lead:        rates.lead        ?? current.rates?.lead        ?? 75,
        sub:         rates.sub         ?? current.rates?.sub         ?? 70,
        overhead:    rates.overhead    ?? current.rates?.overhead    ?? 12,
        hpd:         rates.hpd         ?? current.rates?.hpd         ?? 8,
        charge_rate: rates.chargeRate  ?? current.rates?.charge_rate ?? 65,
      }
      update.default_labour_rate = rates.chargeRate ?? current.default_labour_rate ?? 65
    }
    if (matPrices.length) {
      onProgress?.(`Importing ${matPrices.length} paint products…`)
      update.paint_products = matPrices.map((p: any, i: number) => ({
        id: `pp-v16-${i}`,
        product:  p.product  ?? '',
        cat:      p.cat      ?? 'interior',
        use:      p.use      ?? '',
        size:     p.size     ?? '',
        finish:   p.finish   ?? '',
        coverage: p.coverage ?? 12,
        rrp:      p.rrp      ?? 0,
        yours:    p.yours    ?? 0,
      }))
    }
    const { error } = await (supabase.from('np_settings') as any).upsert({
      key: 'business', user_id: userId, value: update, updated_at: new Date().toISOString(),
    })
    if (error) errors.push(`np_settings: ${error.message}`)
  } catch (e: any) {
    errors.push(`np_settings: ${e?.message}`)
  }
}
