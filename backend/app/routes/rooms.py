from flask import Blueprint, jsonify, request
from flask_jwt_extended import get_jwt_identity, jwt_required
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError

from ..extensions import db
from ..models import Membership, Room

bp = Blueprint("rooms", __name__, url_prefix="/rooms")


def _room_json(room, member_count, is_member):
    return {
        "id": room.id,
        "name": room.name,
        "member_count": member_count,
        "is_member": is_member,
    }


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

    return jsonify(_room_json(room, 1, True)), 201


@bp.post("/<int:room_id>/join")
@jwt_required()
def join_room_rest(room_id):
    uid = int(get_jwt_identity())

    room = db.session.get(Room, room_id)
    if room is None:
        return jsonify(error="Room not found"), 404

    if not Membership.query.filter_by(user_id=uid, room_id=room_id).first():
        db.session.add(Membership(user_id=uid, room_id=room_id))
        try:
            db.session.commit()
        except IntegrityError:  # double-click / parallel request
            db.session.rollback()

    count = Membership.query.filter_by(room_id=room_id).count()
    return jsonify(_room_json(room, count, True))