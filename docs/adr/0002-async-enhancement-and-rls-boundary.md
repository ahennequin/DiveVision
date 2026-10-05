# Enhancement runs in a queued worker; Supabase RLS is the per-user read boundary

The app used to enhance photos synchronously inside `POST /image/` and proxy sign-up/sign-in
through the API (the #4 redesign chose "stay synchronous, no job queue"). For the Expo client
(issue #16) that is reversed:

- **Async enhancement.** `POST /photos/` stores the Original, inserts a `pending` `photos` row,
  enqueues an arq job on Redis, and returns at once. A separate worker container loads the
  U-Shape model once and runs jobs, so heavy PyTorch inference scales independently of the API
  (and the API process no longer imports PyTorch at all).
- **Supabase is the auth and read path.** Clients sign in with Supabase directly and read their
  Photos (rows, storage objects, Realtime events) straight from it. The API only verifies the
  access token and keeps the operations that need the model or admin rights.
- **Clients never write.** RLS gives clients owner-only SELECT on `photos` and both buckets, and
  no INSERT/UPDATE/DELETE. All writes use the service-role key inside backend containers — the
  worker needs it anyway because jobs outlive user tokens.

Policies are additive on purpose: public sharing later is a new column plus an extra SELECT
policy on `photos`/`processedimages`, never on `images` (Originals may carry GPS/EXIF data).
