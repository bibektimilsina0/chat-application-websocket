import threading

from flask import current_app, request
from flask_jwt_extended import decode_token
from flask_socketio import ConnectionRefusedError, emit
from flask_socketio import join_room as sio_join
from flask_socketio import leave_room as sio_leave

from .extensions import db, socketio
from .models import Membership, User

MAX_MESSAGE_LEN = 2000

_lock = threading.Lock()
# sid -> {"user_id": int, "username": str, "rooms": set[int]}
# In memory = single server process. Use Redis to scale out (see README).
sessions = {}


def _room_id(data):
    rid = data.get("room_id") if isinstance(data, dict) else None
    return rid if isinstance(rid, int) and not isinstance(rid, bool) else None


def _online_users(room_id):
    with _lock:
        users = {
            s["user_id"]: s["username"]
            for s in sessions.values()
            if room_id in s["rooms"]
        }
    return [{"id": uid, "username": name} for uid, name in users.items()]


def _broadcast_presence(room_id):
    socketio.emit(
        "presence",
        {"room_id": room_id, "users": _online_users(room_id)},
        to=str(room_id),
    )


@socketio.on("connect")
def on_connect(auth=None):
    # The browser sends the httpOnly access cookie in the handshake
    token = request.cookies.get(current_app.config["JWT_ACCESS_COOKIE_NAME"])
    if not token:
        raise ConnectionRefusedError("unauthorized")
    try:
        payload = decode_token(token)
        if payload.get("type") != "access":
            raise ValueError("not an access token")
        user = db.session.get(User, int(payload["sub"]))
    except Exception:
        raise ConnectionRefusedError("unauthorized")
    if user is None:
        raise ConnectionRefusedError("unauthorized")

    with _lock:
        sessions[request.sid] = {
            "user_id": user.id,
            "username": user.username,
            "rooms": set(),
        }


@socketio.on("disconnect")
def on_disconnect(*args):
    with _lock:
        info = sessions.pop(request.sid, None)
    if not info:
        return
    for room_id in info["rooms"]:
        _broadcast_presence(room_id)


@socketio.on("join_room")
def on_join_room(data):
    info = sessions.get(request.sid)
    room_id = _room_id(data)
    if info is None or room_id is None:
        return {"ok": False, "error": "Invalid request"}

    if not Membership.query.filter_by(user_id=info["user_id"], room_id=room_id).first():
        return {"ok": False, "error": "You are not a member of this room"}

    sio_join(str(room_id))
    with _lock:
        info["rooms"].add(room_id)
    _broadcast_presence(room_id)
    return {"ok": True}


@socketio.on("leave_room")
def on_leave_room(data):
    info = sessions.get(request.sid)
    room_id = _room_id(data)
    if info is None or room_id is None or room_id not in info["rooms"]:
        return {"ok": False, "error": "Not in this room"}

    sio_leave(str(room_id))
    with _lock:
        info["rooms"].discard(room_id)
    _broadcast_presence(room_id)
    return {"ok": True}


@socketio.on("send_message")
def on_send_message(data):
    info = sessions.get(request.sid)
    room_id = _room_id(data)
    if info is None or room_id is None or room_id not in info["rooms"]:
        return {"ok": False, "error": "Join the room before sending messages"}

    content = (data.get("content") or "").strip() if isinstance(data.get("content"), str) else ""
    if not content or len(content) > MAX_MESSAGE_LEN:
        return {"ok": False, "error": f"Message must be 1-{MAX_MESSAGE_LEN} characters"}

    try:
        message = current_app.extensions["message_store"].add(
            room_id, info["user_id"], info["username"], content
        )
    except Exception:
        current_app.logger.exception("Failed to save message")
        return {"ok": False, "error": "Could not send the message, please try again"}

    emit("receive_message", message, to=str(room_id))  # includes the sender
    return {"ok": True, "message_id": message["message_id"]}


@socketio.on("typing")
def on_typing(data):
    info = sessions.get(request.sid)
    room_id = _room_id(data)
    if info is None or room_id is None or room_id not in info["rooms"]:
        return
    emit(
        "typing",
        {
            "room_id": room_id,
            "username": info["username"],
            "is_typing": bool(data.get("is_typing")),
        },
        to=str(room_id),
        include_self=False,
    )