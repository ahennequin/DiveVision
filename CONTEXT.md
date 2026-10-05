# DiveVision — Underwater Image Enhancement

DiveVision has two strands, sharing the image and model vocabulary below:

- a research workflow for testing and comparing underwater image enhancement models: paired
  benchmark datasets, model wrappers around third-party architectures, quality metrics, and
  MLflow-based experiment tracking;
- an app that serves one Enhancement Model to Users: a FastAPI backend plus an arq worker,
  backed by Supabase (auth, storage, the `photos` table). Its client (Expo, web first) is not
  built yet.

## Language

### Images

**Degraded Image**:
An underwater photograph exhibiting color cast, haze, or contrast loss, before enhancement. The
input half of a paired sample in a Benchmark Dataset (e.g. LSUI's `input/`, UIEB's `raw-890/`).
_Avoid_: input image, raw image

**Reference Image**:
The clean, color-corrected counterpart to a Degraded Image, used as ground truth when scoring an
Enhanced Image (e.g. LSUI's `GT/`, UIEB's `reference-890/`).
_Avoid_: GT, ground truth, label, target

**Enhanced Image**:
The image an Enhancement Model produces by running its predict step on a Degraded Image.
_Avoid_: output image, restored image, prediction

### Models

**Enhancement Model**:
A wrapped, invokable model that maps a Degraded Image to an Enhanced Image, registered under a
short name (e.g. `"U-Shape"`, `"CVAE"`) and implementing the common `AbstractModel` interface
(`preprocessing` → forward pass → `postprocessing`). Currently two exist: U-Shape Transformer and
CE-VAE.
_Avoid_: model (ambiguous with Model Implementation below), network

**Model Implementation**:
The vendored third-party architecture code an Enhancement Model wraps unmodified
(`divevision/models/`), kept close to its upstream source so it stays diffable against the
original research repo. An Enhancement Model adapts one Model Implementation to the project's
common interface; the two are never the same object.
_Avoid_: model, wrapper (that's the Enhancement Model's role, not the implementation's)

**Checkpoint**:
The trained weights file an Enhancement Model loads into its Model Implementation before it can
run. Fetched separately from code, either via `download_resources.sh` (U-Shape Transformer) or a
config-referenced path (CE-VAE); an Enhancement Model without its Checkpoint present still
constructs but warns and runs with untrained weights.
_Avoid_: weights (fine as prose, but prefer Checkpoint as the noun for "the file")

### Data and evaluation

**Benchmark Dataset**:
A paired collection of Degraded Images and their corresponding Reference Images, used to evaluate
Enhancement Models. Currently LSUI and UIEB.
_Avoid_: dataset (only when precision matters — otherwise fine as shorthand)

**Evaluation Metric**:
A scoring function that compares an Enhanced Image against its Reference Image and produces a
numeric quality score. Currently SSIM and PSNR.
_Avoid_: score, measure

### Experiment tracking

**Experiment**:
The top-level MLflow container that groups every Benchmark Run for a given purpose (currently one
Experiment, `"Model testing"`, holds all of them).
_Avoid_: run (a Run is one execution inside an Experiment, not the container)

**Benchmark Run**:
One MLflow Run: the execution of one Enhancement Model against one full Benchmark Dataset,
producing per-batch and aggregate Evaluation Metric values plus elapsed-time figures logged to
MLflow.
_Avoid_: experiment (too broad — see Experiment above), test

### App

**User**:
A person with a Supabase Auth account. Signs in with Supabase directly; the API identifies them
by verifying their Supabase access token. Owns their Photos, and only they can read them.
_Avoid_: account (fine for the auth record itself, as in "delete my account"), customer

**Photo**:
One upload by a User and everything derived from it: the Original, the Enhanced Image once its
Enhancement Job succeeds, and its row in the `photos` table (which carries its Photo Status).
Clients can only read their own Photos; every write goes through the backend.
_Avoid_: image (a Photo has two images), upload (that's the act, not the thing)

**Original**:
The image file a User uploaded, stored unmodified in the `images` bucket — the app's Degraded
Image. Always owner-only, even if Photos become shareable later, because it may carry GPS/EXIF
data.
_Avoid_: raw image, input image

**Enhancement Job**:
The queued unit of work (arq over Redis) that turns one Photo's Original into its Enhanced Image
(stored in the `processedimages` bucket). Enqueued by the upload endpoint, run by the worker,
which loads the Enhancement Model once and acts with the service-role key because a job can
outlive the User's access token.
_Avoid_: task, request (the upload request returns before the job runs)

**Photo Status**:
Where a Photo is in its Enhancement Job's lifecycle: `pending` (stored and queued) →
`processing` (picked up by the worker) → `completed` (Enhanced Image stored) or `failed`.
Clients watch it change via Supabase Realtime.
_Avoid_: state, progress

## Out of scope

- Choosing among Enhancement Models in the app: it serves U-Shape only.
- Social features (sharing Photos publicly, geolocation). If added, only Enhanced Images would be
  shareable, never Originals.
