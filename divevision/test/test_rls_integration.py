"""Owner-only access rules, proven against a real (local) Supabase stack.

User B must not be able to read, modify, or receive Realtime events for
user A's `photos` rows or storage objects, and no client - not even the
owner - may write them directly (only the backend's service-role key can).

These tests create and delete real auth users, so they only run against a
stack named explicitly through SUPABASE_TEST_* variables (never the app's
own SUPABASE_URL). With the local stack from `supabase start`:

    eval "$(supabase status -o env | sed -n \
        -e 's/^API_URL=/export SUPABASE_TEST_URL=/p' \
        -e 's/^ANON_KEY=/export SUPABASE_TEST_ANON_KEY=/p' \
        -e 's/^SERVICE_ROLE_KEY=/export SUPABASE_TEST_SERVICE_ROLE_KEY=/p')"
    poetry run pytest -m integration
"""

import asyncio
import io
import os
import uuid

import pytest
import storage3
import supabase
from PIL import Image

URL = os.environ.get("SUPABASE_TEST_URL", "")
ANON_KEY = os.environ.get("SUPABASE_TEST_ANON_KEY", "")
SERVICE_ROLE_KEY = os.environ.get("SUPABASE_TEST_SERVICE_ROLE_KEY", "")

pytestmark = [
    pytest.mark.integration,
    pytest.mark.skipif(
        not (URL and ANON_KEY and SERVICE_ROLE_KEY),
        reason="needs a local Supabase stack (set SUPABASE_TEST_URL, "
        "SUPABASE_TEST_ANON_KEY, SUPABASE_TEST_SERVICE_ROLE_KEY)",
    ),
]

BUCKETS = ("images", "processedimages")
PASSWORD = "integration-test-password"


def _png(color=(0, 0, 0)) -> bytes:
    buffer = io.BytesIO()
    Image.new("RGB", (4, 4), color).save(buffer, "PNG")
    return buffer.getvalue()


def _admin() -> supabase.Client:
    return supabase.create_client(URL, SERVICE_ROLE_KEY)


def _new_user(admin: supabase.Client) -> tuple[str, str]:
    email = f"rls-{uuid.uuid4().hex[:12]}@example.com"
    response = admin.auth.admin.create_user(
        {"email": email, "password": PASSWORD, "email_confirm": True}
    )
    return response.user.id, email


def _signed_in(email: str) -> supabase.Client:
    client = supabase.create_client(URL, ANON_KEY)
    client.auth.sign_in_with_password({"email": email, "password": PASSWORD})
    return client


@pytest.fixture
def world():
    """User A owns one photo (row + an object in each bucket); B owns nothing."""
    admin = _admin()
    a_id, a_email = _new_user(admin)
    b_id, b_email = _new_user(admin)

    photo_id = str(uuid.uuid4())
    path = f"{a_id}/{photo_id}.png"
    for bucket in BUCKETS:
        admin.storage.from_(bucket).upload(
            path=path, file=_png(), file_options={"content-type": "image/png"}
        )
    admin.table("photos").insert(
        {
            "id": photo_id,
            "user_id": a_id,
            "original_path": path,
            "processed_path": path,
            "status": "completed",
            "model_name": "U-Shape",
        }
    ).execute()

    yield {
        "admin": admin,
        "a_id": a_id,
        "a": _signed_in(a_email),
        "b_id": b_id,
        "b": _signed_in(b_email),
        "b_email": b_email,
        "a_email": a_email,
        "photo_id": photo_id,
        "path": path,
    }

    for bucket in BUCKETS:
        admin.storage.from_(bucket).remove([path, f"{b_id}/intruder.png"])
    for user_id in (a_id, b_id):
        admin.auth.admin.delete_user(user_id)  # cascades to photos rows


def _admin_row(world) -> dict | None:
    rows = (
        world["admin"].table("photos").select("*").eq("id", world["photo_id"]).execute()
    )
    return rows.data[0] if rows.data else None


def _write_denied(action) -> None:
    """A client write must fail outright, or at least touch nothing."""
    try:
        response = action()
    except (supabase.PostgrestAPIError, storage3.exceptions.StorageApiError):
        return
    assert not getattr(response, "data", response), response


# -- photos rows ---------------------------------------------------------------------


def test_owner_can_read_own_photo(world):
    rows = world["a"].table("photos").select("*").execute().data
    assert [row["id"] for row in rows] == [world["photo_id"]]


def test_other_user_cannot_read_photo(world):
    b = world["b"]
    assert b.table("photos").select("*").execute().data == []
    assert (
        b.table("photos").select("*").eq("id", world["photo_id"]).execute().data == []
    )


def test_anonymous_cannot_read_photo(world):
    anon = supabase.create_client(URL, ANON_KEY)
    assert anon.table("photos").select("*").execute().data == []


def test_other_user_cannot_modify_photo(world):
    b, photo_id = world["b"], world["photo_id"]
    before = _admin_row(world)

    _write_denied(
        lambda: b.table("photos")
        .update({"status": "failed", "user_id": world["b_id"]})
        .eq("id", photo_id)
        .execute()
    )
    _write_denied(lambda: b.table("photos").delete().eq("id", photo_id).execute())

    assert _admin_row(world) == before


def test_no_client_can_write_photos(world):
    a, b = world["a"], world["b"]
    before = _admin_row(world)

    # Not even the owner: status/paths are only ever set by the backend.
    _write_denied(
        lambda: a.table("photos")
        .update({"status": "pending"})
        .eq("id", world["photo_id"])
        .execute()
    )
    _write_denied(
        lambda: a.table("photos").delete().eq("id", world["photo_id"]).execute()
    )
    for client, owner in ((a, world["a_id"]), (b, world["a_id"]), (b, world["b_id"])):
        _write_denied(
            lambda: client.table("photos")
            .insert(
                {
                    "user_id": owner,
                    "original_path": f"{owner}/x.png",
                    "model_name": "U-Shape",
                }
            )
            .execute()
        )

    assert _admin_row(world) == before
    rows = (
        world["admin"]
        .table("photos")
        .select("id")
        .in_("user_id", [world["a_id"], world["b_id"]])
        .execute()
        .data
    )
    assert [row["id"] for row in rows] == [world["photo_id"]]


# -- storage objects -------------------------------------------------------------------


@pytest.mark.parametrize("bucket", BUCKETS)
def test_owner_can_read_own_objects(world, bucket):
    assert world["a"].storage.from_(bucket).download(world["path"]) == _png()


@pytest.mark.parametrize("bucket", BUCKETS)
def test_other_user_cannot_read_objects(world, bucket):
    storage = world["b"].storage.from_(bucket)

    with pytest.raises(storage3.exceptions.StorageApiError):
        storage.download(world["path"])
    with pytest.raises(storage3.exceptions.StorageApiError):
        storage.create_signed_url(world["path"], 60)
    assert storage.list(world["a_id"]) == []


@pytest.mark.parametrize("bucket", BUCKETS)
def test_other_user_cannot_modify_objects(world, bucket):
    storage = world["b"].storage.from_(bucket)

    _write_denied(lambda: storage.remove([world["path"]]))
    _write_denied(
        lambda: storage.update(
            world["path"], _png((255, 0, 0)), {"content-type": "image/png"}
        )
    )
    _write_denied(
        lambda: storage.upload(
            f"{world['a_id']}/planted.png", _png(), {"content-type": "image/png"}
        )
    )

    admin_storage = world["admin"].storage.from_(bucket)
    assert admin_storage.download(world["path"]) == _png()
    assert [o["name"] for o in admin_storage.list(world["a_id"])] == [
        world["path"].split("/")[1]
    ]


@pytest.mark.parametrize("bucket", BUCKETS)
def test_no_client_can_write_objects(world, bucket):
    _write_denied(
        lambda: world["a"]
        .storage.from_(bucket)
        .update(world["path"], _png((255, 0, 0)), {"content-type": "image/png"})
    )
    _write_denied(lambda: world["a"].storage.from_(bucket).remove([world["path"]]))
    _write_denied(
        lambda: world["b"]
        .storage.from_(bucket)
        .upload(f"{world['b_id']}/intruder.png", _png(), {"content-type": "image/png"})
    )
    assert world["admin"].storage.from_(bucket).download(world["path"]) == _png()


# -- Realtime --------------------------------------------------------------------------


async def _subscribe(email: str, events: list) -> supabase.AsyncClient:
    client = await supabase.acreate_client(URL, ANON_KEY)
    response = await client.auth.sign_in_with_password(
        {"email": email, "password": PASSWORD}
    )
    await client.realtime.set_auth(response.session.access_token)

    subscribed = asyncio.Event()
    channel = client.channel(f"photos-{uuid.uuid4().hex[:8]}")
    channel.on_postgres_changes(
        "*", schema="public", table="photos", callback=events.append
    )
    await channel.subscribe(
        lambda status, err: status.value == "SUBSCRIBED" and subscribed.set()
    )
    await asyncio.wait_for(subscribed.wait(), timeout=15)
    return client


def test_other_user_receives_no_realtime_events(world):
    async def scenario():
        a_events: list = []
        b_events: list = []
        a_client = await _subscribe(world["a_email"], a_events)
        b_client = await _subscribe(world["b_email"], b_events)
        try:
            # Realtime only starts delivering a short while after SUBSCRIBED,
            # so keep changing A's row until A (the positive control) hears it.
            statuses = ["processing", "completed"]
            for attempt in range(30):
                await asyncio.to_thread(
                    lambda: world["admin"]
                    .table("photos")
                    .update({"status": statuses[attempt % 2]})
                    .eq("id", world["photo_id"])
                    .execute()
                )
                await asyncio.sleep(1)
                if a_events:
                    break
            assert a_events, "owner never received a Realtime event for their row"

            # Give B's subscription the same window plus slack to (wrongly) fire.
            await asyncio.sleep(3)
            assert b_events == []
        finally:
            await a_client.realtime.close()
            await b_client.realtime.close()

    asyncio.run(scenario())
