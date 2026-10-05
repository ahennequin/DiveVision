import asyncio
import io

import pytest
from arq.worker import Retry
from PIL import Image

from divevision.src.app import enhancement, supabase_api, worker

PHOTO_ID = "22222222-2222-2222-2222-222222222222"
ORIGINAL_PATH = f"user-123/{PHOTO_ID}.jpg"
PROCESSED_PATH = f"user-123/{PHOTO_ID}.png"


class FakeModel:
    """Stands in for the U-Shape model: returns its (RGB) input unchanged."""

    name = "U-Shape"

    def __init__(self):
        self.inputs = []

    def predict(self, image):
        self.inputs.append(image)
        return [image]


def _image_bytes(mode="RGB", image_format="JPEG", size=(8, 4)):
    buffer = io.BytesIO()
    Image.new(mode, size).save(buffer, image_format)
    return buffer.getvalue()


@pytest.fixture
def photos(monkeypatch):
    """An in-memory `photos` table + storage, patched over supabase_api."""
    state = {
        "rows": {
            PHOTO_ID: {
                "id": PHOTO_ID,
                "status": "pending",
                "original_path": ORIGINAL_PATH,
                "processed_path": None,
            }
        },
        "objects": {(supabase_api.IMAGES_BUCKET, ORIGINAL_PATH): _image_bytes()},
        "statuses": [],
    }

    def update(photo_id, **values):
        row = state["rows"].get(photo_id)
        if row is None:
            return False
        row.update(values)
        state["statuses"].append(values["status"])
        return True

    def upload(file, bucket, path, content_type, upsert=False):
        state["objects"][(bucket, path)] = file
        return True

    def delete(bucket, paths):
        for path in paths:
            state["objects"].pop((bucket, path), None)
        return True

    monkeypatch.setattr(
        supabase_api, "find_photo", lambda photo_id: state["rows"].get(photo_id)
    )
    monkeypatch.setattr(
        supabase_api,
        "mark_photo_processing",
        lambda photo_id: update(photo_id, status="processing"),
    )
    monkeypatch.setattr(
        supabase_api,
        "mark_photo_completed",
        lambda photo_id, processed_path: update(
            photo_id, status="completed", processed_path=processed_path
        ),
    )
    monkeypatch.setattr(
        supabase_api,
        "mark_photo_failed",
        lambda photo_id: update(photo_id, status="failed"),
    )
    monkeypatch.setattr(
        supabase_api,
        "download_image",
        lambda bucket, path: state["objects"].get((bucket, path)),
    )
    monkeypatch.setattr(supabase_api, "upload_image", upload)
    monkeypatch.setattr(supabase_api, "delete_images", delete)
    return state


def test_process_photo_stores_enhanced_png_and_completes(photos):
    model = FakeModel()

    assert worker.process_photo(model, PHOTO_ID) == "completed"

    assert photos["statuses"] == ["processing", "completed"]
    assert photos["rows"][PHOTO_ID]["processed_path"] == PROCESSED_PATH
    enhanced = photos["objects"][(supabase_api.PROCESSED_IMAGES_BUCKET, PROCESSED_PATH)]
    assert Image.open(io.BytesIO(enhanced)).format == "PNG"
    assert len(model.inputs) == 1


def test_process_photo_skips_deleted_photo(photos):
    del photos["rows"][PHOTO_ID]
    model = FakeModel()

    assert worker.process_photo(model, PHOTO_ID) == "skipped"
    assert model.inputs == []


@pytest.mark.parametrize("status", ["completed", "failed"])
def test_process_photo_skips_finished_photo(photos, status):
    photos["rows"][PHOTO_ID]["status"] = status
    model = FakeModel()

    assert worker.process_photo(model, PHOTO_ID) == "skipped"
    assert model.inputs == []


def test_process_photo_marks_failed_when_original_missing(photos):
    photos["objects"].clear()

    assert worker.process_photo(FakeModel(), PHOTO_ID) == "failed"
    assert photos["statuses"] == ["processing", "failed"]


def test_process_photo_marks_failed_when_model_raises(photos):
    class BrokenModel:
        def predict(self, image):
            raise RuntimeError("CUDA out of memory")

    assert worker.process_photo(BrokenModel(), PHOTO_ID) == "failed"
    assert photos["statuses"] == ["processing", "failed"]


def test_process_photo_marks_failed_when_upload_fails(photos, monkeypatch):
    monkeypatch.setattr(supabase_api, "upload_image", lambda *a, **kw: False)

    assert worker.process_photo(FakeModel(), PHOTO_ID) == "failed"
    assert photos["statuses"] == ["processing", "failed"]


def test_process_photo_removes_output_when_photo_deleted_mid_job(photos, monkeypatch):
    real_upload = supabase_api.upload_image

    def upload_then_user_deletes_photo(*args, **kwargs):
        result = real_upload(*args, **kwargs)
        del photos["rows"][PHOTO_ID]
        return result

    monkeypatch.setattr(supabase_api, "upload_image", upload_then_user_deletes_photo)

    assert worker.process_photo(FakeModel(), PHOTO_ID) == "skipped"
    assert (supabase_api.PROCESSED_IMAGES_BUCKET, PROCESSED_PATH) not in photos[
        "objects"
    ]


def _failing_lookup(photo_id):
    raise supabase_api.PhotoLookupError(photo_id)


def test_process_photo_retries_when_lookup_fails(photos, monkeypatch):
    monkeypatch.setattr(supabase_api, "find_photo", _failing_lookup)
    model = FakeModel()

    with pytest.raises(Retry):
        worker.process_photo(model, PHOTO_ID)
    assert model.inputs == []
    assert photos["statuses"] == []


def test_process_photo_backs_off_between_lookup_retries(photos, monkeypatch):
    monkeypatch.setattr(supabase_api, "find_photo", _failing_lookup)

    delays = []
    for job_try in range(1, worker.MAX_TRIES):
        with pytest.raises(Retry) as retry:
            worker.process_photo(FakeModel(), PHOTO_ID, job_try)
        delays.append(retry.value.defer_score)

    assert delays == sorted(delays)
    assert delays[0] < delays[-1] == worker.RETRY_MAX_DELAY * 1000
    assert sum(delays) / 1000 >= 20 * 60
    assert photos["statuses"] == []


def test_process_photo_marks_failed_on_last_lookup_try(photos, monkeypatch):
    monkeypatch.setattr(supabase_api, "find_photo", _failing_lookup)
    model = FakeModel()

    assert worker.process_photo(model, PHOTO_ID, worker.MAX_TRIES) == "failed"
    assert model.inputs == []
    assert photos["statuses"] == ["failed"]


def test_process_photo_logs_when_last_try_cannot_mark_failed(
    photos, monkeypatch, caplog
):
    monkeypatch.setattr(supabase_api, "find_photo", _failing_lookup)
    monkeypatch.setattr(supabase_api, "mark_photo_failed", lambda photo_id: False)

    assert worker.process_photo(FakeModel(), PHOTO_ID, worker.MAX_TRIES) == "failed"
    assert any(
        record.levelname == "ERROR" and "stays stuck" in record.getMessage()
        for record in caplog.records
    )


def test_process_photo_keeps_output_when_completion_and_lookup_fail(
    photos, monkeypatch
):
    def completion_fails_then_lookup_fails(photo_id, processed_path):
        monkeypatch.setattr(supabase_api, "find_photo", _failing_lookup)
        return False

    monkeypatch.setattr(
        supabase_api, "mark_photo_completed", completion_fails_then_lookup_fails
    )

    with pytest.raises(Retry):
        worker.process_photo(FakeModel(), PHOTO_ID)
    assert photos["statuses"] == ["processing"]
    assert (supabase_api.PROCESSED_IMAGES_BUCKET, PROCESSED_PATH) in photos["objects"]


def test_process_photo_retries_when_completion_fails_then_completes(
    photos, monkeypatch
):
    real_mark_completed = supabase_api.mark_photo_completed
    monkeypatch.setattr(
        supabase_api, "mark_photo_completed", lambda photo_id, processed_path: False
    )
    model = FakeModel()

    with pytest.raises(Retry):
        worker.process_photo(model, PHOTO_ID, 1)
    assert photos["rows"][PHOTO_ID]["status"] == "processing"

    monkeypatch.setattr(supabase_api, "mark_photo_completed", real_mark_completed)
    assert worker.process_photo(model, PHOTO_ID, 2) == "completed"
    assert photos["statuses"] == ["processing", "processing", "completed"]
    assert len(model.inputs) == 2


def _delete_photo_via_api(photos, monkeypatch):
    monkeypatch.setattr(
        supabase_api,
        "get_photo",
        lambda photo_id, user_id: photos["rows"].get(photo_id),
    )
    monkeypatch.setattr(
        supabase_api,
        "delete_photo_row",
        lambda photo_id: photos["rows"].pop(photo_id, None) is not None,
    )
    return supabase_api.delete_photo(PHOTO_ID, "user-123")


def test_process_photo_marks_failed_when_completion_fails_on_last_try(
    photos, monkeypatch
):
    monkeypatch.setattr(
        supabase_api, "mark_photo_completed", lambda photo_id, processed_path: False
    )

    assert worker.process_photo(FakeModel(), PHOTO_ID, worker.MAX_TRIES) == "failed"
    assert photos["statuses"] == ["processing", "failed"]
    assert photos["rows"][PHOTO_ID]["processed_path"] is None

    assert _delete_photo_via_api(photos, monkeypatch) is True
    assert photos["objects"] == {}


def test_deleting_photo_during_completion_retry_leaves_no_enhanced_image(
    photos, monkeypatch
):
    monkeypatch.setattr(
        supabase_api, "mark_photo_completed", lambda photo_id, processed_path: False
    )
    with pytest.raises(Retry):
        worker.process_photo(FakeModel(), PHOTO_ID, 1)
    assert (supabase_api.PROCESSED_IMAGES_BUCKET, PROCESSED_PATH) in photos["objects"]

    assert _delete_photo_via_api(photos, monkeypatch) is True
    assert photos["objects"] == {}
    assert worker.process_photo(FakeModel(), PHOTO_ID, 2) == "skipped"


def test_process_photo_retries_when_failed_status_cannot_be_written(
    photos, monkeypatch
):
    photos["objects"].clear()
    monkeypatch.setattr(supabase_api, "mark_photo_failed", lambda photo_id: False)

    with pytest.raises(Retry) as retry:
        worker.process_photo(FakeModel(), PHOTO_ID, 3)
    assert retry.value.defer_score == worker.retry_delay(3) * 1000
    assert photos["rows"][PHOTO_ID]["status"] == "processing"


def test_process_photo_logs_when_failed_status_cannot_be_written_on_last_try(
    photos, monkeypatch, caplog
):
    photos["objects"].clear()
    monkeypatch.setattr(supabase_api, "mark_photo_failed", lambda photo_id: False)

    assert worker.process_photo(FakeModel(), PHOTO_ID, worker.MAX_TRIES) == "failed"
    assert any(
        record.levelname == "ERROR" and "stays stuck" in record.getMessage()
        for record in caplog.records
    )


def test_enhance_photo_job_uses_model_loaded_at_startup(photos, monkeypatch):
    model = FakeModel()
    monkeypatch.setattr(worker, "load_model", lambda: model)
    ctx: dict = {"job_try": 1}

    asyncio.run(worker.startup(ctx))
    assert asyncio.run(worker.enhance_photo(ctx, PHOTO_ID)) == "completed"
    assert len(model.inputs) == 1


def test_enhance_photo_job_gives_up_on_last_try(photos, monkeypatch):
    monkeypatch.setattr(supabase_api, "find_photo", _failing_lookup)
    ctx = {"model": FakeModel(), "job_try": worker.MAX_TRIES}

    assert asyncio.run(worker.enhance_photo(ctx, PHOTO_ID)) == "failed"
    assert photos["statuses"] == ["failed"]


def test_worker_settings_register_the_job():
    assert worker.enhance_photo in worker.WorkerSettings.functions
    assert worker.WorkerSettings.on_startup is worker.startup
    assert worker.WorkerSettings.max_tries == worker.MAX_TRIES


# -- enhancement.enhance_image ---------------------------------------------------------


def test_enhance_image_returns_png_bytes():
    out = enhancement.enhance_image(FakeModel(), _image_bytes())
    assert Image.open(io.BytesIO(out)).format == "PNG"


def test_enhance_image_feeds_model_rgb_for_rgba_png():
    model = FakeModel()
    enhancement.enhance_image(model, _image_bytes(mode="RGBA", image_format="PNG"))
    assert model.inputs[0].mode == "RGB"


def test_enhance_image_applies_exif_orientation():
    buffer = io.BytesIO()
    exif = Image.Exif()
    exif[0x0112] = 6  # Orientation: rotate 90° clockwise to display
    Image.new("RGB", (8, 4)).save(buffer, "JPEG", exif=exif)
    model = FakeModel()

    enhancement.enhance_image(model, buffer.getvalue())

    assert model.inputs[0].size == (4, 8)


def test_model_name_matches_u_shape_wrapper():
    from divevision.src.models.u_shape_model import UShapeModelWrapper

    assert enhancement.MODEL_NAME == UShapeModelWrapper.name


def test_api_does_not_import_the_model():
    import subprocess
    import sys

    # The API must stay free of PyTorch/model weights; only the worker loads them.
    code = (
        "import sys; import divevision.src.app.main; "
        "assert 'divevision.src.models' not in sys.modules; "
        "assert 'torch' not in sys.modules"
    )
    subprocess.run([sys.executable, "-c", code], check=True)
