import threading

from minio import Minio
from minio.error import S3Error


class MinioFileStore:
    """Connects lazily and creates the bucket on first use, like the message store."""

    def __init__(self, endpoint, access_key, secret_key, secure, bucket):
        self.endpoint, self.access_key, self.secret_key = endpoint, access_key, secret_key
        self.secure, self.bucket = secure, bucket
        self._client = None
        self._lock = threading.Lock()

    def _ensure(self):
        if self._client is not None:
            return
        with self._lock:
            if self._client is not None:
                return
            client = Minio(self.endpoint, access_key=self.access_key,
                           secret_key=self.secret_key, secure=self.secure)
            if not client.bucket_exists(self.bucket):
                client.make_bucket(self.bucket)
            self._client = client

    def put(self, key, stream, length, content_type):
        self._ensure()
        self._client.put_object(self.bucket, key, stream, length, content_type=content_type)

    def get(self, key):
        """Return (chunk iterator, length). Raises FileNotFoundError."""
        self._ensure()
        try:
            resp = self._client.get_object(self.bucket, key)
        except S3Error as e:
            if e.code == "NoSuchKey":
                raise FileNotFoundError(key) from e
            raise
        length = int(resp.headers.get("Content-Length", 0))

        def chunks():
            try:
                yield from resp.stream(64 * 1024)
            finally:
                resp.close()
                resp.release_conn()

        return chunks(), length

    def delete(self, key):
        self._ensure()
        self._client.remove_object(self.bucket, key)