// The booking deposit percentage.
//
// It is offered from three places — the Jobs list, the job's Billing tab and
// the invoice modal — so the figure has to come from one function or the
// three will disagree about what a deposit is. And a percentage that is not
// a percentage must not reach an invoice: a stored 0 or 1000 would raise one
// for nothing, or for ten times the job.

import { DEPOSIT_PCT, depositPct, depositAmount, jobValueEx, depositPath, hasDepositInvoice } from '@/lib/deposit'

let fail = 0
const ok = (c: boolean, m: string) => { if (!c) { fail++; console.log('FAIL', m) } else console.log('ok  ', m) }
const near = (a: number, b: number) => Math.abs(a - b) < 0.005

// ── The default ──────────────────────────────────────────────
ok(DEPOSIT_PCT === 10, 'the default deposit is 10%')
ok(depositPct(undefined) === 10, 'with nothing set, the default applies')
ok(depositPct(null) === 10, 'and with no settings at all')
ok(depositPct({}) === 10, 'and with settings that do not mention it')

// ── Set, and editable ────────────────────────────────────────
ok(depositPct({ deposit_pct: 20 }) === 20, 'a figure in Settings wins over the default')
ok(depositPct({ deposit_pct: 33.5 }) === 33.5, 'including a fractional one')
ok(depositPct({ deposit_pct: '15' } as any) === 15, 'a number stored as text still reads')
ok(depositPct({ deposit_pct: 100 }) === 100, 'the whole job up front is allowed')

// ── Nonsense falls back rather than reaching an invoice ──────
ok(depositPct({ deposit_pct: 0 }) === 10, 'zero is not a deposit — it falls back')
ok(depositPct({ deposit_pct: -20 }) === 10, 'and neither is a negative')
ok(depositPct({ deposit_pct: 150 }) === 10, 'over 100% of the job is a typo, not a deposit')
ok(depositPct({ deposit_pct: 'half' } as any) === 10, 'and words fall back')
ok(depositPct({ deposit_pct: NaN }) === 10, 'NaN never reaches an amount')

// ── What it comes to ─────────────────────────────────────────
const JOB = { id: 'NP-1', client: 'Smith', agreed_ex_gst: 10000 }
ok(jobValueEx(JOB) === 10000, 'the deposit is taken on the agreed price')
ok(jobValueEx({ quote_ex_gst: 8000 }) === 8000, 'or the quote, when there is no agreed price')
ok(jobValueEx({ agreed_ex_gst: 10000, quote_ex_gst: 8000 }) === 10000, 'the agreed price wins')
ok(jobValueEx({}) === 0, 'and a job with neither is worth nothing to take a deposit on')

ok(depositAmount(JOB, depositPct({})) === 1000, 'the new default on a $10,000 job is $1,000')
ok(depositAmount(JOB, depositPct({ deposit_pct: 20 })) === 2000, 'and 20% is $2,000')
ok(near(depositAmount({ agreed_ex_gst: 7333 }, 10), 733.3), 'it rounds to the cent')
ok(depositAmount({}, 10) === 0, 'nothing to take a deposit on is nothing, not NaN')

// ── The handoff to the invoice page ──────────────────────────
// The amount travels in sessionStorage, not the URL — there is no storage
// under node, and handOff is written to still return a usable path when
// writing fails, which is what this pins.
const path = depositPath(JOB, depositPct({ deposit_pct: 10 }))
ok(path.startsWith('/invoices'), 'it sends you to the invoices page')
ok(path.includes('new=1'), 'telling it to open the new-invoice modal')
ok(!path.includes('1000') && !path.includes('NP-1'),
  'and the figures are not in the URL, where they would be shared and stale')

ok(!hasDepositInvoice([]), 'no invoices, no deposit raised yet')
ok(hasDepositInvoice([{ extra: { booking_deposit: true } }]), 'one marked as a deposit is found')
ok(!hasDepositInvoice([{ extra: {} }, { notes: 'Deposit' }]),
  'and an invoice that merely mentions a deposit in its notes is not one')

console.log(fail ? `\n${fail} FAILED` : '\nall passed')
process.exit(fail ? 1 : 0)
