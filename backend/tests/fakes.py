import uuid
from datetime import datetime, timezone


class InMemoryMessageStore:
    def __init__(self):
        self._rooms = {}

    def add(self, room_id, user_id, username, content, kind="message"):
        message = {
            "message_id": str(uuid.uuid1()),
            "room_id": room_id,
            "user_id": user_id,
            "username": username,
            "content": content,
            "kind": kind,
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
        self._rooms.setdefault(room_id, []).append(message)
        return message

    def history(self, room_id, limit=30, before=None):
        """Oldest first, like the Cassandra store. `before` is a message_id UUID."""
        messages = self._rooms.get(room_id, [])
        if before is not None:
            ids = [m["message_id"] for m in messages]
            if str(before) in ids:
                messages = messages[: ids.index(str(before))]
        return messages[-limit:]