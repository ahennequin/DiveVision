"""arq worker that runs Enhancement Jobs queued by `POST /photos/`.

Run with `arq divevision.src.app.worker.WorkerSettings` (the `worker`
service in docker-compose.yml). The model is loaded once per worker process
on startup. Jobs use the Supabase service-role key, because a job can
outlive the access token of the user who uploaded the photo.
"""

import asyncio
import logging
import os

from arq.connections import RedisSettings
from arq.worker import Retry

from divevision.src.app import supabase_api
from divevision.src.app.enhancement import (
    ENHANCED_CONTENT_TYPE,
    enhance_image,
    load_model,
)

logger = logging.getLogger(__name__)

REDIS_URL = os.environ.get("REDIS_URL", "redis://localhost:6379")
# Ride out a Supabase outage of ~25 minutes: 10s, 20s, 40s, ... capped at 5 min.
MAX_TRIES = 10
RETRY_BASE_DELAY = 10
RETRY_MAX_DELAY = 300


def retry_delay(job_try: int) -> int:
    return min(RETRY_BASE_DELAY * 2 ** (job_try - 1), RETRY_MAX_DELAY)


def _retry_or_fail(photo_id: str, job_try: int) -> str:
    """Supabase is unavailable: retry the job later, or give up on the last try.

    Giving up makes a best-effort attempt to record `failed`.
    """
    if job_try < MAX_TRIES:
        logger.warning("Supabase unavailable for photo %s; retrying", photo_id)
        raise Retry(defer=retry_delay(job_try))
    logger.error("Giving up on photo %s after %d tries", photo_id, job_try)
    if not supabase_api.mark_photo_failed(photo_id):
        logger.error("Could not mark photo %s failed; it stays stuck", photo_id)
    return "failed"


def process_photo(model, photo_id: str, job_try: int = 1) -> str:
    """Enhance one photo and record the outcome on its `photos` row.

    Returns the final status ("completed", "failed", or "skipped" when the
    row no longer exists or was already finished). Never raises for a bad
    photo: any failure is recorded as `failed` instead of retried. Raises
    `arq.worker.Retry` (with backoff) if Supabase can't be read or the final
    status can't be written, so the whole job runs again; on the last of
    `MAX_TRIES` it marks the row `failed` if it still can.
    """
    try:
        photo = supabase_api.find_photo(photo_id)
    except supabase_api.PhotoLookupError:
        return _retry_or_fail(photo_id, job_try)
    if photo is None:
        logger.info("Photo %s was deleted before it was processed", photo_id)
        return "skipped"
    if photo["status"] in ("completed", "failed"):
        return "skipped"

    if not supabase_api.mark_photo_processing(photo_id):
        logger.warning("Could not mark photo %s processing", photo_id)

    try:
        original = supabase_api.download_image(
            supabase_api.IMAGES_BUCKET, photo["original_path"]
        )
        if original is None:
            raise RuntimeError("could not download the original photo")

        enhanced = enhance_image(model, original)

        processed_path = supabase_api.processed_path_for(photo["original_path"])
        if not supabase_api.upload_image(
            enhanced,
            supabase_api.PROCESSED_IMAGES_BUCKET,
            processed_path,
            ENHANCED_CONTENT_TYPE,
            upsert=True,  # a retried job overwrites its own earlier output
        ):
            raise RuntimeError("could not store the enhanced photo")
    except Exception:
        logger.exception("Enhancement failed for photo %s", photo_id)
        if supabase_api.mark_photo_failed(photo_id):
            return "failed"
        return _retry_or_fail(photo_id, job_try)

    if supabase_api.mark_photo_completed(photo_id, processed_path):
        return "completed"

    # The row vanished mid-job (photo or account deleted): don't leave an
    # orphaned enhanced image behind. If it still exists (or we can't tell),
    # the update itself failed, so retry rather than leave it `processing`.
    try:
        row_gone = supabase_api.find_photo(photo_id) is None
    except supabase_api.PhotoLookupError:
        row_gone = False
    if row_gone:
        supabase_api.delete_images(
            supabase_api.PROCESSED_IMAGES_BUCKET, [processed_path]
        )
        return "skipped"
    return _retry_or_fail(photo_id, job_try)


async def enhance_photo(ctx: dict, photo_id: str) -> str:
    """arq job: enhance the photo `photo_id` (job id is the photo id too)."""
    # Inference and supabase-py calls are blocking; keep them off the event loop
    # so arq can still heartbeat and enforce `job_timeout`.
    return await asyncio.to_thread(
        process_photo, ctx["model"], photo_id, ctx["job_try"]
    )


async def startup(ctx: dict) -> None:
    ctx["model"] = load_model()


class WorkerSettings:
    functions = [enhance_photo]
    on_startup = startup
    redis_settings = RedisSettings.from_dsn(REDIS_URL)
    # One CPU-bound inference at a time per process; scale by adding workers.
    max_jobs = 1
    job_timeout = 300
    max_tries = MAX_TRIES
