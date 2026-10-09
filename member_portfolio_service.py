"""Authenticated portfolio service with encrypted Alpaca paper credentials."""

import base64
import hmac
import json
import os
import sqlite3
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import click
from alpaca.common.exceptions import APIError
from alpaca.trading.client import TradingClient
from alpaca.trading.enums import QueryOrderStatus
from alpaca.trading.requests import GetOrdersRequest
from alpaca.common.enums import Sort
from cryptography.fernet import Fernet, InvalidToken
from dotenv import load_dotenv
from flask import Flask, Response, g, jsonify, request, session
from werkzeug.security import check_password_hash, generate_password_hash


PROJECT_ROOT = Path(__file__).resolve().parent
load_dotenv(PROJECT_ROOT / ".env")


@dataclass(frozen=True)
class Settings:
    allowed_origin: str
    database_path: Path
    encryption_key: bytes
    session_secret: str
    allow_manager_setup: bool = True

    @classmethod
    def from_environment(cls) -> "Settings":
        required = {
            "APP_SESSION_SECRET": os.environ.get("APP_SESSION_SECRET"),
            "ALPACA_CREDENTIAL_ENCRYPTION_KEY": os.environ.get("ALPACA_CREDENTIAL_ENCRYPTION_KEY"),
            "PORTFOLIO_ALLOWED_ORIGIN": os.environ.get("PORTFOLIO_ALLOWED_ORIGIN"),
        }
        missing = [name for name, value in required.items() if not value]
        if missing:
            raise ValueError(f"Missing required environment variable(s): {', '.join(missing)}")
        try:
            encryption_key = base64.urlsafe_b64decode(required["ALPACA_CREDENTIAL_ENCRYPTION_KEY"])
        except ValueError as error:
            raise ValueError("ALPACA_CREDENTIAL_ENCRYPTION_KEY must be a Fernet key.") from error
        if len(encryption_key) != 32:
            raise ValueError("ALPACA_CREDENTIAL_ENCRYPTION_KEY must be a Fernet key.")
        return cls(
            allowed_origin=required["PORTFOLIO_ALLOWED_ORIGIN"].rstrip("/"),
            database_path=Path(os.environ.get("PORTFOLIO_DATABASE_PATH", PROJECT_ROOT / "instance" / "portfolio.db")),
            encryption_key=required["ALPACA_CREDENTIAL_ENCRYPTION_KEY"].encode("ascii"),
            session_secret=required["APP_SESSION_SECRET"],
            allow_manager_setup=os.environ.get("ALLOW_MANAGER_SETUP", "true").lower() == "true",
        )


def serialize(model: Any, fields: tuple[str, ...]) -> dict[str, str | None]:
    return {field: None if (value := getattr(model, field, None)) is None else str(value) for field in fields}


def portfolio_snapshot(client: TradingClient) -> dict[str, Any]:
    account = client.get_account()
    positions = client.get_all_positions()
    orders = client.get_orders(filter=GetOrdersRequest(status=QueryOrderStatus.ALL, limit=10, direction=Sort.DESC))
    return {
        "account": serialize(
            account,
            (
                "equity",
                "last_equity",
                "portfolio_value",
                "cash",
                "buying_power",
                "long_market_value",
                "short_market_value",
                "maintenance_margin",
            ),
        ),
        "positions": [
            serialize(
                position,
                ("symbol", "side", "qty", "current_price", "market_value", "unrealized_pl", "change_today"),
            )
            for position in positions
        ],
        "orders": [
            serialize(order, ("symbol", "side", "type", "qty", "filled_qty", "status", "submitted_at"))
            for order in orders
        ],
    }


def create_app(settings: Settings | None = None) -> Flask:
    settings = settings or Settings.from_environment()
    settings.database_path.parent.mkdir(parents=True, exist_ok=True)
    app = Flask(__name__)
    app.config.update(
        SECRET_KEY=settings.session_secret,
        SESSION_COOKIE_HTTPONLY=True,
        SESSION_COOKIE_SAMESITE="Lax",
        SESSION_COOKIE_SECURE=settings.allowed_origin.startswith("https://"),
    )
    cipher = Fernet(settings.encryption_key)

    def database() -> sqlite3.Connection:
        if "database" not in g:
            g.database = sqlite3.connect(settings.database_path)
            g.database.row_factory = sqlite3.Row
        return g.database

    @app.teardown_appcontext
    def close_database(_: BaseException | None) -> None:
        connection = g.pop("database", None)
        if connection is not None:
            connection.close()

    def initialize_database() -> None:
        connection = sqlite3.connect(settings.database_path)
        try:
            connection.executescript(
                """
                CREATE TABLE IF NOT EXISTS users (
                    id INTEGER PRIMARY KEY,
                    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
                    password_hash TEXT NOT NULL,
                    role TEXT NOT NULL CHECK(role IN ('manager', 'member')),
                    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                );
                CREATE TABLE IF NOT EXISTS portfolios (
                    id INTEGER PRIMARY KEY,
                    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    label TEXT NOT NULL,
                    api_key_ciphertext BLOB NOT NULL,
                    api_secret_ciphertext BLOB NOT NULL,
                    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE(user_id, label)
                );
                CREATE TABLE IF NOT EXISTS application_settings (
                    setting_key TEXT PRIMARY KEY,
                    setting_value TEXT NOT NULL
                );
                INSERT OR IGNORE INTO application_settings (setting_key, setting_value)
                    VALUES ('default_portfolio_enabled', 'true');
                """
            )
            connection.commit()
        finally:
            connection.close()

    initialize_database()

    @app.cli.command("create-manager")
    @click.option("--email", prompt=True)
    @click.password_option()
    def create_manager(email: str, password: str) -> None:
        email = email.strip().lower()
        if not email or len(password) < 12:
            raise click.ClickException("An email and a password of at least 12 characters are required.")
        connection = database()
        connection.execute("BEGIN IMMEDIATE")
        if connection.execute("SELECT 1 FROM users LIMIT 1").fetchone() is not None:
            raise click.ClickException("The initial account has already been created.")
        connection.execute(
            "INSERT INTO users (email, password_hash, role) VALUES (?, ?, 'manager')",
            (email, generate_password_hash(password)),
        )
        connection.commit()
        click.echo("Manager account created.")

    @app.get("/healthz")
    def health() -> Response:
        database().execute("SELECT 1").fetchone()
        return jsonify(status="ok")

    @app.after_request
    def add_cors_headers(response: Response) -> Response:
        if request.headers.get("Origin") == settings.allowed_origin:
            response.headers["Access-Control-Allow-Origin"] = settings.allowed_origin
            response.headers["Access-Control-Allow-Credentials"] = "true"
            response.headers["Vary"] = "Origin"
            if request.method == "OPTIONS":
                response.headers["Access-Control-Allow-Methods"] = "GET, POST, DELETE, OPTIONS"
                response.headers["Access-Control-Allow-Headers"] = "Content-Type, X-CSRF-Token"
        return response

    @app.route("/v1/auth", methods=["OPTIONS"])
    @app.route("/v1/portfolios", methods=["OPTIONS"])
    def options() -> Response:
        response = Response(status=204)
        response.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
        response.headers["Access-Control-Allow-Headers"] = "Content-Type, X-CSRF-Token"
        return response

    def csrf_token() -> str:
        token = session.get("csrf_token")
        if not token:
            token = os.urandom(32).hex()
            session["csrf_token"] = token
        return token

    def validate_csrf() -> Response | None:
        token = request.headers.get("X-CSRF-Token")
        if not token or not hmac.compare_digest(token, session.get("csrf_token", "")):
            return jsonify(error="Invalid CSRF token."), 403
        return None

    def current_user() -> sqlite3.Row | None:
        user_id = session.get("user_id")
        if not isinstance(user_id, int):
            return None
        return database().execute("SELECT id, email, role FROM users WHERE id = ?", (user_id,)).fetchone()

    def default_portfolio_enabled() -> bool:
        setting = database().execute(
            "SELECT setting_value FROM application_settings WHERE setting_key = 'default_portfolio_enabled'"
        ).fetchone()
        return setting is not None and setting["setting_value"] == "true"

    def require_user() -> tuple[sqlite3.Row | None, Response | None]:
        user = current_user()
        if user is None:
            return None, (jsonify(error="Authentication is required."), 401)
        return user, None

    def read_json(fields: tuple[str, ...]) -> tuple[dict[str, str] | None, Response | None]:
        payload = request.get_json(silent=True)
        if not isinstance(payload, dict):
            return None, (jsonify(error="A JSON request body is required."), 400)
        values = {field: payload.get(field, "").strip() if isinstance(payload.get(field), str) else "" for field in fields}
        missing = [field for field, value in values.items() if not value]
        if missing:
            return None, (jsonify(error=f"Missing required field(s): {', '.join(missing)}."), 400)
        return values, None

    @app.get("/v1/auth/status")
    def auth_status() -> Response:
        user = current_user()
        return jsonify(
            authenticated=user is not None,
            setup_required=settings.allow_manager_setup
            and database().execute("SELECT 1 FROM users LIMIT 1").fetchone() is None,
            default_portfolio_enabled=default_portfolio_enabled(),
            user=None if user is None else {"email": user["email"], "role": user["role"]},
            csrf_token=csrf_token(),
        )

    @app.post("/v1/auth/setup")
    def setup_manager() -> Response:
        csrf_error = validate_csrf()
        if csrf_error:
            return csrf_error
        if not settings.allow_manager_setup:
            return jsonify(error="Manager setup is only available through the server console."), 403
        if database().execute("SELECT 1 FROM users LIMIT 1").fetchone() is not None:
            return jsonify(error="The manager account has already been created."), 409
        values, error = read_json(("email", "password"))
        if error:
            return error
        if len(values["password"]) < 12:
            return jsonify(error="Passwords must contain at least 12 characters."), 400
        cursor = database().execute(
            "INSERT INTO users (email, password_hash, role) VALUES (?, ?, 'manager')",
            (values["email"].lower(), generate_password_hash(values["password"])),
        )
        database().commit()
        session.clear()
        session["user_id"] = cursor.lastrowid
        csrf_token()
        return jsonify(user={"email": values["email"].lower(), "role": "manager"}), 201

    @app.post("/v1/auth/login")
    def login() -> Response:
        csrf_error = validate_csrf()
        if csrf_error:
            return csrf_error
        values, error = read_json(("email", "password"))
        if error:
            return error
        user = database().execute(
            "SELECT id, email, password_hash, role FROM users WHERE email = ?", (values["email"],)
        ).fetchone()
        if user is None or not check_password_hash(user["password_hash"], values["password"]):
            return jsonify(error="Invalid email or password."), 401
        session.clear()
        session["user_id"] = user["id"]
        csrf_token()
        return jsonify(user={"email": user["email"], "role": user["role"]})

    @app.post("/v1/auth/logout")
    def logout() -> Response:
        csrf_error = validate_csrf()
        if csrf_error:
            return csrf_error
        session.clear()
        return Response(status=204)

    @app.post("/v1/members")
    def create_member() -> Response:
        csrf_error = validate_csrf()
        if csrf_error:
            return csrf_error
        user, auth_error = require_user()
        if auth_error:
            return auth_error
        if user["role"] != "manager":
            return jsonify(error="Only managers can create member accounts."), 403
        values, error = read_json(("email", "password"))
        if error:
            return error
        if len(values["password"]) < 12:
            return jsonify(error="Passwords must contain at least 12 characters."), 400
        try:
            database().execute(
                "INSERT INTO users (email, password_hash, role) VALUES (?, ?, 'member')",
                (values["email"].lower(), generate_password_hash(values["password"])),
            )
            database().commit()
        except sqlite3.IntegrityError:
            return jsonify(error="A member with that email already exists."), 409
        return jsonify(message="Member account created."), 201

    @app.get("/v1/portfolios")
    def list_portfolios() -> Response:
        user, auth_error = require_user()
        if auth_error:
            return auth_error
        rows = database().execute(
            """SELECT id, label, created_at, user_id = ? AS is_owner
               FROM portfolios
               ORDER BY id""",
            (user["id"],),
        ).fetchall()
        return jsonify(portfolios=[dict(row) for row in rows])

    @app.post("/v1/portfolios")
    def link_portfolio() -> Response:
        csrf_error = validate_csrf()
        if csrf_error:
            return csrf_error
        user, auth_error = require_user()
        if auth_error:
            return auth_error
        values, error = read_json(("label", "api_key", "api_secret"))
        if error:
            return error
        if len(values["label"]) > 40:
            return jsonify(error="Portfolio labels must be 40 characters or fewer."), 400
        try:
            TradingClient(values["api_key"], values["api_secret"], paper=True).get_account()
        except (ConnectionError, OSError, TimeoutError) as exc:
            return jsonify(error=f"Alpaca could not be reached: {exc}"), 502
        except APIError:
            return jsonify(error="Alpaca rejected the provided paper-trading credentials."), 400
        try:
            cursor = database().execute(
                """INSERT INTO portfolios (user_id, label, api_key_ciphertext, api_secret_ciphertext)
                   VALUES (?, ?, ?, ?)""",
                (
                    user["id"],
                    values["label"],
                    cipher.encrypt(values["api_key"].encode("utf-8")),
                    cipher.encrypt(values["api_secret"].encode("utf-8")),
                ),
            )
            database().commit()
        except sqlite3.IntegrityError:
            return jsonify(error="A portfolio with that label already exists."), 409
        return jsonify(portfolio={"id": cursor.lastrowid, "label": values["label"]}), 201

    @app.delete("/v1/portfolios")
    def unlink_all_portfolios() -> Response:
        csrf_error = validate_csrf()
        if csrf_error:
            return csrf_error
        user, auth_error = require_user()
        if auth_error:
            return auth_error
        cursor = database().execute("DELETE FROM portfolios WHERE user_id = ?", (user["id"],))
        database().commit()
        return jsonify(unlinked_count=cursor.rowcount)

    @app.delete("/v1/portfolios/<int:portfolio_id>")
    def unlink_portfolio(portfolio_id: int) -> Response:
        csrf_error = validate_csrf()
        if csrf_error:
            return csrf_error
        user, auth_error = require_user()
        if auth_error:
            return auth_error
        cursor = database().execute(
            "DELETE FROM portfolios WHERE id = ? AND user_id = ?",
            (portfolio_id, user["id"]),
        )
        database().commit()
        if cursor.rowcount != 1:
            return jsonify(error="Portfolio not found."), 404
        return Response(status=204)

    @app.delete("/v1/admin/default-portfolio")
    def unlink_default_portfolio() -> Response:
        csrf_error = validate_csrf()
        if csrf_error:
            return csrf_error
        user, auth_error = require_user()
        if auth_error:
            return auth_error
        if user["role"] != "manager":
            return jsonify(error="Only managers can unlink the shared Client portfolio."), 403
        database().execute(
            """UPDATE application_settings
               SET setting_value = 'false'
               WHERE setting_key = 'default_portfolio_enabled'"""
        )
        database().commit()
        return Response(status=204)

    @app.get("/v1/portfolios/<int:portfolio_id>/stream")
    def stream_portfolio(portfolio_id: int) -> Response:
        _, auth_error = require_user()
        if auth_error:
            return auth_error
        portfolio = database().execute(
            """SELECT id, api_key_ciphertext, api_secret_ciphertext FROM portfolios
               WHERE id = ?""",
            (portfolio_id,),
        ).fetchone()
        if portfolio is None:
            return jsonify(error="Portfolio not found."), 404
        try:
            api_key = cipher.decrypt(portfolio["api_key_ciphertext"]).decode("utf-8")
            api_secret = cipher.decrypt(portfolio["api_secret_ciphertext"]).decode("utf-8")
        except InvalidToken:
            return jsonify(error="The stored portfolio credentials cannot be decrypted."), 500

        def generate() -> Any:
            client = TradingClient(api_key, api_secret, paper=True)
            while True:
                try:
                    yield f"data: {json.dumps(portfolio_snapshot(client), separators=(',', ':'))}\n\n"
                except (ConnectionError, OSError, TimeoutError):
                    yield 'event: error\ndata: {"error":"Portfolio data is temporarily unavailable."}\n\n'
                time.sleep(15)

        return Response(generate(), mimetype="text/event-stream", headers={"Cache-Control": "no-cache"})

    @app.get("/v1/dashboard/stream")
    def stream_default_portfolio() -> Response:
        if not default_portfolio_enabled():
            return jsonify(error="The shared Client portfolio is no longer available."), 404
        api_key = os.environ.get("ALPACA_API_KEY")
        api_secret = os.environ.get("ALPACA_API_SECRET")
        if not api_key or not api_secret:
            return jsonify(error="The default portfolio is not configured."), 503

        def generate() -> Any:
            client = TradingClient(api_key, api_secret, paper=True)
            while True:
                try:
                    yield f"data: {json.dumps(portfolio_snapshot(client), separators=(',', ':'))}\n\n"
                except (ConnectionError, OSError, TimeoutError):
                    yield 'event: error\ndata: {"error":"Portfolio data is temporarily unavailable."}\n\n'
                time.sleep(15)

        return Response(generate(), mimetype="text/event-stream", headers={"Cache-Control": "no-cache"})

    return app


if __name__ == "__main__":
    create_app().run(host=os.environ.get("PORTFOLIO_HOST", "127.0.0.1"), port=int(os.environ.get("PORTFOLIO_PORT", "8788")))
