import io

from .helpers import connect, create_room, received


def upload(client, room_id, name="pic.png", data=b"\x89PNG fake", **kwargs):
    return client.post(
        f"/rooms/{room_id}/files",
        data={"file": (io.BytesIO(data), name)},
        content_type="multipart/form-data",
        **kwargs,
    )


def test_upload_creates_a_file_message(alice):
    rid = create_room(alice).get_json()["id"]
    r = upload(alice, rid, "photo.png")

    assert r.status_code == 201
    body = r.get_json()
    assert body["kind"] == "file" and body["content"] == "photo.png"
    assert body["file"]["type"] == "image/png"
    history = alice.get(f"/rooms/{rid}/messages").get_json()
    assert history[-1]["file"]["key"] == body["file"]["key"]


def test_upload_is_pushed_to_the_room(app, alice, bob):
    rid = create_room(alice).get_json()["id"]
    bob.post(f"/rooms/{rid}/join")
    sc = connect(app, bob)
    sc.emit("join_room", {"room_id": rid})
    sc.get_received()

    upload(alice, rid, "notes.txt", b"hello")

    assert received(sc, "receive_message")[0]["file"]["name"] == "notes.txt"


def test_disallowed_file_types_are_rejected(alice):
    rid = create_room(alice).get_json()["id"]
    assert upload(alice, rid, "evil.svg").status_code == 415
    assert upload(alice, rid, "run.exe").status_code == 415
    assert upload(alice, rid, "noextension").status_code == 415


def test_empty_and_oversized_files_are_rejected(app, alice):
    rid = create_room(alice).get_json()["id"]
    assert upload(alice, rid, data=b"").status_code == 400
    app.config["MAX_UPLOAD_BYTES"] = 10
    assert upload(alice, rid, data=b"x" * 11).status_code == 413


def test_only_members_can_upload_or_download(alice, bob):
    rid = create_room(alice).get_json()["id"]
    key = upload(alice, rid).get_json()["file"]["key"]

    assert upload(bob, rid).status_code == 403
    assert bob.get(f"/rooms/{rid}/files/{key}").status_code == 403


def test_download_returns_the_bytes_with_safe_headers(alice):
    rid = create_room(alice).get_json()["id"]
    key = upload(alice, rid, "report.pdf", b"%PDF-1.4 data").get_json()["file"]["key"]

    r = alice.get(f"/rooms/{rid}/files/{key}?filename=my report.pdf")

    assert r.status_code == 200 and r.data == b"%PDF-1.4 data"
    assert r.headers["Content-Type"].startswith("application/pdf")
    assert r.headers["X-Content-Type-Options"] == "nosniff"
    assert "attachment" in r.headers["Content-Disposition"]


def test_images_display_inline(alice):
    rid = create_room(alice).get_json()["id"]
    key = upload(alice, rid, "a.png").get_json()["file"]["key"]
    assert "Content-Disposition" not in alice.get(f"/rooms/{rid}/files/{key}").headers


def test_bad_or_unknown_file_names_return_404(alice):
    rid = create_room(alice).get_json()["id"]
    assert alice.get(f"/rooms/{rid}/files/..%2Fsecret").status_code == 404
    assert alice.get(f"/rooms/{rid}/files/{'a' * 32}.png").status_code == 404


def test_files_require_login(client):
    assert client.get("/rooms/1/files/" + "a" * 32 + ".png").status_code == 401