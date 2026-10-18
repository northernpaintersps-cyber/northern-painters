-- The asset register: machinery, tools, vehicles.
--
-- Run once in Supabase → SQL Editor. Safe to run again.
--
-- A spray rig or a ute is not an expense. It is bought once and earns its
-- keep over years, so the deduction is spread over those years rather than
-- taken in the month the invoice landed — or taken at once under the instant
-- write-off, which is a choice made per asset and is recorded as one here.
--
-- Until now there was nowhere to put one. A $9,000 compressor logged as a
-- material expense overstates one year's costs and understates every year
-- after it, and leaves no record of what the business actually owns.
--
-- What each column is for:
--
--   method            How the cost is deducted.
--                       'immediate'    — the whole lot in the year of purchase
--                                        (instant asset write-off)
--                       'prime_cost'   — equal amounts over the effective life
--                       'diminishing'  — 200% ÷ life, on what is left each year
--                       'none'         — tracked but not depreciated (land,
--                                        or something already fully written off)
--   effective_life_yr The ATO effective life in years. Ignored by 'immediate'.
--   business_use_pct  Only the business share is deductible. A ute at 80%
--                     deducts 80% of its depreciation and claims 80% of the
--                     GST credit. Defaults to 100.
--   prior_depreciation  Deductions already claimed before this register
--                     existed, so an asset brought in mid-life starts from
--                     the right written-down value rather than from new.
--   paid_by           Same rule as everywhere else since np-cash-payments.sql:
--                     an asset bought with cash is not deductible and claims
--                     no GST credit. Null reads as on the books.
--   disposal_*        Sold, traded or scrapped. After this date it stops
--                     depreciating; the proceeds against the written-down
--                     value are a gain or loss you will need at tax time.
--
-- Nothing here is a tax ruling. The register records the decisions and does
-- the arithmetic consistently; which method and which effective life apply to
-- a given asset is between you and your accountant.

create table if not exists np_assets (
  id                 text primary key,
  user_id            uuid not null default auth.uid() references auth.users(id) on delete cascade,

  name               text,
  category           text,              -- Vehicle | Machinery | Tools | Equipment | Technology | Other
  supplier           text,
  purchase_date      date,
  invoice_no         text,

  cost_ex_gst        numeric default 0,
  gst                numeric default 0,
  total_inc_gst      numeric default 0,
  paid_by            text,

  method             text default 'prime_cost',
  effective_life_yr  numeric default 5,
  business_use_pct   numeric default 100,
  prior_depreciation numeric default 0,

  disposal_date      date,
  disposal_amount_ex_gst numeric,

  serial_no          text,
  location           text,
  notes              text,
  /** Receipt image or PDF, and anything else added later. */
  attachments        jsonb default '[]'::jsonb,
  extra              jsonb default '{}'::jsonb,

  updated_at         timestamptz default now(),
  created_at         timestamptz default now()
);

-- Same row-level security as every other np_ table: you see your rows, nobody
-- else's, and nothing can be written against another user's id.
alter table np_assets enable row level security;

drop policy if exists "np_assets_select" on np_assets;
drop policy if exists "np_assets_insert" on np_assets;
drop policy if exists "np_assets_update" on np_assets;
drop policy if exists "np_assets_delete" on np_assets;

create policy "np_assets_select" on np_assets
  for select using (auth.uid() = user_id);
create policy "np_assets_insert" on np_assets
  for insert with check (auth.uid() = user_id);
create policy "np_assets_update" on np_assets
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "np_assets_delete" on np_assets
  for delete using (auth.uid() = user_id);

-- The register is read whole, and the tax year is read by purchase date.
create index if not exists np_assets_user_idx on np_assets (user_id, purchase_date desc);

-- ── Check it worked ──────────────────────────────────────────
-- Expect the full column list.
select column_name, data_type, column_default
from information_schema.columns
where table_name = 'np_assets'
order by ordinal_position;

-- And four policies.
select policyname, cmd from pg_policies
where tablename = 'np_assets'
order by policyname;
