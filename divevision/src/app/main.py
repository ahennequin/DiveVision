import io
import logging
import os
import secrets
import uuid
from contextlib import asynccontextmanager
from typing import Annotated, Literal

from arq import ArqRedis, create_pool
from arq.connections import RedisSettings
from fastapi import Depends, FastAPI, File, Header, HTTPException, Response, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from PIL import Image, UnidentifiedImageError
from pydantic import BaseModel, ConfigDict
from redis.exceptions import RedisError

from divevision.src.app import supabase_api
from divevision.src.app.enhancement import MODEL_NAME

logger = logging.getLogger(__name__)

REDIS_URL = os.environ.get("REDIS_URL", "redis://localhost:6379")
# Comma-separated origins allowed to call the API from a browser (the Expo
# web client); 8081 is the Expo dev server's default port.
_cors_origins = os.environ.get("CORS_ALLOWED_ORIGINS", "http://localhost:8081")
CORS_ALLOWED_ORIGINS = [o.strip() for o in _cors_origins.split(",") if o.strip()]

# Same cap as the storage buckets' `file_size_limit` (supabase/migrations/).
MAX_UPLOAD_BYTES = 50 * 1024 * 1024
# Formats the buckets accept (`allowed_mime_types`), keyed by PIL format.
ACCEPTED_FORMATS = {"JPEG": ("image/jpeg", "jpg"), "PNG": ("image/png", "png")}


@asynccontextmanager
async def lifespan(app: FastAPI):
    yield
    queue: ArqRedis | None = getattr(app.state, "queue", None)
    if queue is not None:
        await queue.aclose()


app = FastAPI(lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ALLOWED_ORIGINS,
    allow_methods=["POST", "DELETE"],
    allow_headers=["Authorization", "Content-Type"],
)


class PhotoCreated(BaseModel):
    id: uuid.UUID
    status: Literal["pending"]


class LeaderboardEntry(BaseModel):
    model_config = ConfigDict(protected_namespaces=())

    model_name: str
    dataset_name: str
    metric_name: str
    score: float


bearer_scheme = HTTPBearer(auto_error=False)


def current_user_id(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer_scheme)],
) -> str:
    """Verify the caller's Supabase access token (`Authorization: Bearer`)."""
    user_id = supabase_api.get_user_id(credentials.credentials) if credentials else None
    if user_id is None:
        raise HTTPException(
            status_code=401,
            detail="Invalid or missing access token",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return user_id


async def get_queue() -> ArqRedis:
    """The arq Redis pool, created on first use and closed on shutdown."""
    queue: ArqRedis | None = getattr(app.state, "queue", None)
    if queue is None:
        try:
            queue = await create_pool(RedisSettings.from_dsn(REDIS_URL))
        except (RedisError, OSError):
            logger.exception("Could not connect to the job queue")
            raise HTTPException(status_code=503, detail="Enhancement queue unavailable")
        app.state.queue = queue
    return queue


def _sniff_image(contents: bytes) -> tuple[str, str]:
    """Return (content type, extension) of an accepted image, else raise 400."""
    try:
        with Image.open(io.BytesIO(contents)) as image:
            image_format = image.format
            image.verify()
    except (
        UnidentifiedImageError,
        Image.DecompressionBombError,
        OSError,
        SyntaxError,
        ValueError,
    ):
        raise HTTPException(status_code=400, detail="Invalid image file")

    if image_format not in ACCEPTED_FORMATS:
        raise HTTPException(status_code=400, detail="Only JPEG and PNG are supported")
    return ACCEPTED_FORMATS[image_format]


@app.post("/photos/", status_code=202, response_model=PhotoCreated)
async def upload_photo(
    user_id: Annotated[str, Depends(current_user_id)],
    queue: Annotated[ArqRedis, Depends(get_queue)],
    file: UploadFile = File(...),
):
    """Store the original photo, record it as `pending`, and queue its enhancement.

    Returns immediately; the worker later sets the row's status to
    `completed` (with `processed_path`) or `failed`. Clients follow progress
    by reading their `photos` row from Supabase (or via Realtime).
    """
    contents = await file.read(MAX_UPLOAD_BYTES + 1)
    if len(contents) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="Image is too large")
    content_type, extension = _sniff_image(contents)

    photo_id = str(uuid.uuid4())
    original_path = f"{user_id}/{photo_id}.{extension}"

    if not supabase_api.upload_image(
        contents, supabase_api.IMAGES_BUCKET, original_path, content_type
    ):
        raise HTTPException(status_code=502, detail="Could not store the photo")

    if not supabase_api.create_photo(photo_id, user_id, original_path, MODEL_NAME):
        supabase_api.delete_images(supabase_api.IMAGES_BUCKET, [original_path])
        raise HTTPException(status_code=502, detail="Could not record the photo")

    try:
        # The photo id doubles as the job id, so a job is never queued twice.
        await queue.enqueue_job("enhance_photo", photo_id, _job_id=photo_id)
    except (RedisError, OSError):
        logger.exception("Could not enqueue enhancement for photo %s", photo_id)
        supabase_api.delete_photo_row(photo_id)
        supabase_api.delete_images(supabase_api.IMAGES_BUCKET, [original_path])
        raise HTTPException(status_code=503, detail="Enhancement queue unavailable")

    return PhotoCreated(id=uuid.UUID(photo_id), status="pending")


@app.delete("/photos/{photo_id}/", status_code=204)
async def delete_photo(
    photo_id: uuid.UUID,
    user_id: Annotated[str, Depends(current_user_id)],
):
    """Delete one of the caller's photos (both images and its row)."""
    if not supabase_api.delete_photo(str(photo_id), user_id):
        raise HTTPException(status_code=404, detail="Photo not found")
    return Response(status_code=204)


@app.delete("/account/", status_code=204)
async def delete_account(
    user_id: Annotated[str, Depends(current_user_id)],
):
    """Erase the caller's account: the auth user (cascading rows), then storage."""
    if not supabase_api.delete_account(user_id):
        raise HTTPException(status_code=400, detail="Could not delete account")
    return Response(status_code=204)


def leaderboard_auth(x_leaderboard_secret: Annotated[str, Header()]) -> None:
    """Shared-secret check for the internal leaderboard endpoint.

    Not a user-auth flow: this is called by a local MLflow benchmark script
    that never receives any Supabase key. Fails closed if the secret isn't
    configured server-side.
    """
    expected = os.environ.get("LEADERBOARD_SHARED_SECRET", "")
    if not expected or not secrets.compare_digest(x_leaderboard_secret, expected):
        raise HTTPException(status_code=401, detail="Invalid leaderboard secret")


@app.post("/leaderboard/", status_code=201)
async def record_leaderboard_entry(
    entry: LeaderboardEntry,
    _: None = Depends(leaderboard_auth),
):
    if not supabase_api.insert_leaderboard_entry(
        entry.model_name, entry.dataset_name, entry.metric_name, entry.score
    ):
        raise HTTPException(
            status_code=502, detail="Could not record leaderboard entry"
        )
    return {"detail": "recorded"}
