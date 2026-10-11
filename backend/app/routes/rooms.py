import os
import re
from uuid import uuid4
from flask import Blueprint, jsonify, request,Response
from werkzeug.utils import secure_filename
from flask_jwt_extended import get_jwt_identity, jwt_required
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError

from ..extensions import db, socketio
from ..models import Membership, Room, User
from uuid import UUID

from flask import current_app, jsonify, request

bp = Blueprint("rooms", __name__, url_prefix="/rooms")
# Allowlist by extension. We choose the Content-Type ourselves, never trust the client's.
# SVG and HTML are deliberately absent: they can run scripts.
ALLOWED_FILES = {
    ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
    ".gif": "image/gif", ".webp": "image/webp", ".pdf": "application/pdf",
    ".txt": "text/plain", ".csv": "text/csv", ".zip": "application/zip",
}
STORED_NAME = re.compile(r"[0-9a-f]{32}\.[a-z0-9]{2,5}")

def _room_json(room, member_count, is_member):
    return {
        "id": room.id,
        "name": room.name,
        "member_count": member_count,
        "is_member": is_member,
    }

def _announce_join(room_id, user):
    """Store a 'joined' system message and push it to everyone in the room."""
    try:
        message = current_app.extensions["message_store"].add(
            room_id, user.id, user.username, f"{user.username} joined the room", kind="system"
        )
    except Exception:  # joining must not fail because message storage is down
        current_app.logger.exception("Could not store the join message")
        return
    socketio.emit("receive_message", message, to=str(room_id))


def _broadcast_room(room):
    """Tell every connected client about a new room or a changed member count."""
    count = Membership.query.filter_by(room_id=room.id).count()
    socketio.emit("room_changed", {"id": room.id, "name": room.name, "member_count": count})

@bp.get("")
@jwt_required()
def list_rooms():
    uid = int(get_jwt_identity())

    counts = (
        db.session.query(Membership.room_id, func.count(Membership.id).label("n"))
        .group_by(Membership.room_id)
        .subquery()
    )
    rows = (
        db.session.query(Room, func.coalesce(counts.c.n, 0))
        .outerjoin(counts, counts.c.room_id == Room.id)
        .order_by(Room.name)
        .all()
    )
    joined = {
        m.room_id for m in Membership.query.filter_by(user_id=uid).all()
    }
    return jsonify([_room_json(r, n, r.id in joined) for r, n in rows])


@bp.post("/create")
@jwt_required()
def create_room():
    uid = int(get_jwt_identity())
    name = ((request.get_json(silent=True) or {}).get("name") or "").strip()

    if not name or len(name) > 80:
        return jsonify(error="Room name must be 1-80 characters"), 400

    room = Room(name=name, created_by=uid)
    db.session.add(room)
    try:
        db.session.flush()  # get room.id
        db.session.add(Membership(user_id=uid, room_id=room.id))  # creator joins
        db.session.commit()
    except IntegrityError:
        db.session.rollback()
        return jsonify(error="A room with that name already exists"), 409

    _broadcast_room(room)
    return jsonify(_room_json(room, 1, True)), 201


@bp.post("/<int:room_id>/join")
@jwt_required()
def join_room_rest(room_id):
    uid = int(get_jwt_identity())

    room = db.session.get(Room, room_id)
    if room is None:
        return jsonify(error="Room not found"), 404

    added = False
    if not Membership.query.filter_by(user_id=uid, room_id=room_id).first():
        db.session.add(Membership(user_id=uid, room_id=room_id))
        try:
            db.session.commit()
            added = True
        except IntegrityError:  # double-click / parallel request: someone else added it
            db.session.rollback()

    if added:  # first time only, so re-opening a room never repeats the message
        _announce_join(room_id, db.session.get(User, uid))
        _broadcast_room(room)

    count = Membership.query.filter_by(room_id=room_id).count()
    return jsonify(_room_json(room, count, True))

@bp.get("/<int:room_id>/messages")
@jwt_required()
def room_messages(room_id):
    uid = int(get_jwt_identity())
    if not Membership.query.filter_by(user_id=uid, room_id=room_id).first():
        return jsonify(error="Join the room first"), 403

    try:
        limit = max(1, min(int(request.args.get("limit", 30)), 100))
    except ValueError:
        return jsonify(error="limit must be a number"), 400

    before = None
    if request.args.get("before"):
        try:
            before = UUID(request.args["before"])
        except ValueError:
            return jsonify(error="before must be a message_id"), 400

    store = current_app.extensions["message_store"]
    try:
        return jsonify(store.history(room_id, limit, before))
    except Exception:
        current_app.logger.exception("Message store unavailable")
        return jsonify(error="Message history is temporarily unavailable"), 503


@bp.post("/<int:room_id>/files")
@jwt_required()
def upload_file(room_id):
    uid = int(get_jwt_identity())
    if not Membership.query.filter_by(user_id=uid, room_id=room_id).first():
        return jsonify(error="Join the room first"), 403

    upload = request.files.get("file")
    if upload is None or not upload.filename:
        return jsonify(error="No file provided"), 400

    display_name = os.path.basename(upload.filename.replace("\\", "/"))[:120]
    ext = os.path.splitext(display_name)[1].lower()
    content_type = ALLOWED_FILES.get(ext)
    if content_type is None:
        return jsonify(error="This file type is not allowed"), 415

    upload.stream.seek(0, os.SEEK_END)
    size = upload.stream.tell()
    upload.stream.seek(0)
    if size == 0:
        return jsonify(error="The file is empty"), 400
    if size > current_app.config["MAX_UPLOAD_BYTES"]:
        return jsonify(error="File is too large (max 10 MB)"), 413

    key = f"{uuid4().hex}{ext}"
    object_key = f"rooms/{room_id}/{key}"
    files = current_app.extensions["file_store"]
    try:
        files.put(object_key, upload.stream, size, content_type)
    except Exception:
        current_app.logger.exception("File storage unavailable")
        return jsonify(error="File storage is temporarily unavailable"), 503

    user = db.session.get(User, uid)
    try:
        message = current_app.extensions["message_store"].add(
            room_id, uid, user.username, display_name, kind="file",
            file={"key": key, "type": content_type, "size": size},
        )
    except Exception:
        current_app.logger.exception("Could not save the file message")
        try:
            files.delete(object_key)  # don't leave an orphan
        except Exception:
            pass
        return jsonify(error="Could not send the file, please try again"), 503

    socketio.emit("receive_message", message, to=str(room_id))
    return jsonify(message), 201


@bp.get("/<int:room_id>/files/<name>")
@jwt_required()
def download_file(room_id, name):
    uid = int(get_jwt_identity())
    if not STORED_NAME.fullmatch(name):
        return jsonify(error="Not found"), 404
    if not Membership.query.filter_by(user_id=uid, room_id=room_id).first():
        return jsonify(error="Join the room first"), 403

    content_type = ALLOWED_FILES.get(os.path.splitext(name)[1])
    if content_type is None:
        return jsonify(error="Not found"), 404

    try:
        chunks, length = current_app.extensions["file_store"].get(f"rooms/{room_id}/{name}")
    except FileNotFoundError:
        return jsonify(error="Not found"), 404
    except Exception:
        current_app.logger.exception("File storage unavailable")
        return jsonify(error="File storage is temporarily unavailable"), 503

    headers = {"X-Content-Type-Options": "nosniff", "Cache-Control": "private, max-age=3600"}
    if length:
        headers["Content-Length"] = str(length)
    if not content_type.startswith("image/"):  # images show inline, everything else downloads
        download_name = secure_filename(request.args.get("filename", "")) or name
        headers["Content-Disposition"] = f'attachment; filename="{download_name}"'
    return Response(chunks, mimetype=content_type, headers=headers)