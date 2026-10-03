-- What happened to the labour entries. Read-only — nothing here changes data.
-- Run in Supabase → SQL Editor and send me all four results.

-- 1. The damage, in numbers.
select
  count(*)                                             as total_rows,
  count(*) filter (where date is null)                 as no_date,
  count(*) filter (where sub is null or sub = '')      as no_worker,
  count(*) filter (where date is null and (sub is null or sub = '')) as neither,
  count(*) filter (where hours is not null)            as still_have_hours,
  count(*) filter (where cost is not null)             as still_have_cost,
  count(*) filter (where job_id is not null)           as still_have_job
from np_labour;

-- 2. WHEN they changed. This is the decisive one.
--    A single row with a big count = one bulk write, almost certainly an
--    import. Many rows spread over time = edited one at a time.
select
  date_trunc('minute', updated_at) as changed_at,
  count(*)                         as rows_changed,
  count(*) filter (where date is null) as of_those_no_date
from np_labour
group by 1
order by 1 desc
limit 25;

-- 3. What a damaged row still holds, so we know what survived.
select id, date, sub, job_id, hours, rate, cost, billable,
       labour_desc, notes, created_at, updated_at
from np_labour
where date is null or sub is null or sub = ''
order by updated_at desc
limit 10;

-- 4. Anything that escaped, for comparison.
select id, date, sub, job_id, hours, cost, updated_at
from np_labour
where date is not null and sub is not null and sub <> ''
order by updated_at desc
limit 10;
