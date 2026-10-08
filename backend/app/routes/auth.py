from flask import Blueprint, jsonify, request
from flask_jwt_extended import (
    decode_token,
    get_jwt,
    get_jwt_identity,
    jwt_required,
    unset_jwt_cookies,
)
from sqlalchemy.exc import IntegrityError

from ..auth_utils import AuthError, issue_tokens, rotate_refresh_token, set_auth_cookies
from ..extensions import db
from ..models import RefreshToken, User, utcnow

bp = Blueprint("auth", __name__, url_prefix="/auth")


def _user_json(user):
    return {"id": user.id, "username": user.username}


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
    except IntegrityError:
        db.session.rollback()
        return jsonify(error="Username already taken"), 409

    return jsonify(_user_json(user)), 201


@bp.post("/login")
def login():
    data = request.get_json(silent=True) or {}
    user = User.query.filter_by(username=(data.get("username") or "").strip()).first()

    if not user or not user.check_password(data.get("password") or ""):
        return jsonify(error="Invalid username or password"), 401

    access, refresh = issue_tokens(user)
    db.session.commit()

    resp = jsonify(user=_user_json(user))
    set_auth_cookies(resp, access, refresh)  # tokens only travel in cookies
    return resp


@bp.post("/refresh")
@jwt_required(refresh=True)
def refresh():
    """Manual refresh, kept for reference/testing.
    In normal use the middleware does this automatically on any expired request."""
    try:
        user, access, new_refresh = rotate_refresh_token(get_jwt())
    except AuthError as e:
        resp = jsonify(error=str(e))
        unset_jwt_cookies(resp)
        return resp, 401

    resp = jsonify(user=_user_json(user))
    set_auth_cookies(resp, access, new_refresh)
    return resp


@bp.post("/logout")
@jwt_required(refresh=True, optional=True)
def logout():
    payload = get_jwt()  # {} if the refresh cookie is already gone
    if payload:
        token = RefreshToken.query.filter_by(jti=payload["jti"]).first()
        if token and not token.revoked:
            token.revoked = True
            token.revoked_at = utcnow()
            db.session.commit()

    resp = jsonify(message="Logged out")
    unset_jwt_cookies(resp)
    return resp


@bp.get("/me")
@jwt_required()
def me():
    user = db.session.get(User, int(get_jwt_identity()))
    if user is None:
        return jsonify(error="User not found"), 404
    return jsonify(_user_json(user))