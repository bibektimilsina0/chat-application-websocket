# Real-Time Chat Application

Chat rooms with instant messaging over WebSockets, message history, typing indicators and online presence.

**Stack:** Flask + Flask-SocketIO, PostgreSQL (users, rooms, memberships), Cassandra (messages), Angular + Angular Material.

## Architecture

```
Angular (4200) ──REST + cookies──▶ Flask (5000) ──▶ PostgreSQL  users, rooms, memberships, refresh tokens
       └────────Socket.IO────────▶    └──────────▶ Cassandra   messages (partition: room_id, order: time-based UUID)
```

- **Auth:** access and refresh JWTs live in `HttpOnly` cookies. Middleware silently refreshes an expired access token using the refresh cookie, and refresh tokens rotate on every use. `/auth/refresh` exists for manual use but the frontend never calls it.
- **Real time:** the socket authenticates from the same cookie during the handshake. Joining a room requires membership.
- **Messages:** stored in Cassandra, loaded 30 at a time (newest first) with `before=<message_id>` pagination.

## Setup

Requires Docker, Python 3.11+, Node 20+ and Angular CLI.

```powershell
# 1. Databases (PostgreSQL + Cassandra). Cassandra takes ~1 minute to boot.
docker compose up -d

# 2. Backend
cd backend
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
flask --app run db upgrade        # create tables
python run.py                     # http://localhost:5000

# 3. Frontend (new terminal)
cd frontend
npm install
ng serve                          # http://localhost:4200
```

Settings go in `backend/.env` (`SECRET_KEY`, `JWT_SECRET_KEY`, `DATABASE_URL`). Open the app at `http://localhost:4200`, not `127.0.0.1`, or the cookies will be dropped.

## Tests

```powershell
# Backend (needs the PostgreSQL container running)
docker exec -it chat_postgres psql -U chat -d chat -c "CREATE DATABASE chat_test;"   # once
cd backend
pytest -v

# Frontend (Jasmine + Karma)
cd frontend
ng test --no-watch --browsers=ChromeHeadless
```

Backend tests use a separate PostgreSQL database and a fake message store, so they don't need Cassandra.

## REST API

| Method | Endpoint | Description |
|---|---|---|
| POST | `/auth/register` | Create a user |
| POST | `/auth/login` | Log in, sets the cookies |
| POST | `/auth/refresh` | Rotate tokens manually |
| POST | `/auth/logout` | Revoke the refresh token, clear cookies |
| GET | `/auth/me` | Current user |
| GET | `/rooms` | List rooms (member counts, my membership) |
| POST | `/rooms/create` | Create a room (creator joins) |
| POST | `/rooms/{id}/join` | Join a room (idempotent) |
| GET | `/rooms/{id}/messages?limit=&before=` | Message history, oldest first |

All POST requests must send `X-Requested-With: XMLHttpRequest`.

## WebSocket events

| Event | Direction | Payload | Notes |
|---|---|---|---|
| `connect` / `disconnect` | built in | cookie | refused with `unauthorized` if the token is invalid |
| `join_room` / `leave_room` | client → server | `{room_id}` | ack `{ok, error?}` |
| `send_message` | client → server | `{room_id, content}` | ack `{ok, message_id?, error?}` |
| `receive_message` | server → room | message | includes "X joined the room" system messages |
| `typing` | both | `{room_id, is_typing}` | sent to others only |
| `presence` | server → room | `{room_id, users[]}` | on join, leave and disconnect |
| `room_changed` | server → all | `{id, name, member_count}` | live room list |

## Design notes

- PostgreSQL enforces integrity (foreign keys, unique room names and memberships). Cassandra holds only messages, with the username denormalised into each row.
- CSRF defence: `SameSite=Lax` cookies, CORS limited to the Angular origin, and a required custom header on unsafe methods.
- Presence is kept in server memory, so it only works with one server process. To scale out, move it to Redis and use a Socket.IO message queue.
- Very busy rooms would need Cassandra partitions bucketed by day (`room_id, day`).
- Not implemented: read receipts, file uploads, deployment.