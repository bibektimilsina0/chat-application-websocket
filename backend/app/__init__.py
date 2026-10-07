from flask import Flask, jsonify
from flask_cors import CORS

from .config import Config
from .extensions import db, jwt, socketio


def create_app(config=Config):
    app = Flask(__name__)
    app.config.from_object(config)

    CORS(app)
    db.init_app(app)
    jwt.init_app(app)
    socketio.init_app(app)

    @app.get("/health")
    def health():
        return {"status": "ok"}

    @app.errorhandler(404)
    def not_found(e):
        return jsonify(error="Not found"), 404

    @jwt.unauthorized_loader
    def missing_token(reason):
        return jsonify(error="Missing or invalid token"), 401

    @jwt.expired_token_loader
    def expired_token(header, payload):
        return jsonify(error="Token expired"), 401

    return app