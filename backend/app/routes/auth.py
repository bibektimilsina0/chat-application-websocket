from datetime import datetime, timezone

from flask import Blueprint, jsonify, request
from flask_jwt_extended import (
    create_access_token,
    create_refresh_token,
    decode_token,
    get_jwt,
    get_jwt_identity,
    jwt_required,
)
from sqlalchemy.exc import IntegrityError

from ..extensions import db
from ..models import RefreshToken, User

bp = Blueprint("auth", __name__, url_prefix="/auth")


def _issue_tokens(user):
    """Create an access + refresh pair and record the refresh token in the DB.
    The caller is responsible for committing the session."""
    access = create_access_token(identity=str(user.id))
    refresh = create_refresh_token(identity=str(user.id))
    decoded = decode_token(refresh)
    db.session.add(
        RefreshToken(
            jti=decoded["jti"],
            user_id=user.id,
            expires_at=datetime.fromtimestamp(decoded["exp"], tz=timezone.utc),
        )
    )
    return access, refresh


@bp.post("/register")
def register():
    data = request.get_json(silent=True) or {}
    username = (data.get("username") or "").strip()
    password = data.get("password") or ""

    if len(username) < 3 or len(username) > 50:
        return jsonify(error="Username must be 3-50 characters"), 400
    if len(password) < 8:
        return jsonify(error="Password must be at least 8 characters"), 400
    if User.query.filter_by(username=username).first():
        return jsonify(error="Username already taken"), 409

    user = User(username=username)
    user.set_password(password)
    db.session.add(user)
    try:
        db.session.commit()
    except IntegrityError:  # two requests raced past the check above
        db.session.rollback()
        return jsonify(error="Username already taken"), 409

    return jsonify(id=user.id, username=user.username), 201


@bp.post("/login")
def login():
    data = request.get_json(silent=True) or {}
    user = User.query.filter_by(username=(data.get("username") or "").strip()).first()

    # Same message for unknown user and wrong password, so usernames can't be probed
    if not user or not user.check_password(data.get("password") or ""):
        return jsonify(error="Invalid username or password"), 401

    access, refresh = _issue_tokens(user)
    db.session.commit()
    return jsonify(
        access_token=access,
        refresh_token=refresh,
        user={"id": user.id, "username": user.username},
    )


@bp.post("/refresh")
@jwt_required(refresh=True)
def refresh():
    payload = get_jwt()
    user_id = int(get_jwt_identity())

    token = RefreshToken.query.filter_by(jti=payload["jti"]).first()
    if token is None:
        return jsonify(error="Unknown refresh token"), 401

    if token.revoked:
        # A rotated/logged-out token is being reused: treat it as possible theft
        # and revoke every active refresh token for this user.
        RefreshToken.query.filter_by(user_id=user_id, revoked=False).update(
            {"revoked": True}
        )
        db.session.commit()
        return jsonify(error="Refresh token reuse detected, please log in again"), 401

    user = db.session.get(User, user_id)
    if user is None:
        return jsonify(error="User no longer exists"), 401

    token.revoked = True  # rotation: each refresh token works once
    access, new_refresh = _issue_tokens(user)
    db.session.commit()
    return jsonify(access_token=access, refresh_token=new_refresh)


@bp.post("/logout")
@jwt_required(refresh=True)
def logout():
    token = RefreshToken.query.filter_by(jti=get_jwt()["jti"]).first()
    if token and not token.revoked:
        token.revoked = True
        db.session.commit()
    return jsonify(message="Logged out"), 200


@bp.get("/me")
@jwt_required()
def me():
    user = db.session.get(User, int(get_jwt_identity()))
    if user is None:
        return jsonify(error="User not found"), 404
    return jsonify(id=user.id, username=user.username)