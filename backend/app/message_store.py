import threading
from datetime import datetime, timezone

from cassandra import InvalidRequest
from cassandra.cluster import Cluster
from cassandra.util import datetime_from_uuid1, uuid_from_time


def _created_at(message_id):
    return datetime_from_uuid1(message_id).replace(tzinfo=timezone.utc).isoformat()


class CassandraMessageStore:
    """Messages partitioned by room, sorted newest-first by a time-based UUID."""

    def __init__(self, hosts, port, keyspace):
        self.hosts = hosts
        self.port = port
        self.keyspace = keyspace
        self._session = None
        self._lock = threading.Lock()

    def _ensure(self):
        if self._session is not None:
            return
        with self._lock:
            if self._session is not None:
                return
            cluster = Cluster(self.hosts, port=self.port)
            session = cluster.connect()
            session.execute(
                f"CREATE KEYSPACE IF NOT EXISTS {self.keyspace} WITH replication = "
                "{'class': 'SimpleStrategy', 'replication_factor': 1}"
            )
            session.set_keyspace(self.keyspace)
            session.execute(
                """
                CREATE TABLE IF NOT EXISTS messages (
                    room_id int,
                    message_id timeuuid,
                    user_id int,
                    username text,
                    content text,
                    kind text,
                    PRIMARY KEY ((room_id), message_id)
                ) WITH CLUSTERING ORDER BY (message_id DESC)
                """
            )
            try:  # tables created before `kind` existed
                session.execute("ALTER TABLE messages ADD kind text")
            except InvalidRequest:
                pass  # column already there

            self._insert = session.prepare(
                "INSERT INTO messages (room_id, message_id, user_id, username, content, kind) "
                "VALUES (?, ?, ?, ?, ?, ?)"
            )
            cols = "room_id, message_id, user_id, username, content, kind"
            self._latest = session.prepare(
                f"SELECT {cols} FROM messages WHERE room_id = ? LIMIT ?"
            )
            self._older = session.prepare(
                f"SELECT {cols} FROM messages WHERE room_id = ? AND message_id < ? LIMIT ?"
            )
            self._session = session

    @staticmethod
    def _to_dict(row):
        return {
            "message_id": str(row.message_id),
            "room_id": row.room_id,
            "user_id": row.user_id,
            "username": row.username,
            "content": row.content,
            "kind": row.kind or "message",  # old rows have no kind
            "created_at": _created_at(row.message_id),
        }

    def add(self, room_id, user_id, username, content, kind="message"):
        self._ensure()
        message_id = uuid_from_time(datetime.now(timezone.utc))
        self._session.execute(
            self._insert, (room_id, message_id, user_id, username, content, kind)
        )
        return {
            "message_id": str(message_id),
            "room_id": room_id,
            "user_id": user_id,
            "username": username,
            "content": content,
            "kind": kind,
            "created_at": _created_at(message_id),
        }

    def history(self, room_id, limit=30, before=None):
        """Return up to `limit` messages, oldest first. `before` is a message_id UUID."""
        self._ensure()
        if before is not None:
            rows = self._session.execute(self._older, (room_id, before, limit))
        else:
            rows = self._session.execute(self._latest, (room_id, limit))
        return [self._to_dict(r) for r in reversed(list(rows))]