import pytest

from app import create_app, sockets
from app.config import TestConfig
from app.extensions import db

from .fakes import InMemoryMessageStore,InMemoryFileStore
from .helpers import new_client, register_and_login


@pytest.fixture
def app():
    app = create_app(TestConfig, message_store=InMemoryMessageStore(), file_store=InMemoryFileStore())
    with app.app_context():
        db.drop_all()
        db.create_all()
    sockets.sessions.clear()

    yield app

    with app.app_context():
        db.session.remove()
        db.drop_all()
        db.engine.dispose()  # don't leak connections across tests
    sockets.sessions.clear()


@pytest.fixture
def client(app):
    return new_client(app)


@pytest.fixture
def make_client(app):
    return lambda: new_client(app)


@pytest.fixture
def alice(make_client):
    return register_and_login(make_client(), "alice")


@pytest.fixture
def bob(make_client):
    return register_and_login(make_client(), "bob")