import io

import pytest
from fastapi.testclient import TestClient
from PIL import Image
from redis.exceptions import ConnectionError as RedisConnectionError

from divevision.src.app import main, supabase_api
from divevision.src.app.main import app

client = TestClient(app)

AUTH_HEADERS = {"Authorization": "Bearer access"}
USER_ID = "11111111-1111-1111-1111-111111111111"
PHOTO_ID = "22222222-2222-2222-2222-222222222222"


class FakeQueue:
    def __init__(self, error: Exception | None = None):
        self.jobs = []
        self.error = error

    async def enqueue_job(self, function, *args, _job_id=None):
        if self.error is not None:
            raise self.error
        self.jobs.append((function, args, _job_id))


@pytest.fixture
def queue():
    fake = FakeQueue()
    app.dependency_overrides[main.get_queue] = lambda: fake
    yield fake
    app.dependency_overrides.pop(main.get_queue, None)


@pytest.fixture
def signed_in(monkeypatch):
    """Accept the `access` token as USER_ID's, reject anything else."""
    monkeypatch.setattr(
        supabase_api,
        "get_user_id",
        lambda token: USER_ID if token == "access" else None,
    )


@pytest.fixture
def storage(monkeypatch):
    """Record storage/row writes; every call succeeds unless overridden."""
    calls = {"uploads": [], "deleted_images": [], "created": [], "deleted_rows": []}
    monkeypatch.setattr(
        supabase_api,
        "upload_image",
        lambda file, bucket, path, content_type, upsert=False: calls["uploads"].append(
            (bucket, path, content_type)
        )
        or True,
    )
    monkeypatch.setattr(
        supabase_api,
        "delete_images",
        lambda bucket, paths: calls["deleted_images"].append((bucket, paths)) or True,
    )
    monkeypatch.setattr(
        supabase_api,
        "create_photo",
        lambda photo_id, user_id, original_path, model_name: calls["created"].append(
            (photo_id, user_id, original_path, model_name)
        )
        or True,
    )
    monkeypatch.setattr(
        supabase_api,
        "delete_photo_row",
        lambda photo_id: calls["deleted_rows"].append(photo_id) or True,
    )
    return calls


def _image_bytes(image_format="PNG"):
    buffer = io.BytesIO()
    Image.new("RGB", (16, 16)).save(buffer, image_format)
    return buffer.getvalue()


def _upload(content, filename="foo.png", content_type="image/png", headers=None):
    return client.post(
        "/photos/",
        files={"file": (filename, content, content_type)},
        headers=AUTH_HEADERS if headers is None else headers,
    )


# -- auth ------------------------------------------------------------------------


def test_removed_endpoints_are_gone():
    assert client.post("/signup/", json={}).status_code == 404
    assert client.post("/login/", json={}).status_code == 404
    assert client.post("/image/").status_code == 404


def test_upload_requires_bearer_token(signed_in, queue, storage):
    response = _upload(_image_bytes(), headers={})
    assert response.status_code == 401
    assert response.headers["www-authenticate"] == "Bearer"
    assert storage["uploads"] == []


def test_upload_rejects_invalid_token(signed_in, queue, storage):
    response = _upload(_image_bytes(), headers={"Authorization": "Bearer forged"})
    assert response.status_code == 401
    assert storage["uploads"] == []


# -- POST /photos/ -----------------------------------------------------------------


@pytest.mark.parametrize(
    "image_format, content_type, extension",
    [("PNG", "image/png", "png"), ("JPEG", "image/jpeg", "jpg")],
)
def test_upload_stores_original_records_pending_and_enqueues(
    signed_in, queue, storage, image_format, content_type, extension
):
    response = _upload(_image_bytes(image_format))

    assert response.status_code == 202
    body = response.json()
    assert body["status"] == "pending"
    photo_id = body["id"]

    original_path = f"{USER_ID}/{photo_id}.{extension}"
    assert storage["uploads"] == [
        (supabase_api.IMAGES_BUCKET, original_path, content_type)
    ]
    assert storage["created"] == [(photo_id, USER_ID, original_path, "U-Shape")]
    assert queue.jobs == [("enhance_photo", (photo_id,), photo_id)]


def test_upload_rejects_non_image(signed_in, queue, storage):
    response = _upload(b"not an image", filename="foo.txt", content_type="text/plain")
    assert response.status_code == 400
    assert storage["uploads"] == []
    assert queue.jobs == []


def test_upload_rejects_decompression_bomb(signed_in, queue, storage, monkeypatch):
    monkeypatch.setattr(Image, "MAX_IMAGE_PIXELS", 100)
    response = _upload(_image_bytes())
    assert response.status_code == 400
    assert response.json()["detail"] == "Invalid image file"
    assert storage["uploads"] == []
    assert queue.jobs == []


def test_upload_rejects_unsupported_format(signed_in, queue, storage):
    response = _upload(
        _image_bytes("GIF"), filename="foo.gif", content_type="image/gif"
    )
    assert response.status_code == 400
    assert storage["uploads"] == []


def test_upload_rejects_too_large(signed_in, queue, storage, monkeypatch):
    monkeypatch.setattr(main, "MAX_UPLOAD_BYTES", 10)
    response = _upload(_image_bytes())
    assert response.status_code == 413
    assert storage["uploads"] == []


def test_upload_fails_when_original_cannot_be_stored(
    signed_in, queue, storage, monkeypatch
):
    monkeypatch.setattr(supabase_api, "upload_image", lambda *a, **kw: False)
    response = _upload(_image_bytes())
    assert response.status_code == 502
    assert storage["created"] == []
    assert queue.jobs == []


def test_upload_removes_original_when_row_cannot_be_recorded(
    signed_in, queue, storage, monkeypatch
):
    monkeypatch.setattr(supabase_api, "create_photo", lambda *a: False)
    response = _upload(_image_bytes())
    assert response.status_code == 502
    [(bucket, [path])] = storage["deleted_images"]
    assert bucket == supabase_api.IMAGES_BUCKET
    assert path.startswith(f"{USER_ID}/")
    assert queue.jobs == []


def test_upload_rolls_back_when_queue_rejects_job(signed_in, storage):
    failing_queue = FakeQueue(error=RedisConnectionError("redis down"))
    app.dependency_overrides[main.get_queue] = lambda: failing_queue
    try:
        response = _upload(_image_bytes())
    finally:
        app.dependency_overrides.pop(main.get_queue, None)

    assert response.status_code == 503
    [(photo_id, _, original_path, _)] = storage["created"]
    assert storage["deleted_rows"] == [photo_id]
    assert storage["deleted_images"] == [(supabase_api.IMAGES_BUCKET, [original_path])]


def test_upload_returns_503_when_queue_unreachable(signed_in, storage, monkeypatch):
    async def unreachable(settings):
        raise RedisConnectionError("redis down")

    monkeypatch.setattr(main, "create_pool", unreachable)
    monkeypatch.setattr(app.state, "queue", None, raising=False)

    response = _upload(_image_bytes())

    assert response.status_code == 503
    assert storage["uploads"] == []


# -- DELETE /photos/{id}/ and /account/ -----------------------------------------------


def test_delete_photo(signed_in, monkeypatch):
    calls = []
    monkeypatch.setattr(
        supabase_api,
        "delete_photo",
        lambda photo_id, user_id: calls.append((photo_id, user_id)) or True,
    )
    response = client.delete(f"/photos/{PHOTO_ID}/", headers=AUTH_HEADERS)
    assert response.status_code == 204
    assert calls == [(PHOTO_ID, USER_ID)]


def test_delete_photo_not_found(signed_in, monkeypatch):
    monkeypatch.setattr(supabase_api, "delete_photo", lambda photo_id, user_id: False)
    response = client.delete(f"/photos/{PHOTO_ID}/", headers=AUTH_HEADERS)
    assert response.status_code == 404


def test_delete_photo_rejects_malformed_id(signed_in):
    response = client.delete("/photos/not-a-uuid/", headers=AUTH_HEADERS)
    assert response.status_code == 422


def test_delete_photo_requires_auth(signed_in):
    response = client.delete(f"/photos/{PHOTO_ID}/")
    assert response.status_code == 401


def test_delete_account(signed_in, monkeypatch):
    calls = []
    monkeypatch.setattr(
        supabase_api, "delete_account", lambda user_id: calls.append(user_id) or True
    )
    response = client.delete("/account/", headers=AUTH_HEADERS)
    assert response.status_code == 204
    assert calls == [USER_ID]


def test_delete_account_failure(signed_in, monkeypatch):
    monkeypatch.setattr(supabase_api, "delete_account", lambda user_id: False)
    response = client.delete("/account/", headers=AUTH_HEADERS)
    assert response.status_code == 400


def test_delete_account_requires_auth(signed_in):
    response = client.delete("/account/", headers={"Authorization": "Bearer forged"})
    assert response.status_code == 401


# -- CORS ----------------------------------------------------------------------------


def test_cors_allows_configured_expo_origin():
    origin = main.CORS_ALLOWED_ORIGINS[0]
    response = client.options(
        "/photos/",
        headers={
            "Origin": origin,
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "authorization",
        },
    )
    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == origin


def test_cors_rejects_unknown_origin():
    response = client.options(
        "/photos/",
        headers={
            "Origin": "https://evil.example.com",
            "Access-Control-Request-Method": "POST",
        },
    )
    assert "access-control-allow-origin" not in response.headers


# -- POST /leaderboard/ (unchanged) ----------------------------------------------------

LEADERBOARD_ENTRY = {
    "model_name": "U-Shape",
    "dataset_name": "UIEB",
    "metric_name": "ssim",
    "score": 0.9,
}


def test_leaderboard_rejects_missing_secret(monkeypatch):
    monkeypatch.setenv("LEADERBOARD_SHARED_SECRET", "top-secret")
    response = client.post("/leaderboard/", json=LEADERBOARD_ENTRY)
    assert response.status_code == 422  # missing required header


def test_leaderboard_rejects_wrong_secret(monkeypatch):
    monkeypatch.setenv("LEADERBOARD_SHARED_SECRET", "top-secret")
    response = client.post(
        "/leaderboard/",
        json=LEADERBOARD_ENTRY,
        headers={"X-Leaderboard-Secret": "wrong"},
    )
    assert response.status_code == 401


def test_leaderboard_rejects_when_secret_not_configured(monkeypatch):
    monkeypatch.delenv("LEADERBOARD_SHARED_SECRET", raising=False)
    response = client.post(
        "/leaderboard/",
        json=LEADERBOARD_ENTRY,
        headers={"X-Leaderboard-Secret": ""},
    )
    assert response.status_code == 401


def test_leaderboard_accepts_correct_secret(monkeypatch):
    monkeypatch.setenv("LEADERBOARD_SHARED_SECRET", "top-secret")
    recorded = []
    monkeypatch.setattr(
        supabase_api,
        "insert_leaderboard_entry",
        lambda model_name, dataset_name, metric_name, score: recorded.append(
            (model_name, dataset_name, metric_name, score)
        )
        or True,
    )

    response = client.post(
        "/leaderboard/",
        json=LEADERBOARD_ENTRY,
        headers={"X-Leaderboard-Secret": "top-secret"},
    )

    assert response.status_code == 201
    assert recorded == [("U-Shape", "UIEB", "ssim", 0.9)]
