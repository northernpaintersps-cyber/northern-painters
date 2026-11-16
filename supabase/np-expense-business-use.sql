-- The work share of a cost that is also used privately.
--
-- Run once in Supabase → SQL Editor. Safe to run again.
--
-- A ute, a phone and a trailer are bought once and used for both work and
-- life. Only the work share is deductible, and only that share of the GST may
-- be claimed back.
--
-- Until now there was nowhere to say so, which left a bad choice: store the
-- whole amount and overstate the deduction, or store 80% of it and have a row
-- that matches no line on any bank statement. Reconciling the statements made
-- the cost of that concrete — fuel, insurance and phone came to $7,841 ex GST
-- in FY2025-26 against $6,273 actually claimable, so the app would have
-- overstated the deduction by $1,568 and the GST credit by $157.
--
-- So: amount_ex_gst and gst stay the whole amount paid, exactly as the bank
-- shows it, and this column records the fraction of it the return may claim.
-- The split is applied where the tax question is answered, in
-- src/lib/cashBooks.ts, not in what is stored.
--
-- Null reads as wholly business. That is the normal case, and it leaves every
-- expense recorded before this column existed exactly where it was — no
-- figure on any screen moves until a percentage is deliberately entered.
--
-- np_assets has had business_use_pct since supabase/np-assets.sql; this gives
-- expenses the same column, read by the same `businessShare` helper.

alter table np_expenses
  add column if not exists business_use_pct numeric;

-- A share outside 0–100 is not a share. The app refuses one before saving;
-- this stops anything else writing one, including a hand-run UPDATE.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'np_expenses_business_use_pct_range'
  ) then
    alter table np_expenses
      add constraint np_expenses_business_use_pct_range
      check (business_use_pct is null or (business_use_pct >= 0 and business_use_pct <= 100));
  end if;
end $$;

comment on column np_expenses.business_use_pct is
  'Work share of a privately-shared cost, 0-100. The full amount paid is in '
  'amount_ex_gst so the row ties to the bank statement; only this share is '
  'deducted and only this share of the GST is claimed. Null = wholly business.';

-- ── Check it worked ──────────────────────────────────────────
-- Expect one row: numeric, nullable.
select column_name, data_type, is_nullable
from information_schema.columns
where table_name = 'np_expenses' and column_name = 'business_use_pct';

-- Expect every existing expense to read as wholly business, i.e. null.
select count(*) as expenses, count(business_use_pct) as with_a_share
from np_expenses;
