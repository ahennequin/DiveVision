-- Owner-only, read-only client access for the async enhancement flow.
--
-- The Expo client signs in with Supabase directly and reads its own photos
-- (rows and storage objects) straight from Supabase; every write goes
-- through the FastAPI backend or the arq worker, which use the service-role
-- key (it bypasses RLS and never leaves the backend). So clients keep only
-- owner-scoped SELECT policies here, and lose every INSERT/UPDATE/DELETE one.
--
-- Forward compatibility: policies stay additive. Public sharing later means
-- a new column (e.g. `photos.visibility`) plus an additional SELECT policy on
-- `photos` and on the `processedimages` bucket - never on `images`, whose
-- originals may carry GPS/EXIF data and stay owner-only.

-- -- photos: status lifecycle ----------------------------------------------------
-- pending (row inserted, job enqueued) -> processing (worker picked it up)
-- -> completed | failed. 'processing' stays valid, so rows written by the old
-- synchronous flow need no data migration.

alter table public.photos drop constraint photos_status_check;
alter table public.photos
    add constraint photos_status_check
    check (status in ('pending', 'processing', 'completed', 'failed'));
alter table public.photos alter column status set default 'pending';

-- -- photos: owner may read, nobody on the client may write ------------------------

drop policy "Users can insert their own photos" on public.photos;
drop policy "Users can update their own photos" on public.photos;
drop policy "Users can delete their own photos" on public.photos;

-- Belt and braces on top of RLS: without these grants a stray permissive
-- write policy added later still could not take effect for client roles.
revoke insert, update, delete, truncate on public.photos from anon, authenticated;

-- "Users can read their own photos" (select, auth.uid() = user_id) is kept.

-- -- storage: owner may read their folder, nobody on the client may write ---------

drop policy "Users can upload to their own images folder" on storage.objects;
drop policy "Users can update their own images" on storage.objects;
drop policy "Users can delete their own images" on storage.objects;

drop policy "Users can upload to their own processed images folder" on storage.objects;
drop policy "Users can update their own processed images" on storage.objects;
drop policy "Users can delete their own processed images" on storage.objects;

-- "Users can read their own images" and "Users can read their own processed
-- images" (select, first path segment = auth.uid()) are kept.

-- -- Realtime -------------------------------------------------------------------------
-- Realtime applies the SELECT policy above to every postgres_changes
-- subscriber, so a user only receives events for their own rows.

alter publication supabase_realtime add table public.photos;
