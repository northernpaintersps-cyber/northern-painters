-- Payment dates for the 12 invoices that had none — 2026-11-17
--
-- Run in Supabase -> SQL Editor. Safe to run again: each statement asserts
-- date_paid is still null, so an invoice already dated is left alone.
--
-- These 12 all have `received` at the full invoice amount — the money came
-- in — but no date_paid, and inv_status null. The app's invStatus() derives
-- 'Paid' from received (src/lib/utils.ts), so they do appear as paid on
-- screen; what was missing was the date, which is what a cash-basis report
-- recognises income on.
--
-- Each date below is a credit on the CommBank statements for 1 Jul 2025 to
-- 30 Sep 2026, matched on the exact amount, on or after the invoice date,
-- with the payer's name on the transaction corroborating the client. The
-- narration is quoted in each comment so any one of them can be checked
-- against the statement without re-deriving the match.
--
-- All 12 payments landed inside FY2025-26, so no income moves between
-- financial years. The gain is accuracy: a payment dated the day it arrived
-- rather than inferred from the invoice, which is what makes a cash-basis
-- BAS quarter right rather than roughly right.
--
-- 200326 came in three instalments. date_paid is the day it was finally
-- settled, 2026-05-14, because that is when the invoice stopped being owed.
-- The two earlier instalments are noted but not stored: np_invoices has one
-- date_paid, and part payments live in `received`.
--
-- auth.uid() is NULL in the SQL Editor — the session there is the postgres
-- role, not a logged-in user — so the literal user id is used throughout.
--
-- One invoice is deliberately not here: 070925, Purcell Painting, $400,
-- received in full and marked paid, but with NO INVOICE DATE AT ALL. It
-- cannot be placed in any period on any basis and no payment date fixes
-- that. It needs a date on the invoice itself, which is a decision about
-- which day it was raised, not something a bank statement answers.

-- ── What is about to change ─────────────────────────────────
-- Expect 12 rows, every date_paid null.
select id, date, client, total_inc_gst, received, date_paid
from np_invoices
where user_id = '805ea4f7-37b9-4031-8096-24f63ad98346'
  and id in ('090825','210825','140925','190126','200326','230426',
             '110526','140526','300526','040626','100626','210626')
order by date;

-- ── The dates ───────────────────────────────────────────────

-- 090825  Purcell Painting          $1,755.00
-- "Fast Transfer From LIAM PURCELL Labour 44 Co" — same day as the invoice.
update np_invoices set date_paid = '2025-08-09',
  notes = coalesce(notes || ' ', '') || '[paid dates 2026-11-17] 2025-08-09 per statement: Fast Transfer From LIAM PURCELL'
where user_id = '805ea4f7-37b9-4031-8096-24f63ad98346' and id = '090825' and date_paid is null;

-- 210825  Purcell Painting            $815.00
-- "Fast Transfer From LIAM PURCELL Labour 44 Co" — same day as the invoice.
update np_invoices set date_paid = '2025-08-21',
  notes = coalesce(notes || ' ', '') || '[paid dates 2026-11-17] 2025-08-21 per statement: Fast Transfer From LIAM PURCELL'
where user_id = '805ea4f7-37b9-4031-8096-24f63ad98346' and id = '210825' and date_paid is null;

-- 140925  Purcell Painting          $1,500.00
-- "Fast Transfer From LIAM PURCELL Labour 44 Co" — the day after invoicing.
update np_invoices set date_paid = '2025-09-15',
  notes = coalesce(notes || ' ', '') || '[paid dates 2026-11-17] 2025-09-15 per statement: Fast Transfer From LIAM PURCELL'
where user_id = '805ea4f7-37b9-4031-8096-24f63ad98346' and id = '140925' and date_paid is null;

-- 190126  Nick Nikataras            $5,311.68
-- "Fast Transfer From NICK NIKITARAS Painting" — 12 weeks after invoicing.
update np_invoices set date_paid = '2026-04-11',
  notes = coalesce(notes || ' ', '') || '[paid dates 2026-11-17] 2026-04-11 per statement: Fast Transfer From NICK NIKITARAS'
where user_id = '805ea4f7-37b9-4031-8096-24f63ad98346' and id = '190126' and date_paid is null;

-- 200326  Collective Elements      $17,773.80  — three instalments
-- "Fast Transfer From C Elements": $10,000.00 on 2026-04-14,
-- $2,773.80 on 2026-05-13 and $5,000.00 on 2026-05-14. Settled on the last.
update np_invoices set date_paid = '2026-05-14',
  notes = coalesce(notes || ' ', '') || '[paid dates 2026-11-17] Settled 2026-05-14 per statement, in three instalments from C Elements: 10,000.00 on 2026-04-14, 2,773.80 on 2026-05-13, 5,000.00 on 2026-05-14'
where user_id = '805ea4f7-37b9-4031-8096-24f63ad98346' and id = '200326' and date_paid is null;

-- 230426  John Curran               $7,312.49
-- "Fast Transfer From JOHN CURRAN Painting to h"
update np_invoices set date_paid = '2026-04-27',
  notes = coalesce(notes || ' ', '') || '[paid dates 2026-11-17] 2026-04-27 per statement: Fast Transfer From JOHN CURRAN'
where user_id = '805ea4f7-37b9-4031-8096-24f63ad98346' and id = '230426' and date_paid is null;

-- 110526  Mach Build                $2,063.60
-- "Fast Transfer From MATTHEW CHALMERS INV 1105" — the narration even cites
-- the invoice number.
update np_invoices set date_paid = '2026-05-15',
  notes = coalesce(notes || ' ', '') || '[paid dates 2026-11-17] 2026-05-15 per statement: Fast Transfer From MATTHEW CHALMERS INV 1105'
where user_id = '805ea4f7-37b9-4031-8096-24f63ad98346' and id = '110526' and date_paid is null;

-- 140526  Collective Elements       $2,699.40
-- "Fast Transfer From C Elements CREDIT TO ACCOUNT"
update np_invoices set date_paid = '2026-05-31',
  notes = coalesce(notes || ' ', '') || '[paid dates 2026-11-17] 2026-05-31 per statement: Fast Transfer From C Elements'
where user_id = '805ea4f7-37b9-4031-8096-24f63ad98346' and id = '140526' and date_paid is null;

-- 300526  Collective Elements       $2,645.50
-- "Fast Transfer From C Elements CREDIT TO ACCOUNT"
update np_invoices set date_paid = '2026-06-06',
  notes = coalesce(notes || ' ', '') || '[paid dates 2026-11-17] 2026-06-06 per statement: Fast Transfer From C Elements'
where user_id = '805ea4f7-37b9-4031-8096-24f63ad98346' and id = '300526' and date_paid is null;

-- 040626  Bespoke Projects          $1,892.30
-- "Fast Transfer From GEORDIE FIELDING-SMIT Bes"
update np_invoices set date_paid = '2026-06-17',
  notes = coalesce(notes || ' ', '') || '[paid dates 2026-11-17] 2026-06-17 per statement: Fast Transfer From GEORDIE FIELDING-SMITH'
where user_id = '805ea4f7-37b9-4031-8096-24f63ad98346' and id = '040626' and date_paid is null;

-- 100626  Jenny and Garry          $16,455.78
-- "Fast Transfer From Jenny Haines CREDIT TO AC"
update np_invoices set date_paid = '2026-06-16',
  notes = coalesce(notes || ' ', '') || '[paid dates 2026-11-17] 2026-06-16 per statement: Fast Transfer From Jenny Haines'
where user_id = '805ea4f7-37b9-4031-8096-24f63ad98346' and id = '100626' and date_paid is null;

-- 210626  The Horse Herbalist       $4,359.00 received, $4,358.20 banked
-- "Fast Transfer From ANGELA DAVISON painting o". The 80c difference is in
-- `received`, not the bank: the statement is the authority on the date, and
-- 80c is not worth a correction to the amount.
update np_invoices set date_paid = '2026-06-22',
  notes = coalesce(notes || ' ', '') || '[paid dates 2026-11-17] 2026-06-22 per statement: Fast Transfer From ANGELA DAVISON, 4,358.20 banked against 4,359.00 recorded'
where user_id = '805ea4f7-37b9-4031-8096-24f63ad98346' and id = '210626' and date_paid is null;

-- ── Check it worked ─────────────────────────────────────────
-- Expect all 12 with a date_paid, and none left null.
select
  count(*) as invoices,
  count(date_paid) as now_dated,
  count(*) - count(date_paid) as still_missing
from np_invoices
where user_id = '805ea4f7-37b9-4031-8096-24f63ad98346'
  and id in ('090825','210825','140925','190126','200326','230426',
             '110526','140526','300526','040626','100626','210626');

-- And the one that cannot be fixed from a statement: no invoice date at all.
select id, date, client, total_inc_gst, received, date_paid
from np_invoices
where user_id = '805ea4f7-37b9-4031-8096-24f63ad98346'
  and (date is null or date = '');
