import pytest
from sqlalchemy.exc import IntegrityError

from app.extensions import db
from app.models import Membership, Room, User


def make_user(username="alice"):
    user = User(username=username)
    user.set_password("secret123")
    db.session.add(user)
    db.session.commit()
    return user


def test_user_creation_hashes_password(app):
    with app.app_context():
        user = make_user()
        assert user.id is not None
        assert user.password_hash != "secret123"
        assert user.check_password("secret123")
        assert not user.check_password("wrong")


def test_username_must_be_unique(app):
    with app.app_context():
        make_user("alice")
        db.session.add(User(username="alice", password_hash="x"))
        with pytest.raises(IntegrityError):
            db.session.commit()


def test_membership_is_unique_per_user_and_room(app):
    with app.app_context():
        user = make_user()
        room = Room(name="general", created_by=user.id)
        db.session.add(room)
        db.session.commit()
        db.session.add_all(
            [Membership(user_id=user.id, room_id=room.id),
             Membership(user_id=user.id, room_id=room.id)]
        )
        with pytest.raises(IntegrityError):
            db.session.commit()


def test_cannot_join_a_nonexistent_room(app):
    with app.app_context():
        user = make_user()
        db.session.add(Membership(user_id=user.id, room_id=999))
        with pytest.raises(IntegrityError):
            db.session.commit()


def test_room_name_must_be_unique(app):
    with app.app_context():
        user = make_user()
        db.session.add(Room(name="general", created_by=user.id))
        db.session.commit()
        db.session.add(Room(name="general", created_by=user.id))
        with pytest.raises(IntegrityError):
            db.session.commit()


def test_deleting_a_room_removes_its_memberships(app):
    with app.app_context():
        user = make_user()
        room = Room(name="general", created_by=user.id)
        db.session.add(room)
        db.session.commit()
        db.session.add(Membership(user_id=user.id, room_id=room.id))
        db.session.commit()

        db.session.delete(room)
        db.session.commit()
        assert Membership.query.count() == 0