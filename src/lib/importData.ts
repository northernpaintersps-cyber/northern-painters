import { supabase } from './supabase'

// Coerce empty strings / non-values to null for Postgres typed columns
// Also normalises DD/MM/YYYY → YYYY-MM-DD
function toDate(v: any): string | null {
  if (v == null || v === '' || v === 'null' || v === 'undefined') return null
  const s = String(v).trim()
  // DD/MM/YYYY or D/M/YYYY
  const dmyMatch = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (dmyMatch) {
    const [, d, m, y] = dmyMatch
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
  }
  // DD-MM-YYYY
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

// ── Field mapping: old app → new schema ──────────────────────
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
  // V16 labour rows have no id/entryId — generate one from jobId + date + sub
  const fallbackId = `lab-${l.jobId ?? 'x'}-${(l.date ?? '').replace(/-/g, '')}-${(l.sub ?? '').replace(/\s+/g, '').slice(0, 8)}-${Math.random().toString(36).slice(2, 7)}`
  return {
    id: l.entryId ?? l.id ?? fallbackId,
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
    created_at: l.createdAt ?? l.created_at ?? new Date().toISOString(),
  }
}

function mapMaterial(m: any, userId: string) {
  // V16 uses 'item' for description (not 'desc'); invoiceNo for receipt number
  const fallbackId = `mat-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
  return {
    id: m.entryId ?? m.id ?? fallbackId,
    user_id: userId,
    job_id: m.jobId ?? m.job_id ?? null,
    client: m.client ?? null,
    date: toDate(m.date),
    supplier: m.supplier ?? null,
    mat_desc: m.item ?? m.desc ?? m.mat_desc ?? null,
    cost_ex_gst: toNum(m.costExGST ?? m.cost_ex_gst),
    gst: toNum(m.gst),
    total_inc_gst: toNum(m.totalIncGST ?? m.total_inc_gst),
    category: m.category ?? null,
    billing_type: m.billingType ?? m.billing_type ?? null,
    notes: m.notes ?? null,
    receipt_no: m.invoiceNo?.toString() ?? m.receiptNo ?? m.receipt_no ?? null,
    updated_at: new Date().toISOString(),
    created_at: m.createdAt ?? m.created_at ?? new Date().toISOString(),
  }
}

function mapReceipt(r: any, userId: string) {
  return {
    id: r.no ?? r.id,
    user_id: userId,
    job_id: r.jobId ?? r.job_id ?? null,
    client: r.client ?? null,
    date: toDate(r.dateIssued ?? r.date),
    supplier: r.method ?? null,
    rec_desc: r.desc ?? r.rec_desc ?? null,
    cost_ex_gst: toNum(r.amount ?? r.cost_ex_gst),
    gst: toNum(r.gst),
    total_inc_gst: toNum(r.amount ?? r.total_inc_gst),
    category: r.method ?? null,
    notes: r.notes ?? null,
    updated_at: new Date().toISOString(),
    created_at: r.createdAt ?? r.created_at ?? new Date().toISOString(),
  }
}

function mapExpense(e: any, userId: string) {
  return {
    id: e.id,
    user_id: userId,
    job_id: e.jobId ?? e.job_id ?? null,
    date: toDate(e.date),
    exp_desc: e.desc ?? e.exp_desc ?? null,
    amount_ex_gst: toNum(e.amountExGST ?? e.amount_ex_gst),
    gst: toNum(e.gst),
    category: e.category ?? null,
    notes: e.notes ?? null,
    updated_at: new Date().toISOString(),
    created_at: e.createdAt ?? e.created_at ?? new Date().toISOString(),
  }
}

function mapInvoice(inv: any, userId: string) {
  const ex = toNum(inv.agreedExGST ?? inv.agreed_ex_gst) ?? 0
  return {
    id: inv.id ?? inv.invNo,
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
    notes: inv.notes ?? inv.desc ?? null,
    inv_status: inv.status ?? inv.inv_status ?? null,
    received: toNum(inv.received),
    manual_paid: toBool(inv.manualPaid ?? inv.manual_paid),
    // Preserve V16 line items in extra so they can be displayed on printed invoice
    extra: inv.lineItems?.length ? { line_items: inv.lineItems, mat_markup: inv.matMarkup ?? 0 } : {},
    updated_at: new Date().toISOString(),
    created_at: inv.createdAt ?? inv.created_at ?? new Date().toISOString(),
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
    created_at: c.createdAt ?? c.created_at ?? new Date().toISOString(),
  }
}

function mapAssignment(a: any, userId: string) {
  return {
    id: a.id,
    user_id: userId,
    job_id: a.jobId ?? a.job_id ?? null,
    crew_name: a.crewName ?? a.crew_name ?? a.crewId ?? null,
    date: toDate(a.date),
    hours: toNum(a.hours),
    notes: a.notes ?? null,
    updated_at: new Date().toISOString(),
    created_at: a.createdAt ?? a.created_at ?? new Date().toISOString(),
  }
}

function mapEnquiry(e: any, userId: string) {
  // V16 enquiries have no id — generate from date + client
  const fallbackId = `enq-${(e.date ?? '').replace(/-/g, '')}-${(e.client ?? '').replace(/\s+/g, '').slice(0, 8)}-${Math.random().toString(36).slice(2, 6)}`
  // Merge action and jobType into notes
  const extraNotes = [e.action ? `Action: ${e.action}` : null, e.jobType ? `Job type: ${e.jobType}` : null].filter(Boolean).join(' · ')
  return {
    id: e.id ?? fallbackId,
    user_id: userId,
    date: toDate(e.date),
    client: e.client ?? null,
    address: e.address ?? null,
    phone: e.phone ?? null,
    email: e.email ?? null,
    source: e.source ?? null,
    notes: [e.notes, extraNotes].filter(Boolean).join('\n') || null,
    enq_status: e.status ?? e.enq_status ?? null,
    converted_to_job: e.convertedToJob ?? e.converted_to_job ?? null,
    job_id: e.convertedJobId ?? e.job_id ?? null,
    updated_at: new Date().toISOString(),
    created_at: e.createdAt ?? e.created_at ?? new Date().toISOString(),
  }
}

function mapVariation(v: any, userId: string) {
  return {
    id: v.id,
    user_id: userId,
    job_id: v.jobId ?? v.job_id ?? null,
    date: toDate(v.date),
    var_desc: v.desc ?? v.var_desc ?? null,
    amount_ex_gst: toNum(v.amountExGST ?? v.amount_ex_gst),
    var_status: v.status ?? v.var_status ?? null,
    notes: v.notes ?? null,
    updated_at: new Date().toISOString(),
    created_at: v.createdAt ?? v.created_at ?? new Date().toISOString(),
  }
}

function mapTodo(t: any, userId: string) {
  return {
    id: t.id,
    user_id: userId,
    todo_text: t.text ?? t.todo_text ?? null,
    done: t.done ?? false,
    due: toDate(t.due),
    job_id: t.jobId ?? t.job_id ?? null,
    priority: t.priority ?? 'Normal',
    updated_at: new Date().toISOString(),
    created_at: t.createdAt ?? t.created_at ?? new Date().toISOString(),
  }
}

function mapCalendarEvent(ev: any, userId: string) {
  return {
    id: ev.id,
    user_id: userId,
    title: ev.title ?? null,
    date: toDate(ev.date),
    end_date: toDate(ev.endDate ?? ev.end_date),
    color: ev.type ?? ev.color ?? null,
    notes: ev.notes ?? null,
    job_id: ev.jobId ?? ev.job_id ?? null,
    time: ev.time ?? null,
    updated_at: new Date().toISOString(),
    created_at: ev.createdAt ?? ev.created_at ?? new Date().toISOString(),
  }
}

function mapPaySchedule(p: any, userId: string) {
  return {
    id: p.jobId ?? p.id ?? `ps-${Date.now()}`,
    user_id: userId,
    worker: p.client ?? p.worker ?? null,
    period_start: toDate(p.milestones?.[0]?.dueDate ?? p.period_start),
    period_end: toDate(p.milestones?.[p.milestones?.length - 1]?.dueDate ?? p.period_end),
    amount: toNum(p.totalValue ?? p.amount),
    paid: toBool(p.milestones?.every((m: any) => m.received) ?? p.paid),
    notes: JSON.stringify(p.milestones ?? []),
    updated_at: new Date().toISOString(),
    created_at: p.createdAt ?? p.created_at ?? new Date().toISOString(),
  }
}

function mapAdsSpend(a: any, userId: string) {
  return {
    id: a.entryId ?? a.id,
    user_id: userId,
    date: toDate(a.date),
    platform: a.platform ?? null,
    amount: toNum(a.amount),
    notes: a.notes ?? null,
    updated_at: new Date().toISOString(),
    created_at: a.createdAt ?? a.created_at ?? new Date().toISOString(),
  }
}

// ── Batch upsert helper ───────────────────────────────────────
async function batchUpsert(table: string, rows: any[], chunkSize = 50): Promise<{ count: number; errors: string[] }> {
  if (!rows.length) return { count: 0, errors: [] }
  // Deduplicate by id — keep last occurrence (most complete data)
  const seen = new Map<string, any>()
  for (const r of rows) seen.set(r.id, r)
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

// ── Main import function ──────────────────────────────────────
export interface ImportResult {
  counts: Record<string, number>
  errors: string[]
  total: number
}

// Resolve a key from json, checking multiple name variants
function getArr(json: any, ...keys: string[]): any[] {
  for (const k of keys) {
    if (Array.isArray(json[k]) && json[k].length) return json[k]
  }
  return []
}

export async function importBackup(json: any, userId: string, onProgress?: (msg: string) => void): Promise<ImportResult> {
  const report: Record<string, number> = {}
  const allErrors: string[] = []

  // V16 exports lowercase camelCase; previous importer used UPPERCASE — support both
  const tables: Array<{ name: string; keys: string[]; mapper: (item: any, uid: string) => any; idFields?: string[] }> = [
    { name: 'np_jobs',            keys: ['jobs', 'JOBS'],                        mapper: mapJob,           idFields: ['id'] },
    { name: 'np_labour',          keys: ['labour', 'LABOUR'],                    mapper: mapLabour,        idFields: ['id', 'entryId', 'jobId'] },
    { name: 'np_materials',       keys: ['materials', 'MATERIALS'],              mapper: mapMaterial,      idFields: ['id', 'entryId', 'jobId'] },
    { name: 'np_receipts',        keys: ['receipts', 'RECEIPTS'],                mapper: mapReceipt,       idFields: ['id', 'no'] },
    { name: 'np_expenses',        keys: ['expenses', 'EXPENSES'],                mapper: mapExpense,       idFields: ['id'] },
    { name: 'np_invoices',        keys: ['invoices', 'INVOICES'],                mapper: mapInvoice,       idFields: ['id', 'invNo'] },
    { name: 'np_crew',            keys: ['crew', 'CREW'],                        mapper: mapCrew,          idFields: ['id'] },
    { name: 'np_assignments',     keys: ['assignments', 'ASSIGNMENTS'],          mapper: mapAssignment,    idFields: ['id', 'jobId'] },
    { name: 'np_enquiries',       keys: ['enquiries', 'ENQUIRIES'],              mapper: mapEnquiry,       idFields: ['id', 'client', 'phone'] },
    { name: 'np_variations',      keys: ['variations', 'VARIATIONS'],            mapper: mapVariation,     idFields: ['id'] },
    { name: 'np_todos',           keys: ['todos', 'TODOS'],                      mapper: mapTodo,          idFields: ['id'] },
    { name: 'np_calendar_events', keys: ['calendarEvents', 'CALENDAR_EVENTS'],   mapper: mapCalendarEvent, idFields: ['id'] },
    { name: 'np_pay_schedules',   keys: ['paySchedules', 'PAY_SCHEDULES'],       mapper: mapPaySchedule,   idFields: ['id', 'jobId'] },
    { name: 'np_ads_spend',       keys: ['adsSpend', 'ADS_SPEND'],               mapper: mapAdsSpend,      idFields: ['id', 'entryId'] },
  ]

  for (const { name, keys, mapper, idFields = ['id'] } of tables) {
    const raw = getArr(json, ...keys)
    if (!raw.length) { report[keys[0]] = 0; continue }
    onProgress?.(`Importing ${raw.length} ${keys[0]}…`)
    // Pre-filter: row must have at least one of the expected identifier fields
    const withId = raw.filter(r => r && idFields.some(f => r[f] != null && r[f] !== ''))
    const mapped = withId.map(r => mapper(r, userId)).filter(r => r.id)
    const { count, errors } = await batchUpsert(name, mapped)
    report[keys[0]] = count
    allErrors.push(...errors)
  }

  // Import V16 rates and matPrices into business settings
  await importV16Settings(json, userId, onProgress, allErrors)

  const total = Object.values(report).reduce((a, b) => a + b, 0)
  return { counts: report, errors: allErrors, total }
}

async function importV16Settings(json: any, userId: string, onProgress: ((msg: string) => void) | undefined, errors: string[]) {
  const rates = json.rates
  const matPrices: any[] = getArr(json, 'matPrices', 'MAT_PRICES')
  if (!rates && !matPrices.length) return

  try {
    // Fetch existing business settings to merge
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
      key: 'business',
      user_id: userId,
      value: update,
      updated_at: new Date().toISOString(),
    })
    if (error) errors.push(`np_settings: ${error.message}`)
  } catch (e: any) {
    errors.push(`np_settings rates/products: ${e?.message}`)
  }
}
