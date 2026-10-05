# Project agent memory

For domain vocabulary (Enhancement Model, Benchmark Dataset, Reference Image, etc.), see
`CONTEXT.md`. Architectural decisions are recorded in `docs/adr/`.

DiveVision has two current strands of work — see `README.md` for the full picture:

1. **Experiment workflow**: testing/comparing underwater image enhancement models (U-Shape
   Transformer, CE-VAE), benchmarked via MLflow on the LSUI/UIEB datasets.
2. **App serving the U-Shape model**: backend only so far — FastAPI (`divevision/src/app/main.py`)
   plus an arq enhancement worker (`divevision/src/app/worker.py`). No Expo/mobile/web client,
   social features, or geolocation exist yet (client is issue #17). Don't imply otherwise.

## Repo layout

- `divevision/models/` — vendored third-party model implementations (U-Shape Transformer, CE-VAE).
- `divevision/src/models/` — thin `AbstractModel` wrappers around those implementations
  (`abstract_model.py`, `u_shape_model.py`, `cvae_model.py`).
- `divevision/src/datasets/` — `AbstractDataset` implementations for LSUI and UIEB.
- `divevision/src/metrics/` — SSIM/PSNR metrics used by the benchmark.
- `divevision/src/test.py` — the MLflow benchmark pipeline (entry point via
  `python -m divevision.src.test`).
- `divevision/src/app/` — the app backend: `main.py` (FastAPI), `worker.py` (arq jobs),
  `enhancement.py` (the one function that runs the model on a photo), `supabase_api.py`.
- `divevision/test/` — pytest suite for models, the API, and the worker.
- `divevision/notebooks/test_model.ipynb` — manual smoke test for a model.

## Running things

- Tests: `poetry run pytest`
- Benchmark: see "Running the benchmark" in `README.md` (Docker Compose-based).
- API + worker + Redis: `docker compose up api worker` (or see README's "Running the FastAPI
  server and worker").
- RLS integration tests: `divevision/test/test_rls_integration.py` (skipped unless pointed at a
  local `supabase start` stack; its docstring has the command).

## Known issues

- `download_resources.sh` only fetches model weights, not the LSUI/UIEB datasets themselves —
  those must be obtained manually (see README's Installation section for expected paths).
- The CE-VAE checkpoint (`lsui-cevae-epoch119.ckpt`) is fetched from a GitHub Release asset
  (`cevae-checkpoint-v1` tag on this repo) rather than the old, dead Google Drive link. If it
  ever needs re-hosting, upload a new asset via `gh release upload` and update the URL in
  `download_cevae_resources`.

## Supabase: two separate projects

There are two independent Supabase projects, deliberately not sharing an API surface (a prior
design sharing one project between MLflow's tracking backend and app data caused an RLS
exposure where MLflow-adjacent policies leaked access to user photos):

- The MLflow tracking backend (`mlflow_server.sh`, `SUPABASE_POSTGRES_*` in `.env_example`) -
  unrelated to the app below, don't touch it here.
- This app's own project (auth, photo storage, `photos`/`leaderboard` tables): schema lives in
  `supabase/migrations/`, config in `supabase/config.toml`. `divevision/src/app/supabase_api.py`
  wraps `supabase-py` for it; `divevision/src/app/main.py` exposes it over FastAPI. Validate
  migrations locally with `supabase start` (requires Docker) before trusting them.

Clients sign in with Supabase directly and only ever *read* their own `photos` rows, storage
objects, and Realtime events (owner-only SELECT policies; no client write policies or grants).
Every write goes through the backend with the service-role key (`get_admin_client()`), which
bypasses RLS — so any admin-client query made on a user's behalf must filter by the `user_id`
from the verified token itself (see `get_photo(..., user_id=)`). The API verifies
`Authorization: Bearer <access token>` via Supabase Auth (`get_user_id`); there is no
refresh-token header or API sign-in. Rationale: `docs/adr/0002-async-enhancement-and-rls-boundary.md`.

Every per-user table/bucket is RLS-scoped to `auth.uid()` - never add a blanket
`USING(true)`/`WITH CHECK(true)` policy alongside a scoped one; Postgres ORs permissive
policies together, so the blanket one silently wins and defeats the scoping. Future public
sharing must stay additive and never cover the `images` bucket (Originals may carry GPS/EXIF).

`main.py` must not import `divevision.src.models` (importing it instantiates and loads the
model); only the worker loads it, via `enhancement.load_model()`. `POST /photos/` stores the
Original, inserts a `pending` row, and enqueues `enhance_photo` with the photo id as the arq job
id; the worker marks the row `processing`, then `completed` or `failed`. `POST /leaderboard/`
is a separate, non-user-auth path gated by a shared secret (`LEADERBOARD_SHARED_SECRET`,
`X-Leaderboard-Secret` header) for a local MLflow benchmark script. `DELETE /account/` relies on
`photos.user_id`'s `ON DELETE CASCADE` FK to clean up rows once the auth user is deleted, then
removes storage objects. Both photo and account deletion drop rows before objects, so an in-flight
job fails to complete and removes its own Enhanced Image.

## Maintaining this file

Keep this file for knowledge useful to almost every future agent session in this project.
Do not repeat what the codebase already shows; point to the authoritative file or command instead.
Prefer rewriting or pruning existing entries over appending new ones.
When updating this file, preserve this bar for all agents and keep entries concise.
