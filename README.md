# DiveVision

DiveVision explores solutions for **underwater image restoration / enhancement**. The project
has two current strands of work:

1. **Experiment workflow** — testing and comparing underwater image enhancement models
   (currently [U-Shape Transformer](https://github.com/LintaoPeng/U-shape_Transformer_for_Underwater_Image_Enhancement)
   and [CE-VAE](https://github.com/iN1k1/ce-vae-underwater-image-enhancement)), benchmarked with
   MLflow against the LSUI and UIEB datasets.
2. **Mobile app serving the tested models** — very early stage. The current goal is simply to
   serve a model's output to a mobile client. Social-network features and photo geolocation are
   **future work**, not part of the current scope.

## What exists today

- **Model wrappers** for U-Shape Transformer and CE-VAE (`divevision/models/`,
  `divevision/src/models/`), sharing a common `AbstractModel` interface
  (`divevision/src/models/abstract_model.py`).
- **A benchmark pipeline** (`divevision/src/test.py`) that runs each model against the LSUI and
  UIEB datasets, computes SSIM/PSNR metrics, and logs runs to MLflow.
- **A FastAPI server** (`divevision/src/app/main.py`) and an **arq worker**
  (`divevision/src/app/worker.py`) backed by Supabase (auth, photo storage, a `photos` table)
  and Redis. Clients sign in with Supabase directly and read their own photos from it (rows,
  storage objects, Realtime status updates — owner-only via RLS); the API verifies their
  Supabase access token and exposes only `POST /photos/` (store the original, queue its
  U-Shape Transformer enhancement, return the photo id at once), `DELETE /photos/{id}/`,
  `DELETE /account/` (full GDPR account erasure), and a shared-secret-gated
  `POST /leaderboard/` used by the benchmark pipeline to record scores. See
  `docs/adr/0002-async-enhancement-and-rls-boundary.md`. No client consumes it yet.
- **Tests** for the models and the FastAPI app (`divevision/test/`).

## Roadmap (not implemented yet)

- Training a model from scratch (the README previously implied this existed — it does not; only
  inference over pretrained checkpoints is implemented).
- A single Expo client (web first, then mobile) consuming the API and Supabase (issue #17).
- Social-network features and photo geolocation — explicitly out of scope until the above lands.

## Installation

### Prerequisites

- Python 3.12
- [Poetry](https://python-poetry.org/)
- Clone the repository

### Steps

1. `poetry install`
2. Download pretrained model weights: `./download_resources.sh`
   - This fetches only **model weights**, not the datasets (see below).
   - The CE-VAE checkpoint (`lsui-cevae-epoch119.ckpt`) is fetched from a GitHub Release asset
     on this repo (`cevae-checkpoint-v1` tag), and the U-Shape Transformer weights from Google
     Drive.
3. Download the datasets yourself — **this is not automated by any script in this repo**:
   - [LSUI dataset](https://bianlab.github.io/data.html) — expected at `divevision/data/LSUI/`,
     with `GT/` and `input/` subdirectories (see `divevision/src/datasets/lsui_dataset.py`).
   - [UIEB dataset](https://li-chongyi.github.io/proj_benchmark.html) — expected at
     `divevision/data/UIEB/`, with `raw-890/` and `reference-890/` subdirectories (see
     `divevision/src/datasets/uieb_dataset.py`). Academic use only, per the dataset's terms.
4. Try the notebook `divevision/notebooks/test_model.ipynb` to check that a model runs
   end-to-end, using the poetry environment.

## Running the benchmark

`divevision/src/test.py` runs both models against both datasets and logs metrics to MLflow.

The supported way to run this is via Docker Compose, which supplies the required environment
variables to each container itself:

1. Copy `.env_example` to `.env` and fill in the MLflow/Supabase/S3 variables it expects.
2. `docker compose up postgres-dev mlflow` to start the local Postgres stand-in and the MLflow
   tracking server (backed by it, or by a Supabase Postgres DB / S3-compatible storage in
   non-local environments).
3. `docker compose --profile benchmark up benchmark` to run the benchmark against that MLflow
   server.

`mlflow_server.sh` and `poetry run python -m divevision.src.test` no longer load `.env`
themselves — they expect the environment to already be populated (as Docker Compose's
`env_file` does), so running them directly outside of `docker compose` requires exporting the
`.env` variables into your shell first.

## Running the FastAPI server and worker

Fill in this app's own Supabase project variables (`SUPABASE_URL`, `SUPABASE_KEY`,
`SUPABASE_SERVICE_ROLE_KEY`, `LEADERBOARD_SHARED_SECRET`) plus `REDIS_URL` and
`CORS_ALLOWED_ORIGINS` in `.env` — see `AGENTS.md` for why this is a separate Supabase project
from the MLflow tracking backend's. Validate `supabase/migrations/` locally with
`supabase start` (requires Docker) before relying on them.

Via Docker Compose (reads `.env` through `env_file`, no export needed), which starts the API,
the enhancement worker, and Redis:

```
docker compose up api worker
```

Or directly, with a Redis server reachable at `REDIS_URL`:

```
poetry run fastapi dev divevision/src/app/main.py
poetry run arq divevision.src.app.worker.WorkerSettings
```

All endpoints except `/leaderboard/` need `Authorization: Bearer <Supabase access token>`.
`POST /photos/` (multipart `file`, JPEG or PNG) answers `202 {"id": ..., "status": "pending"}`;
the worker then sets the photo's `photos.status` to `completed` (with `processed_path` in the
`processedimages` bucket) or `failed`. There is no mobile or web client in this repository yet.

## Running tests

```
poetry run pytest
```

The default run is offline. `divevision/test/test_rls_integration.py` proves the owner-only
access rules (rows, storage, Realtime) against a local Supabase stack and skips unless
`SUPABASE_TEST_URL`, `SUPABASE_TEST_ANON_KEY` and `SUPABASE_TEST_SERVICE_ROLE_KEY` are set —
see its docstring for running it after `supabase start`.

## Resources

- **U-Shape Transformer for Underwater Image Enhancement.** Peng L., Zhu C., Bian L., 2021.
  [Github](https://github.com/LintaoPeng/U-shape_Transformer_for_Underwater_Image_Enhancement) —
  [Paper](https://arxiv.org/abs/2111.11843)
- **CE-VAE: Capsule Enhanced Variational AutoEncoder for Underwater Image Enhancement.** Pucci R.,
  Martinal N., 2024.
  [Github](https://github.com/iN1k1/ce-vae-underwater-image-enhancement) —
  [Paper](https://arxiv.org/pdf/2406.01294v2)
