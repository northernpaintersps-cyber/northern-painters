// A week of supplier invoices, reviewed in one sitting.
//
// Two things matter more than the rest, and both are here because of what
// this data has already cost:
//
//   1. A duplicate must be caught BEFORE it is written. Nineteen duplicated
//      material rows were unpicked by hand not long ago; the same invoice
//      sitting twice in an email folder is exactly how that happens again.
//   2. A job is suggested, never assumed. The old inline match read the first
//      comma-separated chunk of the address and used `includes`, so "12 Bay
//      St" matched "120 Bay St". A wrong job is the error the review step
//      exists to prevent, so a wrong number must not match at all.

import {
  matchJob, intakeRow, failedRow, flagDuplicates, toMaterial, counts,
  problemWith, readyToApprove, CONFIDENT,
} from '@/lib/materialIntake'

let fail = 0
const ok = (c: boolean, m: string) => { if (!c) { fail++; console.log('FAIL', m) } else console.log('ok  ', m) }
const near = (a: number, b: number, tol = 0.005) => Math.abs(a - b) < tol
const eq = (a: number, b: number, m: string) =>
  ok(near(a, b), `${m} — got ${a.toFixed(2)}, want ${b.toFixed(2)}`)

const jobs = [
  { id: 'NP-0059', client: 'Cath and Andrew', address: '12 Bay St, Byron Bay NSW' },
  { id: 'NP-0073', client: 'JHT Built', address: '120 Bay St, Byron Bay NSW' },
  { id: 'NP-7142', client: 'Amplify Building', address: '11 Alexander Ct, Lennox Head' },
  { id: 'NP-9436', client: 'Eli & Alister', address: '3 Kenzi Rise, Nimbin' },
]

// ── Matching a job to a delivery address ────────────────────
{
  const m = matchJob(jobs, '12 Bay Street, Byron Bay')
  ok(m.jobId === 'NP-0059', 'the right house, despite Street against St')
  ok(m.score >= CONFIDENT, 'and confidently enough to fill in')

  // The failure the old inline match had: `includes` made these the same job.
  ok(matchJob(jobs, '120 Bay St, Byron Bay').jobId === 'NP-0073',
     '120 Bay St is not 12 Bay St')
  ok(matchJob(jobs, '12 Bay St').jobId === 'NP-0059', 'and 12 is not 120')

  // The format the old one could not handle at all.
  ok(matchJob(jobs, 'Unit 2/11 Alexander Ct Lennox Head').jobId === 'NP-7142',
     'a unit number in front of the street number still matches')

  ok(matchJob(jobs, '').jobId === null, 'no address, no guess')
  ok(matchJob(jobs, 'somewhere else entirely').jobId === null, 'and no match is null, not the first job')
  ok(matchJob([], '12 Bay St').jobId === null, 'no jobs, no match')

  // A street type alone is not evidence: every job is on a street.
  ok(matchJob(jobs, 'Street NSW Australia').jobId === null,
     'street types and states are noise, not a match')

  // The client lifts a score but cannot make one.
  const weak = matchJob(jobs, 'nowhere road', 'JHT Built')
  ok(weak.jobId === null, 'the client name alone does not pick a job')

  // Found by running real addresses through this, not by reading it: a town
  // name shares every word with an address in that town, so "Byron Bay"
  // scored a perfect match — on BOTH Bay St jobs equally, and took whichever
  // came first in the list.
  const town = matchJob(jobs, 'Byron Bay')
  ok(town.score < CONFIDENT, 'an address with no street number is never filled in')
  ok(town.jobId !== null, 'though it is still offered, since it narrows things down')

  // And a genuine tie is nobody's match to break but the reviewer's.
  const twins = [
    { id: 'A', client: 'X', address: '5 Short St, Lismore' },
    { id: 'B', client: 'Y', address: '5 Short St, Lismore' },
  ]
  ok(matchJob(twins, '5 Short St, Lismore').score < CONFIDENT,
     'two jobs at the same address leave the choice to a person')
}

// ── A confident match fills in; a weak one only offers ──────
{
  const strong = intakeRow({ supplier: 'Dulux', job_address: '12 Bay St, Byron Bay',
                             date: '2026-11-02', cost_ex_gst: 100, gst: 10 }, 'inv1.pdf', jobs)
  ok(strong.job_id === 'NP-0059', 'a confident suggestion is filled in')

  const vague = intakeRow({ supplier: 'Dulux', job_address: 'Byron Bay',
                            date: '2026-11-02', cost_ex_gst: 100, gst: 10 }, 'inv2.pdf', jobs)
  ok(vague.job_id === '', 'a weak one is left blank so somebody has to choose')
  ok(vague.suggestion.jobId !== null || vague.suggestion.score === 0,
     'but the suggestion is still carried for one-click acceptance')
}

// ── Reading the extraction ──────────────────────────────────
{
  const r = intakeRow({
    supplier: ' Inspirations Paint ', description: 'ceiling white 15L',
    date: '2026-11-02', receipt_no: '910338101', cost_ex_gst: 333.26, gst: 33.33,
    total_inc_gst: 366.59, category: 'Paint', notes: 'delivered',
    job_address: '3 Kenzi Rise Nimbin', items: [{ desc: 'x' }],
  }, 'inspo.pdf', jobs)
  ok(r.supplier === 'Inspirations Paint', 'the supplier is trimmed')
  ok(r.job_id === 'NP-9436', 'and the job matched')
  eq(r.total_inc_gst, 366.59, 'the inc-GST total is taken as given')
  ok(r.line_items.length === 1, 'line items are carried')
  ok(r.status === 'pending', 'and nothing is approved on arrival')

  // Missing inc-GST total is derived rather than left at nothing.
  const d = intakeRow({ supplier: 'S', date: '2026-11-02', cost_ex_gst: 100, gst: 10 }, 'f.pdf', jobs)
  eq(d.total_inc_gst, 110, 'a missing total is ex plus GST')

  // Junk does not produce NaN in a money column.
  const j = intakeRow({ supplier: 'S', date: '2026-11-02', cost_ex_gst: 'rubbish', gst: null }, 'f.pdf', jobs)
  ok(!Number.isNaN(j.cost_ex_gst) && !Number.isNaN(j.total_inc_gst), 'junk reads as zero, not NaN')
}

// ── Duplicates, before anything is written ──────────────────
{
  const onFile = [
    { id: 'mat-1', supplier: 'Dulux Australia', receipt_no: '910080881',
      date: '2026-07-15', cost_ex_gst: 260.92 },
  ]
  const rows = [
    intakeRow({ supplier: 'Dulux Australia', receipt_no: '910080881', date: '2026-07-15',
                cost_ex_gst: 260.92, gst: 23.72 }, 'a.pdf', jobs, 'k1'),
    intakeRow({ supplier: 'Dulux Australia', receipt_no: '999999', date: '2026-07-16',
                cost_ex_gst: 100, gst: 10 }, 'b.pdf', jobs, 'k2'),
  ]
  const flagged = flagDuplicates(rows, onFile)
  ok(!!flagged[0].duplicateOf, 'an invoice already on file is flagged')
  ok(flagged[0].duplicateOf!.id === 'mat-1', 'and names the row it duplicates')
  ok(flagged[0].duplicateOf!.inBatch === false, 'as being on file, not in this batch')
  ok(!flagged[1].duplicateOf, 'a new one is not flagged')
}
{
  // The same invoice twice in one folder — the way it actually happens.
  const twice = [
    intakeRow({ supplier: 'Bunnings', receipt_no: 'B-1', date: '2026-11-02',
                cost_ex_gst: 50, gst: 5 }, 'first.pdf', jobs, 'k1'),
    intakeRow({ supplier: 'Bunnings', receipt_no: 'B-1', date: '2026-11-02',
                cost_ex_gst: 50, gst: 5 }, 'again.pdf', jobs, 'k2'),
  ]
  const flagged = flagDuplicates(twice, [])
  ok(!flagged[0].duplicateOf, 'the first copy is clean')
  ok(!!flagged[1].duplicateOf, 'the second is flagged')
  ok(flagged[1].duplicateOf!.inBatch === true, 'and says it is a duplicate within this batch')

  // Re-flagging is stable: a row that stops being a duplicate loses the mark.
  const edited = flagDuplicates([twice[0], { ...twice[1], receipt_no: 'B-2' }], [])
  ok(!edited[1].duplicateOf, 'correcting the receipt number clears the warning')
}

// ── What is safe to save ────────────────────────────────────
{
  const good = intakeRow({ supplier: 'S', date: '2026-11-02', cost_ex_gst: 100, gst: 10,
                           job_address: '12 Bay St' }, 'f.pdf', jobs)
  ok(problemWith(good) === null, 'a complete row has no problem')
  ok(problemWith({ ...good, date: '' }) === 'No date', 'a date is required')
  ok(problemWith({ ...good, supplier: '' }) === 'No supplier', 'so is a supplier')
  ok(problemWith({ ...good, cost_ex_gst: 0, total_inc_gst: 0 }) === 'No amount', 'and an amount')
  ok(problemWith(failedRow('x.pdf', 'timed out')) === 'Could not be read',
     'an unreadable file says so rather than pretending to be a row')

  // A job is NOT required: stock bought for the van belongs to no job.
  ok(problemWith({ ...good, job_id: '' }) === null, 'a row with no job is still valid')
}

// ── Approve all takes only the unambiguous ones ─────────────
{
  const base = intakeRow({ supplier: 'S', date: '2026-11-02', cost_ex_gst: 100, gst: 10,
                           job_address: '12 Bay St, Byron Bay' }, 'f.pdf', jobs)
  const rows = [
    { ...base, key: 'a' },
    { ...base, key: 'b', job_id: '' },
    { ...base, key: 'c', duplicateOf: { id: 'mat-9', basis: 'number', sameSupplier: true, inBatch: false } },
    { ...base, key: 'd', date: '' },
    { ...base, key: 'e', status: 'approved' as const },
    failedRow('bad.pdf', 'unreadable', 'f'),
  ]
  const ready = readyToApprove(rows).map(r => r.key)
  ok(ready.length === 1 && ready[0] === 'a', 'only the clean, job-assigned, pending row')
  ok(!ready.includes('b'), 'not one without a job')
  ok(!ready.includes('c'), 'not a suspected duplicate')
  ok(!ready.includes('d'), 'not an incomplete one')
  ok(!ready.includes('f'), 'and not one that could not be read')
}

// ── Counts, for checking a batch against the statement ──────
{
  const base = intakeRow({ supplier: 'S', date: '2026-11-02', cost_ex_gst: 100, gst: 10,
                           job_address: '12 Bay St, Byron Bay' }, 'f.pdf', jobs)
  const c = counts([
    { ...base, key: 'a' },
    { ...base, key: 'b', cost_ex_gst: 50, gst: 5, job_id: '' },
    { ...base, key: 'c', status: 'approved' as const },
    { ...base, key: 'd', status: 'rejected' as const },
    failedRow('bad.pdf', 'x', 'e'),
  ])
  eq(c.total, 5, 'every row is counted')
  eq(c.pending, 2, 'pending')
  eq(c.approved, 1, 'approved')
  eq(c.rejected, 1, 'rejected')
  eq(c.failed, 1, 'failed')
  eq(c.needJob, 1, 'and the ones still needing a job')
  eq(c.pendingExGST, 150, 'the pending total ex GST ties to the supplier statement')
  eq(c.pendingGST, 15, 'with its GST')
}

// ── What gets written ───────────────────────────────────────
{
  const r = intakeRow({
    supplier: 'Dulux', description: 'ceiling white', date: '2026-11-02',
    receipt_no: '910338101', cost_ex_gst: 333.26, gst: 33.33, total_inc_gst: 366.59,
    category: 'Paint', job_address: '12 Bay St, Byron Bay',
  }, 'dulux-910338101.pdf', jobs)
  const m = toMaterial(r, 'user-1')

  ok(String(m.id).startsWith('mat'), 'it is a material row')
  ok(m.user_id === 'user-1', 'owned by the user')
  ok(m.job_id === 'NP-0059', 'on the matched job')
  eq(m.cost_ex_gst, 333.26, 'ex GST')
  eq(m.gst, 33.33, 'GST')
  eq(m.total_inc_gst, 366.59, 'and the total')
  ok(m.paid_by === 'Bank', 'paid from the bank — an emailed invoice was not a cash purchase')
  ok(String(m.notes).includes('dulux-910338101.pdf'),
     'and it records the file it came from, so it can be traced later')

  // A row with no job writes null, not an empty string: the misfiled-import
  // cleanup turned on exactly this distinction.
  const noJob = toMaterial({ ...r, job_id: '' }, 'user-1')
  ok(noJob.job_id === null, 'no job writes NULL, never an empty string')
}

console.log(fail ? `\n${fail} FAILED` : '\nall passed')
process.exit(fail ? 1 : 0)
