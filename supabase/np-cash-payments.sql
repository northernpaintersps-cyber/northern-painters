-- How a cost was paid, so cash can be treated as non-deductible.
--
-- Run once in Supabase → SQL Editor. Safe to run again.
--
-- Until now "cash" was a property of a JOB (np_jobs.on_books), and the Tax
-- page dropped a cash job's income and its costs together. That is the right
-- net answer only by accident: it breaks the moment one job is part invoiced
-- and part cash, and it says nothing about a cash receipt on an on-books job,
-- which today is deducted in full.
--
-- Cash is a property of a PAYMENT, not of a job, so it is recorded on the row
-- that holds the money.
--
--   paid_by   'Bank' | 'Card' | 'Cash'   (text, nullable)
--
-- Null means not stated, and not stated is treated as on the books — the
-- conservative reading, and what every existing row means. Only an explicit
-- 'Cash' changes any figure.
--
-- What the app then does with it:
--   · a cash cost is NOT deductible and claims NO GST credit, so it is kept
--     out of the tax base and out of the BAS, and subtracted after tax
--   · cash income is off the books: no GST, not taxable, and added back to
--     the after-tax profit in full
--
-- Nothing here changes a job's own cost or profit figures. What a job cost is
-- what it cost, however it was paid.

alter table np_materials add column if not exists paid_by text;
alter table np_expenses  add column if not exists paid_by text;
alter table np_labour    add column if not exists paid_by text;

-- Labour already recorded this, under a name about the worker rather than the
-- payment. Carry it across so existing cash-paid labour is right from the
-- first load; worker_payment_type stays as it is and is not read for tax.
update np_labour
   set paid_by = 'Cash'
 where paid_by is null
   and lower(trim(coalesce(worker_payment_type, ''))) = 'cash';

update np_labour
   set paid_by = 'Bank'
 where paid_by is null
   and lower(trim(coalesce(worker_payment_type, ''))) = 'abn';

-- The P&L reads a whole financial year per table and splits on this column.
create index if not exists np_materials_paid_by_idx on np_materials (user_id, paid_by);
create index if not exists np_expenses_paid_by_idx  on np_expenses  (user_id, paid_by);
create index if not exists np_labour_paid_by_idx    on np_labour    (user_id, paid_by);

-- ── Check it worked ──────────────────────────────────────────
-- Expect three rows, all text, all nullable.
select table_name, column_name, data_type, is_nullable
from information_schema.columns
where column_name = 'paid_by'
  and table_name in ('np_materials', 'np_expenses', 'np_labour')
order by table_name;

-- And what the backfill did. Expect counts against 'Cash' / 'Bank' / null.
select coalesce(paid_by, '(not stated)') as paid_by, count(*)
from np_labour
group by 1
order by 2 desc;
