-- Which phase of the job an hour went to.
--
-- Run once in Supabase → SQL Editor. Safe to run again.
--
-- Until now a labour row recorded hours against a JOB and nothing finer, so
-- the only rate the app could honestly produce was a blended per-job one. The
-- comment in src/lib/jobRates.ts says as much. No amount of analysis fixes
-- that after the fact — the dimension has to be captured as the hours are
-- logged, which is what these two columns are for.
--
-- Both, deliberately:
--
--   phase_name  The phase as it reads on the quote: "Exterior — pressure wash
--               and sugar soap". This is the real join key, because it is what
--               survives. A quote's process ids are regenerated every time the
--               steps are reloaded, so an id-only link would break silently.
--
--   phase_id    The quote's own step id, kept for an exact match while it
--               lasts. Useful for telling two identically named phases apart
--               on the same job.
--
-- Both are nullable and always optional. An untagged entry still counts in
-- full toward what the job cost — tagging can only ever add detail, never
-- change a total.

alter table np_labour add column if not exists phase_name text;
alter table np_labour add column if not exists phase_id   text;

-- Finding a job's tagged hours is the common read, so index the pair.
create index if not exists np_labour_phase_idx
  on np_labour (user_id, job_id, phase_name);

-- ── Check it worked ──────────────────────────────────────────
-- Expect two rows: phase_name and phase_id, both text, both nullable.
select column_name, data_type, is_nullable
from information_schema.columns
where table_name = 'np_labour'
  and column_name in ('phase_name', 'phase_id')
order by column_name;

-- While you are here: these two were on the pending list from a while back and
-- are what the Labour page's period fields want. Uncomment to add them, or
-- leave them — nothing breaks either way, the app strips them on save when
-- they are missing.
-- alter table np_labour add column if not exists period_start date;
-- alter table np_labour add column if not exists period_end   date;
