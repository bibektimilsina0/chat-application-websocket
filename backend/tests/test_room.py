from .helpers import create_room


def test_rooms_require_login(client):
    assert client.get("/rooms").status_code == 401
    assert client.post("/rooms/create", json={"name": "x"}).status_code == 401


def test_create_room_makes_creator_a_member(alice):
    r = create_room(alice)
    assert r.status_code == 201
    body = r.get_json()
    assert body["name"] == "general"
    assert body["member_count"] == 1 and body["is_member"] is True


def test_create_room_duplicate_name(alice):
    create_room(alice)
    assert create_room(alice).status_code == 409


def test_create_room_validation(alice):
    assert create_room(alice, "").status_code == 400
    assert create_room(alice, "   ").status_code == 400
    assert create_room(alice, "x" * 81).status_code == 400


def test_list_rooms_shows_membership_per_user(alice, bob):
    create_room(alice, "general")
    create_room(alice, "random")

    as_alice = {r["name"]: r for r in alice.get("/rooms").get_json()}
    as_bob = {r["name"]: r for r in bob.get("/rooms").get_json()}

    assert as_alice["general"]["is_member"] is True
    assert as_bob["general"]["is_member"] is False
    assert as_bob["general"]["member_count"] == 1


def test_join_room(alice, bob):
    room_id = create_room(alice).get_json()["id"]
    r = bob.post(f"/rooms/{room_id}/join")
    assert r.status_code == 200
    assert r.get_json()["member_count"] == 2
    assert r.get_json()["is_member"] is True


def test_join_is_idempotent(alice, bob):
    room_id = create_room(alice).get_json()["id"]
    bob.post(f"/rooms/{room_id}/join")
    r = bob.post(f"/rooms/{room_id}/join")
    assert r.status_code == 200
    assert r.get_json()["member_count"] == 2


def test_join_nonexistent_room(alice):
    assert alice.post("/rooms/999/join").status_code == 404


# ---------- message history ----------

def test_history_requires_membership(alice, bob):
    room_id = create_room(alice).get_json()["id"]
    assert bob.get(f"/rooms/{room_id}/messages").status_code == 403


def test_history_is_oldest_first_and_paginates(app, alice):
    room_id = create_room(alice).get_json()["id"]
    store = app.extensions["message_store"]
    for i in range(5):
        store.add(room_id, 1, "alice", f"m{i}")

    latest = alice.get(f"/rooms/{room_id}/messages?limit=3").get_json()
    assert [m["content"] for m in latest] == ["m2", "m3", "m4"]

    older = alice.get(
        f"/rooms/{room_id}/messages?limit=3&before={latest[0]['message_id']}"
    ).get_json()
    assert [m["content"] for m in older] == ["m0", "m1"]


def test_history_rejects_bad_parameters(alice):
    room_id = create_room(alice).get_json()["id"]
    assert alice.get(f"/rooms/{room_id}/messages?limit=abc").status_code == 400
    assert alice.get(f"/rooms/{room_id}/messages?before=not-a-uuid").status_code == 400