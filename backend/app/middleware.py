from flask import current_app, g, jsonify, request
from flask_jwt_extended import (
    decode_token,
    get_jwt,
    unset_jwt_cookies,
    verify_jwt_in_request,
)
from jwt.exceptions import ExpiredSignatureError
from werkzeug.datastructures import ImmutableMultiDict

from .auth_utils import AuthError, rotate_refresh_token, set_auth_cookies

SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}
# These routes manage tokens themselves
SKIP_REFRESH_PATHS = {"/auth/login", "/auth/register", "/auth/refresh", "/auth/logout"}


def _override_request_cookie(name, value):
    """Make this request see the new token, so @jwt_required() passes right away."""
    jar = request.cookies.to_dict()
    jar[name] = value
    request.__dict__["cookies"] = ImmutableMultiDict(jar)


def _require_csrf_header():
    # A custom header can't be sent cross-site without a CORS preflight,
    # which only our Angular origin passes. Cheap, effective CSRF defence.
    if request.method not in SAFE_METHODS and request.headers.get("X-Requested-With") != "XMLHttpRequest":
        return jsonify(error="Missing X-Requested-With header"), 403


def _auto_refresh():
    if request.method == "OPTIONS" or request.path in SKIP_REFRESH_PATHS:
        return

    try:
        verify_jwt_in_request(optional=True)
        if get_jwt():  # valid access token present
            return
    except ExpiredSignatureError:
        pass
    except Exception:
        return  # malformed token: let the route answer 401

    # Access token missing or expired: try the refresh cookie
    raw = request.cookies.get(current_app.config["JWT_REFRESH_COOKIE_NAME"])
    if not raw:
        return
    try:
        payload = decode_token(raw)
        if payload.get("type") != "refresh":
            raise AuthError("Not a refresh token")
        user, access, refresh = rotate_refresh_token(payload)
    except Exception:  # expired, revoked, tampered, reuse...
        g.clear_auth_cookies = True
        return

    _override_request_cookie(current_app.config["JWT_ACCESS_COOKIE_NAME"], access)
    g.new_tokens = (access, refresh)


def _attach_cookies(response):
    new_tokens = g.get("new_tokens")
    if new_tokens:
        set_auth_cookies(response, *new_tokens)
    elif g.get("clear_auth_cookies"):
        unset_jwt_cookies(response)
    response.headers.setdefault("Cache-Control", "no-store")  # never cache API data
    return response

def register_auth_middleware(app):
    app.before_request(_require_csrf_header)  # runs first
    app.before_request(_auto_refresh)
    app.after_request(_attach_cookies)