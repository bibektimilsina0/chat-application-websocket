from datetime import datetime, timedelta, timezone

from flask_jwt_extended import (
    create_access_token,
    create_refresh_token,
    decode_token,
    set_access_cookies,
    set_refresh_cookies,
)

from .extensions import db
from .models import RefreshToken, User, utcnow

# A refresh token rotated this recently may still get a new access token
# (parallel requests carrying the same cookie). Beyond it, reuse = theft.
REUSE_GRACE = timedelta(seconds=10)


class AuthError(Exception):
    pass


def issue_tokens(user):
    """Create an access + refresh pair and record the refresh token. Caller commits."""
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


def rotate_refresh_token(payload):
    """Validate a decoded refresh token and rotate it.
    Returns (user, access_token, new_refresh_token_or_None). Raises AuthError."""
    user_id = int(payload["sub"])
    token = RefreshToken.query.filter_by(jti=payload["jti"]).first()
    if token is None:
        raise AuthError("Unknown refresh token")

    user = db.session.get(User, user_id)
    if user is None:
        raise AuthError("User no longer exists")

    if token.revoked:
        if token.revoked_at and utcnow() - token.revoked_at <= REUSE_GRACE:
            # Benign race: another request just rotated it. Access token only.
            return user, create_access_token(identity=str(user.id)), None
        RefreshToken.query.filter_by(user_id=user_id, revoked=False).update(
            {"revoked": True, "revoked_at": utcnow()}
        )
        db.session.commit()
        raise AuthError("Refresh token reuse detected, please log in again")

    token.revoked = True
    token.revoked_at = utcnow()
    access, refresh = issue_tokens(user)
    db.session.commit()
    return user, access, refresh


def set_auth_cookies(response, access, refresh=None):
    set_access_cookies(response, access)
    if refresh:
        set_refresh_cookies(response, refresh)