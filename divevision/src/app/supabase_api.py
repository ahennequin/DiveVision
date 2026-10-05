import logging
import os

import httpx
import storage3
import supabase
from dotenv import load_dotenv

logger = logging.getLogger(__name__)

load_dotenv()

SUPABASE_URL: str = os.environ.get("SUPABASE_URL", "")
SUPABASE_KEY: str = os.environ.get("SUPABASE_KEY", "")
SUPABASE_SERVICE_ROLE_KEY: str = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")

IMAGES_BUCKET = "images"
PROCESSED_IMAGES_BUCKET = "processedimages"

# PostgREST's `max_rows` (supabase/config.toml) and Storage's per-request
# remove limit are both 1000.
_PAGE_SIZE = 1000

_AUTH_ERRORS = (supabase.AuthApiError, supabase.AuthError)
_STORAGE_ERRORS = (storage3.exceptions.StorageApiError, supabase.AuthApiError)
_POSTGREST_ERRORS = (
    supabase.PostgrestAPIError,
    supabase.AuthApiError,
    httpx.HTTPError,
)


def get_client() -> supabase.Client:
    """Build a fresh, unauthenticated Supabase client using the public anon key.

    Only used to verify a caller's access token. A new client is created per
    call so no auth state is ever shared between concurrent requests.
    """
    return supabase.create_client(SUPABASE_URL, SUPABASE_KEY)


def get_admin_client() -> supabase.Client:
    """Build a client authenticated with the service-role key.

    Clients have read-only, owner-scoped access to `photos` and both buckets
    (see supabase/migrations/), so every write - by the API on behalf of a
    verified user, or by the worker after that user's token has expired -
    goes through this client. The key bypasses RLS and must never be handed
    to a caller outside the backend.
    """
    return supabase.create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)


def get_user_id(access_token: str) -> str | None:
    """Verify a Supabase access token with Supabase Auth and return its user id.

    Returns None if the token is invalid, expired, or revoked.
    """
    try:
        response = get_client().auth.get_user(access_token)
    except _AUTH_ERRORS as e:
        logger.info("Rejected access token: %s", e)
        return None

    if response is None or response.user is None:
        return None
    return response.user.id


# -- storage -------------------------------------------------------------------


def upload_image(
    file: bytes,
    bucket: str,
    path: str,
    content_type: str,
    upsert: bool = False,
) -> bool:
    """Upload image bytes to `bucket` at `path` (`<user_id>/<file>`)."""
    try:
        get_admin_client().storage.from_(bucket).upload(
            path=path,
            file=file,
            file_options={
                "content-type": content_type,
                "upsert": "true" if upsert else "false",
            },
        )
    except _STORAGE_ERRORS as e:
        logger.error(e)
        return False
    else:
        return True


def download_image(bucket: str, path: str) -> bytes | None:
    try:
        return get_admin_client().storage.from_(bucket).download(path)
    except _STORAGE_ERRORS as e:
        logger.error(e)
        return None


def delete_images(bucket: str, paths: list[str]) -> bool:
    bucket_api = get_admin_client().storage.from_(bucket)
    try:
        # Storage caps how many objects one remove request may name.
        for start in range(0, len(paths), _PAGE_SIZE):
            bucket_api.remove(paths[start : start + _PAGE_SIZE])
    except _STORAGE_ERRORS as e:
        logger.error(e)
        return False
    else:
        return True


def _delete_photo_objects(photos: list[dict]) -> None:
    """Best-effort removal of the original and enhanced objects of `photos`."""
    delete_images(
        IMAGES_BUCKET, [p["original_path"] for p in photos if p["original_path"]]
    )
    delete_images(
        PROCESSED_IMAGES_BUCKET,
        [p["processed_path"] for p in photos if p["processed_path"]],
    )


# -- photos table ----------------------------------------------------------------


def create_photo(
    photo_id: str,
    user_id: str,
    original_path: str,
    model_name: str,
) -> bool:
    """Insert a `pending` photos row for `user_id`."""
    try:
        get_admin_client().table("photos").insert(
            {
                "id": photo_id,
                "user_id": user_id,
                "original_path": original_path,
                "model_name": model_name,
                "status": "pending",
            }
        ).execute()
    except _POSTGREST_ERRORS as e:
        logger.error(e)
        return False
    else:
        return True


class PhotoLookupError(Exception):
    """Reading a photos row failed, so whether it exists is unknown."""


def _photo_query(photo_id: str):
    return get_admin_client().table("photos").select("*").eq("id", photo_id)


def find_photo(photo_id: str) -> dict | None:
    """Fetch a photos row for the worker, regardless of owner.

    Returns None only when the row is confirmed missing; raises
    `PhotoLookupError` when the lookup itself fails.
    """
    try:
        response = _photo_query(photo_id).execute()
    except _POSTGREST_ERRORS as e:
        raise PhotoLookupError(photo_id) from e
    return response.data[0] if response.data else None


def get_photo(photo_id: str, user_id: str) -> dict | None:
    """Fetch a photos row only if it belongs to `user_id`, else None.

    The admin client bypasses RLS, so this owner filter is the access check.
    """
    try:
        response = _photo_query(photo_id).eq("user_id", user_id).execute()
    except _POSTGREST_ERRORS as e:
        logger.error(e)
        return None
    return response.data[0] if response.data else None


def _update_photo(photo_id: str, values: dict) -> bool:
    """Update a photos row; False if it errored or no longer exists."""
    try:
        response = (
            get_admin_client()
            .table("photos")
            .update(values)
            .eq("id", photo_id)
            .execute()
        )
    except _POSTGREST_ERRORS as e:
        logger.error(e)
        return False
    else:
        return bool(response.data)


def mark_photo_processing(photo_id: str) -> bool:
    return _update_photo(photo_id, {"status": "processing"})


def mark_photo_completed(photo_id: str, processed_path: str) -> bool:
    return _update_photo(
        photo_id, {"status": "completed", "processed_path": processed_path}
    )


def mark_photo_failed(photo_id: str) -> bool:
    return _update_photo(photo_id, {"status": "failed"})


def delete_photo_row(photo_id: str) -> bool:
    try:
        get_admin_client().table("photos").delete().eq("id", photo_id).execute()
    except _POSTGREST_ERRORS as e:
        logger.error(e)
        return False
    else:
        return True


def delete_photo(photo_id: str, user_id: str) -> bool:
    """Delete one of `user_id`'s photos: both storage objects, then its row.

    Returns False if the photo does not exist or belongs to someone else.
    """
    photo = get_photo(photo_id, user_id=user_id)
    if photo is None:
        return False

    _delete_photo_objects([photo])
    return delete_photo_row(photo_id)


def delete_account(user_id: str) -> bool:
    """Erase a user: every photo's storage objects, then the auth user itself.

    Deleting the auth user cascades (via the `photos.user_id` foreign key)
    to remove every remaining `photos` row, so rows do not need to be
    deleted one by one here - only the storage objects, which have no such
    cascade.
    """
    client = get_admin_client()
    photos: list[dict] = []
    try:
        # PostgREST caps each response (`max_rows`), so page through them all.
        while True:
            page = (
                client.table("photos")
                .select("original_path, processed_path")
                .eq("user_id", user_id)
                .order("id")
                .range(len(photos), len(photos) + _PAGE_SIZE - 1)
                .execute()
            )
            photos.extend(page.data)
            if len(page.data) < _PAGE_SIZE:
                break
    except _POSTGREST_ERRORS as e:
        logger.error(e)
        return False

    _delete_photo_objects(photos)

    try:
        client.auth.admin.delete_user(user_id)
    except _AUTH_ERRORS as e:
        logger.error(e)
        return False
    else:
        return True


# -- leaderboard -------------------------------------------------------------------


def insert_leaderboard_entry(
    model_name: str,
    dataset_name: str,
    metric_name: str,
    score: float,
) -> bool:
    """Write a leaderboard row using the service-role key.

    Called from the `/leaderboard` endpoint on behalf of a local benchmark
    script, which never receives any Supabase key itself.
    """
    try:
        get_admin_client().table("leaderboard").insert(
            {
                "model_name": model_name,
                "dataset_name": dataset_name,
                "metric_name": metric_name,
                "score": score,
            }
        ).execute()
    except _POSTGREST_ERRORS as e:
        logger.error(e)
        return False
    else:
        return True
