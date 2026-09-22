import { supabase } from './supabase'

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
    quote_ex_gst: j.quoteExGST ?? j.quote_ex_gst ?? null,
    agreed_ex_gst: j.agreedExGST ?? j.agreed_ex_gst ?? null,
    est_labour_ex: j.estLabourEx ?? j.est_labour_ex ?? null,
    est_materials_ex: j.estMaterialsEx ?? j.est_materials_ex ?? null,
    labour_rate: j.labourRate ?? j.labour_rate ?? null,
    sched_start: j.schedStart ?? j.sched_start ?? null,
    est_days: j.estDays ?? j.est_days ?? null,
    quote_no: j.quoteNo ?? j.quote_no ?? null,
    quote_sent: j.quoteSent ?? j.quote_sent ?? null,
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
  return {
    id: l.entryId ?? l.id,
    user_id: userId,
    job_id: l.jobId ?? l.job_id ?? null,
    client: l.client ?? null,
    date: l.date ?? null,
    sub: l.sub ?? null,
    hours: l.hours ?? null,
    rate: l.rate ?? null,
    cost: l.cost ?? null,
    charge_rate: l.chargeRate ?? l.charge_rate ?? null,
    billable: l.billable ?? null,
    billing_type: l.billingType ?? l.billing_type ?? null,
    paid: l.paid ?? false,
    worker_payment_type: l.workerPaymentType ?? l.worker_payment_type ?? 'ABN',
    labour_desc: l.desc ?? l.labour_desc ?? null,
    notes: l.notes ?? null,
    clock_in: l.clockIn ?? l.clock_in ?? null,
    clock_out: l.clockOut ?? l.clock_out ?? null,
    updated_at: new Date().toISOString(),
    created_at: l.createdAt ?? l.created_at ?? new Date().toISOString(),
  }
}

function mapMaterial(m: any, userId: string) {
  return {
    id: m.entryId ?? m.id,
    user_id: userId,
    job_id: m.jobId ?? m.job_id ?? null,
    client: m.client ?? null,
    date: m.date ?? null,
    supplier: m.supplier ?? null,
    mat_desc: m.desc ?? m.mat_desc ?? null,
    cost_ex_gst: m.costExGST ?? m.cost_ex_gst ?? null,
    gst: m.gst ?? null,
    total_inc_gst: m.totalIncGST ?? m.total_inc_gst ?? null,
    category: m.category ?? null,
    notes: m.notes ?? null,
    receipt_no: m.receiptNo ?? m.receipt_no ?? null,
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
    date: r.dateIssued ?? r.date ?? null,
    supplier: r.method ?? null,
    rec_desc: r.desc ?? r.rec_desc ?? null,
    cost_ex_gst: r.amount ?? r.cost_ex_gst ?? null,
    gst: r.gst ?? null,
    total_inc_gst: r.amount ?? r.total_inc_gst ?? null,
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
    date: e.date ?? null,
    exp_desc: e.desc ?? e.exp_desc ?? null,
    amount_ex_gst: e.amountExGST ?? e.amount_ex_gst ?? null,
    gst: e.gst ?? null,
    category: e.category ?? null,
    notes: e.notes ?? null,
    updated_at: new Date().toISOString(),
    created_at: e.createdAt ?? e.created_at ?? new Date().toISOString(),
  }
}

function mapInvoice(inv: any, userId: string) {
  const ex = inv.agreedExGST ?? inv.agreed_ex_gst ?? 0
  return {
    id: inv.id ?? inv.invNo,
    user_id: userId,
    job_id: inv.jobId ?? inv.job_id ?? null,
    client: inv.client ?? null,
    date: inv.date ?? null,
    date_paid: inv.datePaid ?? inv.date_paid ?? null,
    due_date: inv.dueDate ?? inv.due_date ?? null,
    agreed_ex_gst: ex,
    gst: inv.gst ?? ex * 0.1,
    total_inc_gst: inv.incGST ?? inv.total_inc_gst ?? ex * 1.1,
    deposit: inv.deposit ?? null,
    deposit_date: inv.depositDate ?? inv.deposit_date ?? null,
    notes: inv.notes ?? null,
    inv_status: inv.status ?? inv.inv_status ?? null,
    received: inv.received ?? null,
    manual_paid: inv.manualPaid ?? inv.manual_paid ?? false,
    extra: {},
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
    rate: c.rate ?? null,
    charge_rate: c.chargeRate ?? c.charge_rate ?? null,
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
    date: a.date ?? null,
    hours: a.hours ?? null,
    notes: a.notes ?? null,
    updated_at: new Date().toISOString(),
    created_at: a.createdAt ?? a.created_at ?? new Date().toISOString(),
  }
}

function mapEnquiry(e: any, userId: string) {
  return {
    id: e.id,
    user_id: userId,
    date: e.date ?? null,
    client: e.client ?? null,
    address: e.address ?? null,
    phone: e.phone ?? null,
    email: e.email ?? null,
    source: e.source ?? null,
    notes: e.notes ?? null,
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
    date: v.date ?? null,
    var_desc: v.desc ?? v.var_desc ?? null,
    amount_ex_gst: v.amountExGST ?? v.amount_ex_gst ?? null,
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
    due: t.due ?? null,
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
    date: ev.date ?? null,
    end_date: ev.endDate ?? ev.end_date ?? null,
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
    period_start: p.milestones?.[0]?.dueDate ?? p.period_start ?? null,
    period_end: p.milestones?.[p.milestones?.length - 1]?.dueDate ?? p.period_end ?? null,
    amount: p.totalValue ?? p.amount ?? null,
    paid: p.milestones?.every((m: any) => m.received) ?? p.paid ?? false,
    notes: JSON.stringify(p.milestones ?? []),
    updated_at: new Date().toISOString(),
    created_at: p.createdAt ?? p.created_at ?? new Date().toISOString(),
  }
}

function mapAdsSpend(a: any, userId: string) {
  return {
    id: a.entryId ?? a.id,
    user_id: userId,
    date: a.date ?? null,
    platform: a.platform ?? null,
    amount: a.amount ?? null,
    notes: a.notes ?? null,
    updated_at: new Date().toISOString(),
    created_at: a.createdAt ?? a.created_at ?? new Date().toISOString(),
  }
}

// ── Batch upsert helper ───────────────────────────────────────
async function batchUpsert(table: string, rows: any[], chunkSize = 50): Promise<{ count: number; errors: string[] }> {
  if (!rows.length) return { count: 0, errors: [] }
  const errors: string[] = []
  let count = 0
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize)
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

export async function importBackup(json: any, userId: string, onProgress?: (msg: string) => void): Promise<ImportResult> {
  const report: Record<string, number> = {}
  const allErrors: string[] = []

  const tables: Array<{ name: string; key: string; mapper: (item: any, uid: string) => any }> = [
    { name: 'np_jobs',            key: 'JOBS',            mapper: mapJob },
    { name: 'np_labour',          key: 'LABOUR',          mapper: mapLabour },
    { name: 'np_materials',       key: 'MATERIALS',       mapper: mapMaterial },
    { name: 'np_receipts',        key: 'RECEIPTS',        mapper: mapReceipt },
    { name: 'np_expenses',        key: 'EXPENSES',        mapper: mapExpense },
    { name: 'np_invoices',        key: 'INVOICES',        mapper: mapInvoice },
    { name: 'np_crew',            key: 'CREW',            mapper: mapCrew },
    { name: 'np_assignments',     key: 'ASSIGNMENTS',     mapper: mapAssignment },
    { name: 'np_enquiries',       key: 'ENQUIRIES',       mapper: mapEnquiry },
    { name: 'np_variations',      key: 'VARIATIONS',      mapper: mapVariation },
    { name: 'np_todos',           key: 'TODOS',           mapper: mapTodo },
    { name: 'np_calendar_events', key: 'CALENDAR_EVENTS', mapper: mapCalendarEvent },
    { name: 'np_pay_schedules',   key: 'PAY_SCHEDULES',   mapper: mapPaySchedule },
    { name: 'np_ads_spend',       key: 'ADS_SPEND',       mapper: mapAdsSpend },
  ]

  for (const { name, key, mapper } of tables) {
    const raw: any[] = json[key] ?? []
    if (!raw.length) { report[key] = 0; continue }
    onProgress?.(`Importing ${raw.length} ${key}…`)
    const mapped = raw.filter(r => r?.id || r?.entryId || r?.no || r?.jobId).map(r => mapper(r, userId)).filter(r => r.id)
    const { count, errors } = await batchUpsert(name, mapped)
    report[key] = count
    allErrors.push(...errors)
  }

  const total = Object.values(report).reduce((a, b) => a + b, 0)
  return { counts: report, errors: allErrors, total }
}
