# Real-Time Chat Application

Chat rooms with instant messaging over WebSockets, message history, typing indicators, online presence and file sharing.

**Stack:** Flask + Flask-SocketIO, PostgreSQL (users, rooms, memberships), Cassandra (messages), MinIO (uploaded files), Angular + Angular Material.

## Architecture

```text
Angular (4200) ──REST + cookies──▶ Flask (5000) ──▶ PostgreSQL  users, rooms, memberships, refresh tokens
       └────────Socket.IO────────▶    ├──────────▶ Cassandra   messages (partition: room_id, order: time-based UUID)
                                      └──────────▶ MinIO       uploaded files (S3 API)
```

- **Auth:** Access and refresh JWTs live in `HttpOnly` cookies. Middleware silently refreshes an expired access token using the refresh cookie, and refresh tokens rotate on every use. `/auth/refresh` exists for manual use but the frontend never calls it.
- **Real time:** The socket authenticates from the same cookie during the handshake. Joining a room requires membership.
- **Messages:** Stored in Cassandra, loaded 30 at a time with `before=<message_id>` pagination.
- **Files:** Stored in MinIO and served through the API, so only room members can read them.

## Setup (local development)

Requires Docker, Python 3.12, Node 20+, Angular CLI, and Chrome (for the frontend tests).

```powershell
# 1. Start the infrastructure (PostgreSQL + Cassandra + MinIO).
#    Cassandra takes about a minute to become ready.
docker compose up -d

# 2. Configure and start the backend
cd backend
Copy-Item .env.example .env
# Edit .env with your local settings

python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
flask --app run db upgrade
python run.py
```

Open a **new terminal** for the frontend:

```powershell
cd frontend
npm install
ng serve
```

Open the app at [http://localhost:4200](http://localhost:4200). Use `localhost` consistently rather than switching to `127.0.0.1`, so cookie behavior matches your configured frontend origin.

## Run everything in Docker

```powershell
Copy-Item .env.prod.example .env.prod
# Edit .env.prod and set your own passwords and secrets

docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build
```

Open [http://localhost:4200](http://localhost:4200). The API is on port 5000.

- Stop `ng serve` and `python run.py` first; they use the same ports.
- The first start takes a few minutes, because the backend waits for Cassandra to become healthy.
- The stack uses its own project name (`chat-prod`), so its data never mixes with the development containers.
- Every `docker compose` command for this stack needs `--env-file .env.prod`, for example `docker compose -f docker-compose.prod.yml --env-file .env.prod logs backend`.
- `CORS_ORIGINS` in `.env.prod` must match the address in the browser (`http://localhost:4200`).

## Tests

### Backend

Requires the PostgreSQL container to be running. Create the test database once:

```powershell
docker exec -it chat_postgres psql -U chat -d chat -c "CREATE DATABASE chat_test;"
cd backend
pytest -v
```

Backend tests use a separate PostgreSQL database plus fake message and file stores, so they don't need Cassandra or MinIO.

### Frontend

Uses Jasmine and Karma:

```powershell
cd frontend
ng test --no-watch --browsers=ChromeHeadless
```

## REST API

| Method | Endpoint | Description |
|---|---|---|
| GET | `/health` | Health check |
| POST | `/auth/register` | Create a user |
| POST | `/auth/login` | Log in and set cookies |
| POST | `/auth/refresh` | Rotate tokens manually |
| POST | `/auth/logout` | Revoke the refresh token and clear cookies |
| GET | `/auth/me` | Get the current user |
| GET | `/rooms` | List rooms with member counts and membership status |
| POST | `/rooms/create` | Create a room; creator joins automatically |
| POST | `/rooms/{id}/join` | Join a room (idempotent) |
| GET | `/rooms/{id}/messages?limit=&before=` | Retrieve message history with pagination |
| POST | `/rooms/{id}/files` | Upload a file (max 10 MB) to a room |
| GET | `/rooms/{id}/files/{name}` | Download a file (members only) |

All POST requests must send `X-Requested-With: XMLHttpRequest`.

## WebSocket Events

| Event | Direction | Payload | Notes |
|---|---|---|---|
| `connect` / `disconnect` | Built-in | Cookie | Connection is refused if authentication fails |
| `join_room` / `leave_room` | Client → server | `{room_id}` | Acknowledgment: `{ok, error?}` |
| `send_message` | Client → server | `{room_id, content}` | Acknowledgment: `{ok, message_id?, error?}` |
| `receive_message` | Server → room | Message | Includes system messages (users joining) and file messages |
| `typing` | Both | `{room_id, is_typing}` | Sent to other users |
| `presence` | Server → room | `{room_id, users[]}` | Updated on join, leave and disconnect |
| `room_changed` | Server → all | `{id, name, member_count}` | Live room list updates |

## Design Notes

- PostgreSQL enforces relational integrity through foreign keys and unique constraints for room names and memberships.
- Cassandra stores messages, with usernames denormalized into message rows.
- **CSRF defence:** `SameSite=Lax` cookies, restricted CORS origins and a required custom header on unsafe requests.
- **File uploads:** only allowlisted file types (no SVG or HTML), a 10 MB limit, and `nosniff` on downloads.
- Presence is stored in server memory, so it supports only a single server process. Scaling out requires Redis and a Socket.IO message queue.
- Very busy rooms may eventually require Cassandra partitions bucketed by day (`room_id`, `day`).
- Bonus features implemented: file uploads (MinIO) and Docker deployment. Not implemented: read receipts.