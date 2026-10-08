import os
from dotenv import load_dotenv
from datetime import timedelta
load_dotenv()


class Config:
    SECRET_KEY = os.getenv("SECRET_KEY", "dev-secret")
    JWT_SECRET_KEY = os.getenv("JWT_SECRET_KEY", "dev-jwt-secret-change-me-32-bytes-min")
    SQLALCHEMY_DATABASE_URI = os.getenv(
        "DATABASE_URL", "postgresql+psycopg://chat:chat@localhost:5432/chat"
    )
    SQLALCHEMY_TRACK_MODIFICATIONS = False
    JWT_TOKEN_LOCATION = ["cookies"]
    JWT_ACCESS_COOKIE_NAME = "access_token"
    JWT_ACCESS_COOKIE_PATH = "/"
    JWT_REFRESH_COOKIE_NAME = "refresh_token"
    JWT_REFRESH_COOKIE_PATH = "/"         
    JWT_SESSION_COOKIE = False             # cookie lifetime = token lifetime
    JWT_COOKIE_SECURE = False              # True in production (HTTPS)
    JWT_COOKIE_SAMESITE = "Lax"
    JWT_COOKIE_CSRF_PROTECT = False  
    JWT_ACCESS_TOKEN_EXPIRES = timedelta(minutes=15)
    JWT_REFRESH_TOKEN_EXPIRES = timedelta(days=7)

    # cassandra config
    CASSANDRA_HOSTS = os.getenv("CASSANDRA_HOSTS", "127.0.0.1").split(",")
    CASSANDRA_PORT = int(os.getenv("CASSANDRA_PORT", "9042"))
    CASSANDRA_KEYSPACE = os.getenv("CASSANDRA_KEYSPACE", "chat")

class TestConfig(Config):
    TESTING = True
    SQLALCHEMY_DATABASE_URI = "sqlite:///:memory:"