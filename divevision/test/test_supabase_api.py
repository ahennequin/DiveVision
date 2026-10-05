from types import SimpleNamespace
from unittest.mock import MagicMock

import httpx
import pytest
import storage3
import supabase

from divevision.src.app import supabase_api


def _postgrest_error(message="boom"):
    return supabase.PostgrestAPIError(
        {"message": message, "code": "500", "hint": None, "details": None}
    )


def _storage_error(message="boom"):
    return storage3.exceptions.StorageApiError(message=message, code="500", status=500)


@pytest.fixture
def mock_client(monkeypatch):
    client = MagicMock()
    monkeypatch.setattr(supabase_api, "get_client", lambda: client)
    return client


@pytest.fixture
def mock_admin_client(monkeypatch):
    client = MagicMock()
    monkeypatch.setattr(supabase_api, "get_admin_client", lambda: client)
    return client


# -- get_user_id -------------------------------------------------------------------


def test_get_user_id_returns_verified_user(mock_client):
    mock_client.auth.get_user.return_value = SimpleNamespace(
        user=SimpleNamespace(id="user-123")
    )
    assert supabase_api.get_user_id("access") == "user-123"
    mock_client.auth.get_user.assert_called_once_with("access")


def test_get_user_id_rejects_invalid_token(mock_client):
    mock_client.auth.get_user.side_effect = supabase.AuthApiError(
        message="invalid JWT", status=401, code="bad_jwt"
    )
    assert supabase_api.get_user_id("forged") is None


def test_get_user_id_handles_missing_user(mock_client):
    mock_client.auth.get_user.return_value = None
    assert supabase_api.get_user_id("access") is None


# -- storage -----------------------------------------------------------------------


def test_upload_image(mock_admin_client):
    assert (
        supabase_api.upload_image(
            b"bytes", supabase_api.IMAGES_BUCKET, "user-123/a.png", "image/png"
        )
        is True
    )
    mock_admin_client.storage.from_.assert_called_with(supabase_api.IMAGES_BUCKET)
    upload = mock_admin_client.storage.from_.return_value.upload
    assert upload.call_args.kwargs == {
        "path": "user-123/a.png",
        "file": b"bytes",
        "file_options": {"content-type": "image/png", "upsert": "false"},
    }


def test_upload_image_upsert(mock_admin_client):
    supabase_api.upload_image(
        b"bytes",
        supabase_api.PROCESSED_IMAGES_BUCKET,
        "user-123/a.png",
        "image/png",
        upsert=True,
    )
    upload = mock_admin_client.storage.from_.return_value.upload
    assert upload.call_args.kwargs["file_options"]["upsert"] == "true"


def test_upload_image_storage_error(mock_admin_client):
    mock_admin_client.storage.from_.return_value.upload.side_effect = _storage_error()
    assert (
        supabase_api.upload_image(
            b"bytes", supabase_api.IMAGES_BUCKET, "user-123/a.png", "image/png"
        )
        is False
    )


def test_download_image(mock_admin_client):
    mock_admin_client.storage.from_.return_value.download.return_value = b"bytes"
    assert (
        supabase_api.download_image(supabase_api.IMAGES_BUCKET, "user-123/a.png")
        == b"bytes"
    )


def test_download_image_storage_error(mock_admin_client):
    mock_admin_client.storage.from_.return_value.download.side_effect = _storage_error()
    assert (
        supabase_api.download_image(supabase_api.IMAGES_BUCKET, "user-123/a.png")
        is None
    )


def test_delete_images_batches_requests(mock_admin_client, monkeypatch):
    monkeypatch.setattr(supabase_api, "_PAGE_SIZE", 2)
    assert supabase_api.delete_images("images", ["a", "b", "c"]) is True
    remove = mock_admin_client.storage.from_.return_value.remove
    assert [c.args[0] for c in remove.call_args_list] == [["a", "b"], ["c"]]


def test_delete_images_noop_for_empty_list(mock_admin_client):
    assert supabase_api.delete_images("images", []) is True
    mock_admin_client.storage.from_.return_value.remove.assert_not_called()


def test_delete_images_storage_error(mock_admin_client):
    mock_admin_client.storage.from_.return_value.remove.side_effect = _storage_error()
    assert supabase_api.delete_images("images", ["a"]) is False


# -- photos table ------------------------------------------------------------------


def test_create_photo(mock_admin_client):
    assert (
        supabase_api.create_photo("photo-1", "user-123", "user-123/a.png", "U-Shape")
        is True
    )
    mock_admin_client.table.assert_called_with("photos")
    mock_admin_client.table.return_value.insert.assert_called_once_with(
        {
            "id": "photo-1",
            "user_id": "user-123",
            "original_path": "user-123/a.png",
            "model_name": "U-Shape",
            "status": "pending",
        }
    )


def test_create_photo_failure(mock_admin_client):
    mock_admin_client.table.return_value.insert.return_value.execute.side_effect = (
        _postgrest_error()
    )
    assert (
        supabase_api.create_photo("photo-1", "user-123", "user-123/a.png", "U-Shape")
        is False
    )


def test_get_photo_scoped_to_owner(mock_admin_client):
    query = mock_admin_client.table.return_value.select.return_value.eq.return_value
    query.eq.return_value.execute.return_value = SimpleNamespace(
        data=[{"id": "photo-1"}]
    )

    assert supabase_api.get_photo("photo-1", user_id="user-123") == {"id": "photo-1"}
    query.eq.assert_called_once_with("user_id", "user-123")


def test_get_photo_none_on_postgrest_error(mock_admin_client):
    query = mock_admin_client.table.return_value.select.return_value.eq.return_value
    query.eq.return_value.execute.side_effect = _postgrest_error()
    assert supabase_api.get_photo("photo-1", user_id="user-123") is None


def test_find_photo_unscoped_for_worker(mock_admin_client):
    query = mock_admin_client.table.return_value.select.return_value.eq.return_value
    query.execute.return_value = SimpleNamespace(data=[{"id": "photo-1"}])

    assert supabase_api.find_photo("photo-1") == {"id": "photo-1"}
    query.eq.assert_not_called()


def test_find_photo_not_found(mock_admin_client):
    query = mock_admin_client.table.return_value.select.return_value.eq.return_value
    query.execute.return_value = SimpleNamespace(data=[])
    assert supabase_api.find_photo("photo-1") is None


def test_find_photo_raises_on_postgrest_error(mock_admin_client):
    query = mock_admin_client.table.return_value.select.return_value.eq.return_value
    query.execute.side_effect = _postgrest_error()
    with pytest.raises(supabase_api.PhotoLookupError):
        supabase_api.find_photo("photo-1")


@pytest.mark.parametrize(
    "error",
    [
        httpx.ConnectError("unreachable"),
        httpx.ReadTimeout("timed out"),
        httpx.RemoteProtocolError("disconnected"),
    ],
)
def test_find_photo_raises_on_transport_error(mock_admin_client, error):
    query = mock_admin_client.table.return_value.select.return_value.eq.return_value
    query.execute.side_effect = error
    with pytest.raises(supabase_api.PhotoLookupError):
        supabase_api.find_photo("photo-1")


def _update_call(mock_admin_client, data):
    update = mock_admin_client.table.return_value.update
    update.return_value.eq.return_value.execute.return_value = SimpleNamespace(
        data=data
    )
    return update


def test_mark_photo_processing(mock_admin_client):
    update = _update_call(mock_admin_client, [{"id": "photo-1"}])
    assert supabase_api.mark_photo_processing("photo-1") is True
    update.assert_called_once_with({"status": "processing"})


def test_mark_photo_completed(mock_admin_client):
    update = _update_call(mock_admin_client, [{"id": "photo-1"}])
    assert supabase_api.mark_photo_completed("photo-1", "user-123/a.png") is True
    update.assert_called_once_with(
        {"status": "completed", "processed_path": "user-123/a.png"}
    )


def test_mark_photo_completed_false_when_row_gone(mock_admin_client):
    _update_call(mock_admin_client, [])
    assert supabase_api.mark_photo_completed("photo-1", "user-123/a.png") is False


def test_mark_photo_failed(mock_admin_client):
    update = _update_call(mock_admin_client, [{"id": "photo-1"}])
    assert supabase_api.mark_photo_failed("photo-1") is True
    update.assert_called_once_with({"status": "failed"})


def test_mark_photo_failed_postgrest_error(mock_admin_client):
    update = mock_admin_client.table.return_value.update
    update.return_value.eq.return_value.execute.side_effect = _postgrest_error()
    assert supabase_api.mark_photo_failed("photo-1") is False


def test_mark_photo_failed_transport_error(mock_admin_client):
    update = mock_admin_client.table.return_value.update
    update.return_value.eq.return_value.execute.side_effect = httpx.ConnectError("down")
    assert supabase_api.mark_photo_failed("photo-1") is False


def test_delete_photo_removes_objects_and_row(mock_admin_client, monkeypatch):
    monkeypatch.setattr(
        supabase_api,
        "get_photo",
        lambda photo_id, user_id: {
            "id": photo_id,
            "original_path": "user-123/a.jpg",
            "processed_path": "user-123/a.png",
        },
    )
    calls = []
    monkeypatch.setattr(
        supabase_api,
        "delete_photo_row",
        lambda photo_id: calls.append(("row", photo_id)) or True,
    )
    monkeypatch.setattr(
        supabase_api,
        "delete_images",
        lambda bucket, paths: calls.append((bucket, paths)) or True,
    )

    assert supabase_api.delete_photo("photo-1", "user-123") is True

    assert calls == [
        ("row", "photo-1"),
        (supabase_api.IMAGES_BUCKET, ["user-123/a.jpg"]),
        (supabase_api.PROCESSED_IMAGES_BUCKET, ["user-123/a.png"]),
    ]


def test_delete_photo_keeps_objects_when_row_delete_fails(monkeypatch):
    monkeypatch.setattr(
        supabase_api,
        "get_photo",
        lambda photo_id, user_id: {
            "id": photo_id,
            "original_path": "user-123/a.jpg",
            "processed_path": "user-123/a.png",
        },
    )
    monkeypatch.setattr(supabase_api, "delete_photo_row", lambda photo_id: False)
    deleted = []
    monkeypatch.setattr(
        supabase_api,
        "delete_images",
        lambda bucket, paths: deleted.append((bucket, paths)) or True,
    )

    assert supabase_api.delete_photo("photo-1", "user-123") is False
    assert deleted == []


def test_delete_photo_removes_enhanced_image_without_processed_path(
    mock_admin_client, monkeypatch
):
    monkeypatch.setattr(
        supabase_api,
        "get_photo",
        lambda photo_id, user_id: {
            "id": photo_id,
            "original_path": "user-123/a.jpg",
            "processed_path": None,
        },
    )
    deleted = []
    monkeypatch.setattr(
        supabase_api,
        "delete_images",
        lambda bucket, paths: deleted.append((bucket, paths)) or True,
    )

    assert supabase_api.delete_photo("photo-1", "user-123") is True

    assert deleted == [
        (supabase_api.IMAGES_BUCKET, ["user-123/a.jpg"]),
        (supabase_api.PROCESSED_IMAGES_BUCKET, ["user-123/a.png"]),
    ]


def test_delete_photo_checks_owner(mock_admin_client, monkeypatch):
    seen = []
    monkeypatch.setattr(
        supabase_api,
        "get_photo",
        lambda photo_id, user_id: seen.append(user_id),
    )
    assert supabase_api.delete_photo("photo-1", "user-b") is False
    assert seen == ["user-b"]
    mock_admin_client.table.return_value.delete.assert_not_called()


# -- delete_account ----------------------------------------------------------------


def test_delete_account_removes_photos_and_auth_user(mock_admin_client, monkeypatch):
    monkeypatch.setattr(supabase_api, "_PAGE_SIZE", 2)
    query = (
        mock_admin_client.table.return_value.select.return_value.eq.return_value.order.return_value
    )
    query.range.return_value.execute.side_effect = [
        SimpleNamespace(
            data=[
                {"original_path": "user-123/a.jpg", "processed_path": "user-123/a.png"},
                {"original_path": "user-123/b.jpg", "processed_path": None},
            ]
        ),
        SimpleNamespace(
            data=[{"original_path": "user-123/c.png", "processed_path": None}]
        ),
    ]
    calls = []
    mock_admin_client.auth.admin.delete_user.side_effect = lambda user_id: calls.append(
        ("user", user_id)
    )
    monkeypatch.setattr(
        supabase_api,
        "delete_images",
        lambda bucket, paths: calls.append((bucket, paths)) or True,
    )

    assert supabase_api.delete_account("user-123") is True

    eq = mock_admin_client.table.return_value.select.return_value.eq
    assert {c.args for c in eq.call_args_list} == {("user_id", "user-123")}
    assert [c.args for c in query.range.call_args_list] == [(0, 1), (2, 3)]
    assert calls == [
        ("user", "user-123"),
        (
            supabase_api.IMAGES_BUCKET,
            ["user-123/a.jpg", "user-123/b.jpg", "user-123/c.png"],
        ),
        (
            supabase_api.PROCESSED_IMAGES_BUCKET,
            ["user-123/a.png", "user-123/b.png", "user-123/c.png"],
        ),
    ]


def test_delete_account_aborts_when_photos_unreadable(mock_admin_client):
    query = (
        mock_admin_client.table.return_value.select.return_value.eq.return_value.order.return_value
    )
    query.range.return_value.execute.side_effect = _postgrest_error()
    assert supabase_api.delete_account("user-123") is False
    mock_admin_client.auth.admin.delete_user.assert_not_called()


def test_delete_account_admin_delete_failure(mock_admin_client, monkeypatch):
    query = (
        mock_admin_client.table.return_value.select.return_value.eq.return_value.order.return_value
    )
    query.range.return_value.execute.return_value = SimpleNamespace(
        data=[{"original_path": "user-123/a.jpg", "processed_path": None}]
    )
    mock_admin_client.auth.admin.delete_user.side_effect = supabase.AuthApiError(
        message="boom", status=500, code=None
    )
    deleted = []
    monkeypatch.setattr(
        supabase_api,
        "delete_images",
        lambda bucket, paths: deleted.append((bucket, paths)) or True,
    )
    assert supabase_api.delete_account("user-123") is False
    assert deleted == []


# -- leaderboard -------------------------------------------------------------------


def test_insert_leaderboard_entry_success(mock_admin_client):
    assert supabase_api.insert_leaderboard_entry("U-Shape", "UIEB", "ssim", 0.9) is True
    mock_admin_client.table.assert_called_with("leaderboard")
    mock_admin_client.table.return_value.insert.assert_called_once_with(
        {
            "model_name": "U-Shape",
            "dataset_name": "UIEB",
            "metric_name": "ssim",
            "score": 0.9,
        }
    )


def test_insert_leaderboard_entry_failure(mock_admin_client):
    mock_admin_client.table.return_value.insert.return_value.execute.side_effect = (
        _postgrest_error()
    )
    assert (
        supabase_api.insert_leaderboard_entry("U-Shape", "UIEB", "ssim", 0.9) is False
    )
