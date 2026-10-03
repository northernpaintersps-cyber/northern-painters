-- Site visit and scope photos.
--
-- Run once in Supabase → SQL Editor. Safe to run again: the bucket insert is
-- idempotent and each policy is dropped before it is recreated.
--
-- Photos are stored at  <user_id>/<visit_id>/<photo_id>.jpg  — the first path
-- segment is the owner's id, which is what every policy below keys off, so one
-- account can never read or write another's files.
--
-- The bucket is PRIVATE. These are photographs taken inside clients' homes;
-- a public bucket would make every one of them readable by anyone holding the
-- URL, with no login. The app reads them through short-lived signed URLs.

-- ── The bucket ───────────────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'np-photos',
  'np-photos',
  false,                                        -- private
  5242880,                                      -- 5 MB a file; the app shrinks to ~200 KB
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
  set file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types,
      public             = excluded.public;

-- ── Access ───────────────────────────────────────────────────
-- Row level security is already on for storage.objects in Supabase; these
-- policies say which rows of it this bucket's owner may touch.

drop policy if exists "np_photos_read"   on storage.objects;
drop policy if exists "np_photos_insert" on storage.objects;
drop policy if exists "np_photos_update" on storage.objects;
drop policy if exists "np_photos_delete" on storage.objects;

create policy "np_photos_read" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'np-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "np_photos_insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'np-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "np_photos_update" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'np-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'np-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "np_photos_delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'np-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- ── Check it worked ──────────────────────────────────────────
-- Expect one row, public = false.
select id, public, file_size_limit, allowed_mime_types
from storage.buckets where id = 'np-photos';

-- Expect four rows.
select policyname from pg_policies
where schemaname = 'storage' and tablename = 'objects'
  and policyname like 'np_photos%'
order by policyname;
