import pytest

from app import sockets
from app.extensions import socketio

from .helpers import call, chat_messages, connect, create_room, received


def joined_room(app, client, room_id):
    sc = connect(app, client)
    assert call(sc, "join_room", {"room_id": room_id}) == {"ok": True}
    return sc


@pytest.fixture
def room_id(alice, bob):
    """A room both alice and bob are members of."""
    rid = create_room(alice).get_json()["id"]
    bob.post(f"/rooms/{rid}/join")
    return rid


# ---------- connect / disconnect ----------

def test_connect_without_cookie_is_refused(app):
    assert not socketio.test_client(app).is_connected()


def test_connect_with_garbage_cookie_is_refused(app, client):
    client.set_cookie("access_token", "garbage")
    assert not connect(app, client).is_connected()


def test_connect_with_refresh_token_in_access_slot_is_refused(app, alice):
    alice.set_cookie("access_token", alice.get_cookie("refresh_token").value)
    assert not connect(app, alice).is_connected()


def test_connect_with_valid_cookie(app, alice):
    sc = connect(app, alice)
    assert sc.is_connected()
    assert len(sockets.sessions) == 1


def test_disconnect_forgets_the_session(app, alice):
    sc = connect(app, alice)
    sc.disconnect()
    assert not sc.is_connected()
    assert sockets.sessions == {}


# ---------- join / leave / presence ----------

def test_join_room_sends_presence(app, alice, room_id):
    sc = joined_room(app, alice, room_id)
    presence = received(sc, "presence")
    assert [u["username"] for u in presence[-1]["users"]] == ["alice"]


def test_non_member_cannot_join(app, alice, make_client):
    rid = create_room(alice).get_json()["id"]
    from .helpers import register_and_login
    stranger = register_and_login(make_client(), "stranger")
    sc = connect(app, stranger)
    ack = call(sc, "join_room", {"room_id": rid})
    assert ack["ok"] is False


@pytest.mark.parametrize("payload", ["nope", None, 123, {"room_id": "1"}, {"room_id": True}, {}])
def test_join_room_rejects_bad_payloads(app, alice, payload):
    sc = connect(app, alice)
    assert call(sc, "join_room", payload)["ok"] is False


def test_same_user_in_two_tabs_counts_once(app, alice, room_id):
    joined_room(app, alice, room_id)
    second = joined_room(app, alice, room_id)
    presence = received(second, "presence")
    assert len(presence[-1]["users"]) == 1


def test_disconnect_updates_presence_for_others(app, alice, bob, room_id):
    a = joined_room(app, alice, room_id)
    b = joined_room(app, bob, room_id)
    a.get_received()

    b.disconnect()

    presence = received(a, "presence")
    assert [u["username"] for u in presence[-1]["users"]] == ["alice"]


def test_leave_room(app, alice, bob, room_id):
    a = joined_room(app, alice, room_id)
    b = joined_room(app, bob, room_id)
    a.get_received()

    assert call(b, "leave_room", {"room_id": room_id}) == {"ok": True}
    assert [u["username"] for u in received(a, "presence")[-1]["users"]] == ["alice"]
    assert call(b, "send_message", {"room_id": room_id, "content": "hi"})["ok"] is False


# ---------- messaging ----------

def test_message_reaches_everyone_in_the_room(app, alice, bob, room_id):
    a = joined_room(app, alice, room_id)
    b = joined_room(app, bob, room_id)
    a.get_received()
    b.get_received()

    ack = call(a, "send_message", {"room_id": room_id, "content": "hello bob"})

    assert ack["ok"] is True
    for sc in (a, b):  # the sender gets it too
        msgs = received(sc, "receive_message")
        assert msgs[0]["content"] == "hello bob"
        assert msgs[0]["username"] == "alice"


def test_message_is_stored_and_served_by_history(app, alice, room_id):
    a = joined_room(app, alice, room_id)
    call(a, "send_message", {"room_id": room_id, "content": "remember me"})

    stored = chat_messages(app, room_id)
    assert [m["content"] for m in stored] == ["remember me"]
    api = alice.get(f"/rooms/{room_id}/messages").get_json()
    assert [m["content"] for m in api if m["kind"] == "message"] == ["remember me"]


def test_message_content_is_trimmed(app, alice, room_id):
    a = joined_room(app, alice, room_id)
    call(a, "send_message", {"room_id": room_id, "content": "  padded  "})
    assert chat_messages(app, room_id)[0]["content"] == "padded"


@pytest.mark.parametrize("content", ["", "   ", "x" * 2001, None, 5])
def test_invalid_message_is_rejected(app, alice, room_id, content):
    a = joined_room(app, alice, room_id)
    ack = call(a, "send_message", {"room_id": room_id, "content": content})
    assert ack["ok"] is False
    assert chat_messages(app, room_id) == []


def test_cannot_send_before_joining(app, alice, room_id):
    sc = connect(app, alice)
    ack = call(sc, "send_message", {"room_id": room_id, "content": "hi"})
    assert ack["ok"] is False


def test_cannot_send_to_a_room_you_have_not_joined(app, alice, bob, room_id):
    other = create_room(alice, "other").get_json()["id"]
    b = joined_room(app, bob, room_id)  # bob is only in the first room
    assert call(b, "send_message", {"room_id": other, "content": "hi"})["ok"] is False


def test_storage_failure_returns_an_error_ack(app, alice, room_id, monkeypatch):
    def boom(*args, **kwargs):
        raise RuntimeError("cassandra is down")

    monkeypatch.setattr(app.extensions["message_store"], "add", boom)
    a = joined_room(app, alice, room_id)
    ack = call(a, "send_message", {"room_id": room_id, "content": "hi"})
    assert ack["ok"] is False
    assert "cassandra" not in ack["error"].lower()  # internals aren't leaked


# ---------- typing ----------

def test_typing_goes_to_others_but_not_the_sender(app, alice, bob, room_id):
    a = joined_room(app, alice, room_id)
    b = joined_room(app, bob, room_id)
    a.get_received()
    b.get_received()

    a.emit("typing", {"room_id": room_id, "is_typing": True})

    events = received(b, "typing")
    assert events == [{"room_id": room_id, "username": "alice", "is_typing": True}]
    assert received(a, "typing") == []