-- Remove 19 overheads mis-filed as materials — 2026-11-17
--
-- Run in Supabase -> SQL Editor. Safe to run again: a second run deletes
-- nothing, because the rows are already gone.
--
-- An earlier auto-import swept bank lines into np_materials regardless of
-- what they were, creating 178 rows with no category at all. Most are
-- genuine paint and hardware. These 19 are not: Vistaprint, Kennards Hire,
-- Tailor Brands, GoDaddy, Google Ads, YOUI, Telstra, ASIC and five fuel
-- stops. All 19 have an empty job_id, so no job's costing changes and no
-- client was ever billed for them.
--
-- The bank reconciliation of 2026-11-16 then inserted the same 19
-- transactions into np_expenses, where they belong: correctly categorised,
-- and carrying business_use_pct so fuel, phone and insurance are deducted
-- at the work share rather than in full. np_materials has no
-- business_use_pct column, so the split cannot be expressed there at all.
--
-- Left as they are, the 19 are deducted twice -- $2,593.44 ex GST and about
-- $259 of GST credits -- and the fuel among them is over-claimed at 100%.
--
-- Nothing is lost: the np_expenses rows are the same money, and they are the
-- version that is right.
--
-- Two traps this script was rewritten to avoid, both of which made an
-- earlier version report success having changed nothing:
--
--   auth.uid() is NULL in the SQL Editor. The session there is the postgres
--   role, not a logged-in user, and `user_id = NULL` is never true. The
--   literal user id is used instead.
--
--   job_id holds an EMPTY STRING, not a NULL. 166 of the import's 178 rows
--   are empty; the other 12 carry a real job and are genuine paint, so they
--   are untouched. A blank cell and a NULL look identical in the results
--   grid, which is how `job_id is null` came to be the guard, match nothing,
--   and delete nothing.
--
-- To reverse: the same 19 transactions remain in np_expenses under ids
-- starting 'bankrec-2026-11-16-', so the money is recoverable from there.

-- ── What is about to go ─────────────────────────────────────
-- Read this first. Expect 19 rows, 2593.44.
select count(*) as rows_to_delete, sum(cost_ex_gst) as ex_gst, sum(gst) as gst
from np_materials
where user_id = '805ea4f7-37b9-4031-8096-24f63ad98346'
  and coalesce(job_id, '') = ''
  and id in (
    'auto-mat-1789977895621-hj95l',  -- Vistaprint         34.53
    'auto-mat-1789977898413-ug1cq',  -- Kennards Hire      86.36
    'auto-mat-1789977911807-i6rlx',  -- Kennards Hire      24.55
    'auto-mat-1789977924418-9mw18',  -- Kennards Hire     452.73
    'auto-mat-1789977947963-57n62',  -- Tailor Brands      20.90
    'auto-mat-1789977947668-mjk7a',  -- Tailor Brands     267.16
    'auto-mat-1789977951344-91p7f',  -- GoDaddy            21.77
    'auto-mat-1789977953074-6dlaz',  -- Google Ads        454.55
    'auto-mat-1789977954303-gypzt',  -- YOUI               47.92
    'auto-mat-1789977955536-6im28',  -- BP Ozigo           91.07
    'auto-mat-1789977955949-2dop3',  -- Ampol             109.20
    'auto-mat-1789977956354-5dho1',  -- Telstra            45.45
    'auto-mat-1789977957065-awrpt',  -- Google Ads        225.76
    'auto-mat-1789977964308-4okrr',  -- Liberty Fuel      138.43
    'auto-mat-1789977966904-3pp1z',  -- Super Cheap Auto  128.42
    'auto-mat-1789977968592-tw9f4',  -- BP                140.25
    'auto-mat-1789977965287-iy4s1',  -- BP Ozigo    63.79 vs 63.80
    'auto-mat-1789977965677-1abyi',  -- Anthropic   28.10 vs 30.91
    'auto-mat-1789977969888-k8yr8'   -- Total Tools 212.50 vs 214.64
  );

-- ── The delete ──────────────────────────────────────────────
-- The guard repeats both conditions deliberately: if one of these rows is
-- attached to a job between now and when this runs, it is no longer the row
-- this script was written about, and is left alone rather than taking a
-- costed material off a job.
delete from np_materials
where user_id = '805ea4f7-37b9-4031-8096-24f63ad98346'
  and coalesce(job_id, '') = ''
  and id in (
    'auto-mat-1789977895621-hj95l','auto-mat-1789977898413-ug1cq',
    'auto-mat-1789977911807-i6rlx','auto-mat-1789977924418-9mw18',
    'auto-mat-1789977947963-57n62','auto-mat-1789977947668-mjk7a',
    'auto-mat-1789977951344-91p7f','auto-mat-1789977953074-6dlaz',
    'auto-mat-1789977954303-gypzt','auto-mat-1789977955536-6im28',
    'auto-mat-1789977955949-2dop3','auto-mat-1789977956354-5dho1',
    'auto-mat-1789977957065-awrpt','auto-mat-1789977964308-4okrr',
    'auto-mat-1789977966904-3pp1z','auto-mat-1789977968592-tw9f4',
    'auto-mat-1789977965287-iy4s1','auto-mat-1789977965677-1abyi',
    'auto-mat-1789977969888-k8yr8'
  );

-- ── Check it worked ─────────────────────────────────────────
-- Expect 0 still_there, and 159 auto_mat_remaining (178 less these 19).
select
  (select count(*) from np_materials
     where user_id = '805ea4f7-37b9-4031-8096-24f63ad98346'
       and id in (
         'auto-mat-1789977895621-hj95l','auto-mat-1789977898413-ug1cq',
         'auto-mat-1789977911807-i6rlx','auto-mat-1789977924418-9mw18',
         'auto-mat-1789977947963-57n62','auto-mat-1789977947668-mjk7a',
         'auto-mat-1789977951344-91p7f','auto-mat-1789977953074-6dlaz',
         'auto-mat-1789977954303-gypzt','auto-mat-1789977955536-6im28',
         'auto-mat-1789977955949-2dop3','auto-mat-1789977956354-5dho1',
         'auto-mat-1789977957065-awrpt','auto-mat-1789977964308-4okrr',
         'auto-mat-1789977966904-3pp1z','auto-mat-1789977968592-tw9f4',
         'auto-mat-1789977965287-iy4s1','auto-mat-1789977965677-1abyi',
         'auto-mat-1789977969888-k8yr8'
       )) as still_there,
  (select count(*) from np_materials
     where user_id = '805ea4f7-37b9-4031-8096-24f63ad98346'
       and id like 'auto-mat-%') as auto_mat_remaining;
