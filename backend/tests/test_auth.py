from datetime import timedelta

import pytest
from flask_jwt_extended import create_access_token

from app.extensions import db
from app.models import RefreshToken, utcnow

from .helpers import PASSWORD

CREDS = {"username": "alice", "password": PASSWORD}


# ---------- registration ----------

def test_register_success(client):
    r = client.post("/auth/register", json=CREDS)
    assert r.status_code == 201
    body = r.get_json()
    assert body["username"] == "alice"
    assert "password" not in body and "password_hash" not in body


@pytest.mark.parametrize(
    "username,password",
    [("ab", PASSWORD), ("", PASSWORD), ("alice", "short"), ("alice", "")],
)
def test_register_validation(client, username, password):
    r = client.post("/auth/register", json={"username": username, "password": password})
    assert r.status_code == 400


def test_register_duplicate_username(client):
    client.post("/auth/register", json=CREDS)
    assert client.post("/auth/register", json=CREDS).status_code == 409


# ---------- login ----------

def test_login_sets_httponly_cookies_and_no_token_in_body(client):
    client.post("/auth/register", json=CREDS)
    r = client.post("/auth/login", json=CREDS)
    assert r.status_code == 200
    assert r.get_json()["user"]["username"] == "alice"
    assert "access_token" not in r.get_json()

    set_cookies = r.headers.getlist("Set-Cookie")
    assert len(set_cookies) == 2
    assert all("HttpOnly" in c for c in set_cookies)
    assert client.get_cookie("access_token") and client.get_cookie("refresh_token")


def test_login_wrong_password(client):
    client.post("/auth/register", json=CREDS)
    r = client.post("/auth/login", json={**CREDS, "password": "wrong-password"})
    assert r.status_code == 401


def test_login_unknown_user_gives_same_error(client):
    client.post("/auth/register", json=CREDS)
    wrong_pw = client.post("/auth/login", json={**CREDS, "password": "nope-nope"})
    unknown = client.post("/auth/login", json={"username": "ghost", "password": PASSWORD})
    assert unknown.status_code == 401
    assert unknown.get_json() == wrong_pw.get_json()


def test_me_requires_login(client):
    assert client.get("/auth/me").status_code == 401


def test_me_returns_current_user(alice):
    assert alice.get("/auth/me").get_json()["username"] == "alice"


# ---------- CSRF header ----------

def test_post_without_csrf_header_is_rejected(app):
    plain = app.test_client()  # no X-Requested-With
    assert plain.post("/auth/register", json=CREDS).status_code == 403


# ---------- logout ----------

def test_logout_clears_cookies_and_revokes_token(app, alice):
    assert alice.post("/auth/logout").status_code == 200
    assert alice.get_cookie("access_token") is None
    assert alice.get_cookie("refresh_token") is None
    assert alice.get("/auth/me").status_code == 401
    with app.app_context():
        assert RefreshToken.query.filter_by(revoked=False).count() == 0


# ---------- middleware: silent refresh ----------

def test_missing_access_cookie_is_refreshed_silently(app, alice):
    old_refresh = alice.get_cookie("refresh_token").value
    alice.delete_cookie("access_token")

    r = alice.get("/auth/me")

    assert r.status_code == 200
    assert r.get_json()["username"] == "alice"
    assert alice.get_cookie("access_token") is not None
    assert alice.get_cookie("refresh_token").value != old_refresh  # rotated
    with app.app_context():
        assert RefreshToken.query.filter_by(revoked=True).count() == 1
        assert RefreshToken.query.filter_by(revoked=False).count() == 1


def test_expired_access_cookie_is_refreshed_silently(app, alice):
    with app.app_context():
        expired = create_access_token(identity="1", expires_delta=timedelta(seconds=-5))
    alice.set_cookie("access_token", expired)

    assert alice.get("/auth/me").status_code == 200


def test_tampered_access_cookie_is_not_refreshed(alice):
    alice.set_cookie("access_token", "garbage")
    assert alice.get("/auth/me").status_code == 401


def test_invalid_refresh_cookie_ends_the_session(alice):
    alice.delete_cookie("access_token")
    alice.set_cookie("refresh_token", "garbage")
    assert alice.get("/auth/me").status_code == 401


# ---------- /auth/refresh (manual route) ----------

def test_manual_refresh_rotates_tokens(alice):
    old = alice.get_cookie("refresh_token").value
    r = alice.post("/auth/refresh")
    assert r.status_code == 200
    assert alice.get_cookie("refresh_token").value != old


def test_manual_refresh_without_cookie(client):
    assert client.post("/auth/refresh").status_code == 401


def test_parallel_use_of_old_refresh_token_is_tolerated(alice):
    old = alice.get_cookie("refresh_token").value
    assert alice.post("/auth/refresh").status_code == 200

    alice.set_cookie("refresh_token", old)  # a second request still holding the old cookie
    assert alice.post("/auth/refresh").status_code == 200  # within the grace window


def test_reuse_after_grace_window_revokes_everything(app, alice):
    old = alice.get_cookie("refresh_token").value
    alice.post("/auth/refresh")
    with app.app_context():
        RefreshToken.query.filter_by(revoked=True).update(
            {"revoked_at": utcnow() - timedelta(minutes=1)}
        )
        db.session.commit()

    alice.set_cookie("refresh_token", old)
    assert alice.post("/auth/refresh").status_code == 401
    with app.app_context():
        assert RefreshToken.query.filter_by(revoked=False).count() == 0