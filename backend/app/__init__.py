from flask import Flask, jsonify
from flask_cors import CORS

from .config import Config
from .extensions import db, jwt, migrate, socketio

def create_app(config=Config,message_store=None):
    app = Flask(__name__)
    app.config.from_object(config)

    CORS(app, supports_credentials=True, origins=["http://localhost:4200"])
    db.init_app(app)
    migrate.init_app(app, db)
    jwt.init_app(app)
    from .middleware import register_auth_middleware
    register_auth_middleware(app)
    socketio.init_app(app)

    socketio.init_app(app)

    if message_store is None:
        from .message_store import CassandraMessageStore

        message_store = CassandraMessageStore(
            app.config["CASSANDRA_HOSTS"],
            app.config["CASSANDRA_PORT"],
            app.config["CASSANDRA_KEYSPACE"],
        )

    app.extensions["message_store"] = message_store
    
    @app.get("/health")
    def health():
        return {"status": "ok"}

    @app.errorhandler(404)
    def not_found(e):
        return jsonify(error="Not found"), 404

    @jwt.unauthorized_loader
    def missing_token(reason):
        return jsonify(error="Missing or invalid token"), 401

    @jwt.invalid_token_loader
    def invalid_token(reason):
        return jsonify(error="Invalid token"), 401

    @jwt.expired_token_loader
    def expired_token(header, payload):
        return jsonify(error="Token expired"), 401

    from . import models  # noqa: F401  (registers tables with SQLAlchemy)
    from .routes.auth import bp as auth_bp
    app.register_blueprint(auth_bp)
    from .routes.rooms import bp as rooms_bp
    app.register_blueprint(rooms_bp)

    from . import sockets  # noqa: F401  (registers Socket.IO event handlers)
    return app