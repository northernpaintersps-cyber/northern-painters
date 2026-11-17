-- Move the remaining misfiled overheads out of np_materials — 2026-11-17
--
-- Run in Supabase -> SQL Editor. Safe to run again: the insert carries
-- `on conflict (id) do nothing`, and the delete only takes rows the insert
-- has already copied.
--
-- The auto-import that created the 19 duplicates removed by
-- np-remove-misfiled-materials.sql also filed a number of plain overheads as
-- materials, with no category on any of them. These were not duplicated by
-- the bank reconciliation, so deleting them would lose the cost. They are
-- moved instead.
--
-- This changes no tax. A cost is deductible from either table and the GST
-- credit is identical. What it fixes is the P&L: materials and overheads are
-- separate lines for a reason, and signwriting, a company fee and a tools
-- account are not paint. Cost of goods sold has been reading high and
-- overheads low by whatever these rows come to.
--
-- The split is by supplier, because that is all these rows carry: category is
-- null on every one and mat_desc holds the bank narration.
--
--   BannerBuzz, Vistaprint          -> Advertising & Marketing
--   ASIC                            -> Professional Fees
--
-- ASIC is matched exactly, not with a wildcard: '%asic%' would also catch a
-- supplier called Classic Paints or Basic Hardware and move paint out of the
-- materials table. The rest are distinctive enough to match loosely.
--   Total Tools, T Tools,
--   Super Cheap Auto                -> Tools & Equipment
--   Kmart                           -> Other
--
-- Kmart is the one judgement call: drop sheets and cleaning gear are a
-- business cost, a kettle is not. It lands in 'Other' rather than being
-- guessed at, so it is deducted exactly as it is today and is easy to find
-- and retag on the Expenses page. If part of it was private, set
-- business_use_pct on those rows afterwards.
--
-- business_use_pct is left null, meaning wholly business, which is how these
-- rows are treated today as materials. Fuel, phone and insurance are the
-- costs that need a work share, and the reconciliation already inserted
-- those into np_expenses at 80%.
--
-- Two traps, both of which made earlier scripts in this series report
-- success having changed nothing:
--
--   auth.uid() is NULL in the SQL Editor. The session there is the postgres
--   role, not a logged-in user, and `user_id = NULL` is never true. The
--   literal user id is used throughout.
--
--   That import wrote an EMPTY STRING into job_id, never a NULL, so the
--   guard is `coalesce(job_id, '') = ''`. 12 of its rows carry a real job
--   and all 12 are genuine paint, so they are untouched either way.
--
-- To reverse: every moved row keeps its old id inside the new one, so
--   delete from np_expenses where id like 'movedmat-%';
-- undoes the insert and the original ids are recoverable from it.

-- ── What is about to move ───────────────────────────────────
-- Read this before running the rest. Each group shows where it will land.
select
  case
    when supplier ilike '%bannerbuzz%' or supplier ilike '%vistaprint%' then 'Advertising & Marketing'
    when upper(trim(supplier)) = 'ASIC'                                 then 'Professional Fees'
    when supplier ilike '%total tool%' or supplier ilike '%t tools%'
      or supplier ilike '%super cheap%'                                then 'Tools & Equipment'
    when supplier ilike '%kmart%'                                      then 'Other'
  end as moves_to,
  count(*) as rows,
  sum(cost_ex_gst) as ex_gst,
  sum(gst) as gst
from np_materials
where user_id = '805ea4f7-37b9-4031-8096-24f63ad98346'
  and id like 'auto-mat-%'
  and coalesce(job_id, '') = ''
  and (supplier ilike '%bannerbuzz%' or supplier ilike '%vistaprint%'
    or upper(trim(supplier)) = 'ASIC'
    or supplier ilike '%total tool%' or supplier ilike '%t tools%'
    or supplier ilike '%super cheap%'
    or supplier ilike '%kmart%')
group by 1
order by ex_gst desc;

-- ── The move: copy into np_expenses ─────────────────────────
-- insert ... select, so every figure crosses over exactly as stored rather
-- than being retyped. The old id is kept inside the new one, which is what
-- makes this reversible and what stops a second run duplicating anything.
insert into np_expenses
  (id, user_id, job_id, date, exp_desc, supplier, amount_ex_gst, gst,
   category, paid_by, business_use_pct, notes)
select
  'movedmat-' || m.id,
  m.user_id,
  null,
  m.date,
  coalesce(nullif(trim(m.mat_desc), ''), m.supplier),
  m.supplier,
  m.cost_ex_gst,
  m.gst,
  case
    when m.supplier ilike '%bannerbuzz%' or m.supplier ilike '%vistaprint%' then 'Advertising & Marketing'
    when upper(trim(m.supplier)) = 'ASIC'                                   then 'Professional Fees'
    when m.supplier ilike '%total tool%' or m.supplier ilike '%t tools%'
      or m.supplier ilike '%super cheap%'                                   then 'Tools & Equipment'
    when m.supplier ilike '%kmart%'                                         then 'Other'
  end,
  coalesce(nullif(trim(m.paid_by), ''), 'Bank'),
  null,
  coalesce(m.notes || ' ', '')
    || '[moved 2026-11-17] Filed as a material by an earlier auto-import with '
    || 'no category. Not paint, so moved to np_expenses and the P&L now '
    || 'separates cost of goods sold from overheads. Same amount, same GST, '
    || 'same deduction. Was np_materials.' || m.id
from np_materials m
where m.user_id = '805ea4f7-37b9-4031-8096-24f63ad98346'
  and m.id like 'auto-mat-%'
  and coalesce(m.job_id, '') = ''
  and (m.supplier ilike '%bannerbuzz%' or m.supplier ilike '%vistaprint%'
    or upper(trim(m.supplier)) = 'ASIC'
    or m.supplier ilike '%total tool%' or m.supplier ilike '%t tools%'
    or m.supplier ilike '%super cheap%'
    or m.supplier ilike '%kmart%')
on conflict (id) do nothing;

-- ── And remove the originals ────────────────────────────────
-- The condition is "an expense now exists that was copied from me", not the
-- supplier list over again. A row the insert did not copy — because it has a
-- job on it, or because an earlier run already moved and deleted it — is
-- left exactly where it is. Nothing is deleted that was not first copied.
delete from np_materials m
where m.user_id = '805ea4f7-37b9-4031-8096-24f63ad98346'
  and exists (
    select 1 from np_expenses e
    where e.user_id = m.user_id
      and e.id = 'movedmat-' || m.id
  );

-- ── Check it worked ─────────────────────────────────────────
-- Expect moved_in to match the row count from the first select, left_behind
-- to be 0, and auto_mat_remaining to be the paint and hardware that does
-- belong in np_materials.
select
  (select count(*) from np_expenses
     where user_id = '805ea4f7-37b9-4031-8096-24f63ad98346'
       and id like 'movedmat-%') as moved_in,
  (select sum(amount_ex_gst) from np_expenses
     where user_id = '805ea4f7-37b9-4031-8096-24f63ad98346'
       and id like 'movedmat-%') as moved_ex_gst,
  (select count(*) from np_materials
     where user_id = '805ea4f7-37b9-4031-8096-24f63ad98346'
       and id like 'auto-mat-%'
       and (supplier ilike '%bannerbuzz%' or supplier ilike '%vistaprint%'
         or upper(trim(supplier)) = 'ASIC'
         or supplier ilike '%total tool%' or supplier ilike '%t tools%'
         or supplier ilike '%super cheap%'
         or supplier ilike '%kmart%')) as left_behind,
  (select count(*) from np_materials
     where user_id = '805ea4f7-37b9-4031-8096-24f63ad98346'
       and id like 'auto-mat-%') as auto_mat_remaining;

-- ── What is still uncategorised ─────────────────────────────
-- The rest of that import: paint and hardware, correctly in np_materials but
-- with category null. No figure is wrong — a per-category materials report
-- would simply have nothing to group by. A separate tidy-up, for when it
-- matters.
select supplier, count(*) as rows, sum(cost_ex_gst) as ex_gst
from np_materials
where user_id = '805ea4f7-37b9-4031-8096-24f63ad98346'
  and id like 'auto-mat-%'
group by supplier
order by ex_gst desc;
