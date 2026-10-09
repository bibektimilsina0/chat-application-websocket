from app.extensions import socketio

PASSWORD = "secret123"


def new_client(app):
    """Flask test client that sends the header our CSRF check requires."""
    client = app.test_client()
    client.environ_base["HTTP_X_REQUESTED_WITH"] = "XMLHttpRequest"
    return client


def register_and_login(client, username):
    creds = {"username": username, "password": PASSWORD}
    assert client.post("/auth/register", json=creds).status_code == 201
    assert client.post("/auth/login", json=creds).status_code == 200
    return client


def create_room(client, name="general"):
    return client.post("/rooms/create", json={"name": name})


def connect(app, client):
    """Socket.IO test client that reuses the Flask client's cookies (the handshake auth)."""
    return socketio.test_client(app, flask_test_client=client)


def call(sc, event, data):
    """Emit and return the acknowledgement."""
    result = sc.emit(event, data, callback=True)
    return result[0] if isinstance(result, list) else result


def received(sc, name):
    """Pop all pending events of one type, returning just their payloads."""
    return [e["args"][0] for e in sc.get_received() if e["name"] == name]