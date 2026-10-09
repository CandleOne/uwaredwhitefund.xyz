"""Read-only Server-Sent Events service for an Alpaca paper portfolio."""

import asyncio
import json
import logging
import os
import threading
from dataclasses import dataclass
from pathlib import Path
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any
from urllib.parse import urlparse

from alpaca.common.exceptions import APIError
from alpaca.common.enums import Sort
from alpaca.trading.client import TradingClient
from alpaca.trading.enums import QueryOrderStatus
from alpaca.trading.requests import GetOrdersRequest
from alpaca.trading.stream import TradingStream
from dotenv import load_dotenv


LOGGER = logging.getLogger(__name__)
load_dotenv(Path(__file__).with_name(".env"))


@dataclass(frozen=True)
class Settings:
    api_key: str
    api_secret: str
    allowed_origin: str
    host: str
    port: int
    refresh_seconds: int

    @classmethod
    def from_environment(cls) -> "Settings":
        required_values = {
            "ALPACA_API_KEY": os.environ.get("ALPACA_API_KEY"),
            "ALPACA_API_SECRET": os.environ.get("ALPACA_API_SECRET"),
            "PORTFOLIO_ALLOWED_ORIGIN": os.environ.get("PORTFOLIO_ALLOWED_ORIGIN"),
        }
        missing = [name for name, value in required_values.items() if not value]
        if missing:
            raise ValueError(f"Missing required environment variable(s): {', '.join(missing)}")

        allowed_origin = required_values["PORTFOLIO_ALLOWED_ORIGIN"].rstrip("/")
        parsed_origin = urlparse(allowed_origin)
        if parsed_origin.scheme not in {"http", "https"} or not parsed_origin.netloc:
            raise ValueError("PORTFOLIO_ALLOWED_ORIGIN must be an absolute http(s) origin.")

        try:
            port = int(os.environ.get("PORTFOLIO_PORT", "8787"))
            refresh_seconds = int(os.environ.get("PORTFOLIO_REFRESH_SECONDS", "15"))
        except ValueError as error:
            raise ValueError("PORTFOLIO_PORT and PORTFOLIO_REFRESH_SECONDS must be integers.") from error
        if not 1 <= port <= 65535:
            raise ValueError("PORTFOLIO_PORT must be between 1 and 65535.")
        if not 5 <= refresh_seconds <= 60:
            raise ValueError("PORTFOLIO_REFRESH_SECONDS must be between 5 and 60 seconds.")

        return cls(
            api_key=required_values["ALPACA_API_KEY"],
            api_secret=required_values["ALPACA_API_SECRET"],
            allowed_origin=allowed_origin,
            host=os.environ.get("PORTFOLIO_HOST", "127.0.0.1"),
            port=port,
            refresh_seconds=refresh_seconds,
        )


def selected_fields(model: Any, field_names: tuple[str, ...]) -> dict[str, str | None]:
    return {
        field_name: None if (value := getattr(model, field_name, None)) is None else str(value)
        for field_name in field_names
    }


class PortfolioPublisher:
    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._client = TradingClient(settings.api_key, settings.api_secret, paper=True)
        self._stream = TradingStream(settings.api_key, settings.api_secret, paper=True)
        self._condition = threading.Condition()
        self._snapshot: dict[str, Any] | None = None
        self._version = 0
        self._last_error: str | None = None

    def refresh(self) -> None:
        orders_request = GetOrdersRequest(
            status=QueryOrderStatus.ALL,
            limit=10,
            direction=Sort.DESC,
        )
        account = self._client.get_account()
        positions = self._client.get_all_positions()
        orders = self._client.get_orders(filter=orders_request)
        snapshot = {
            "account": selected_fields(
                account,
                (
                    "status",
                    "currency",
                    "equity",
                    "last_equity",
                    "portfolio_value",
                    "cash",
                    "buying_power",
                    "long_market_value",
                    "short_market_value",
                    "initial_margin",
                    "maintenance_margin",
                    "daytrade_count",
                    "pattern_day_trader",
                    "trading_blocked",
                ),
            ),
            "positions": [
                selected_fields(
                    position,
                    (
                        "symbol",
                        "side",
                        "qty",
                        "avg_entry_price",
                        "current_price",
                        "market_value",
                        "cost_basis",
                        "unrealized_pl",
                        "unrealized_plpc",
                        "change_today",
                    ),
                )
                for position in positions
            ],
            "orders": [
                selected_fields(
                    order,
                    (
                        "symbol",
                        "side",
                        "type",
                        "qty",
                        "filled_qty",
                        "filled_avg_price",
                        "status",
                        "submitted_at",
                        "filled_at",
                    ),
                )
                for order in orders
            ],
        }
        with self._condition:
            self._snapshot = snapshot
            self._last_error = None
            self._version += 1
            self._condition.notify_all()

    def refresh_safely(self) -> None:
        try:
            self.refresh()
        except (APIError, ConnectionError, OSError, TimeoutError) as error:
            with self._condition:
                self._last_error = str(error)
                self._condition.notify_all()
            LOGGER.error("Unable to retrieve Alpaca portfolio data: %s", error)

    async def _handle_trade_update(self, _: Any) -> None:
        loop = asyncio.get_running_loop()
        await loop.run_in_executor(None, self.refresh_safely)

    def _run_trade_stream(self) -> None:
        self._stream.subscribe_trade_updates(self._handle_trade_update)
        try:
            self._stream.run()
        except (ConnectionError, OSError, RuntimeError) as error:
            LOGGER.error("Alpaca trade-update stream stopped: %s", error)

    def start(self) -> None:
        self.refresh_safely()
        threading.Thread(target=self._run_trade_stream, daemon=True, name="alpaca-trade-stream").start()
        threading.Thread(target=self._poll, daemon=True, name="alpaca-portfolio-poll").start()

    def _poll(self) -> None:
        while True:
            threading.Event().wait(self._settings.refresh_seconds)
            self.refresh_safely()

    def wait_for_snapshot(self, version: int) -> tuple[dict[str, Any] | None, int, str | None]:
        with self._condition:
            if version == self._version:
                self._condition.wait(timeout=self._settings.refresh_seconds)
            return self._snapshot, self._version, self._last_error


def make_handler(settings: Settings, publisher: PortfolioPublisher) -> type[BaseHTTPRequestHandler]:
    class PortfolioRequestHandler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def _is_allowed_origin(self) -> bool:
            return self.headers.get("Origin") == settings.allowed_origin

        def _write_cors_headers(self) -> None:
            self.send_header("Access-Control-Allow-Origin", settings.allowed_origin)
            self.send_header("Vary", "Origin")

        def _send_json(self, status: HTTPStatus, body: dict[str, str]) -> None:
            encoded_body = json.dumps(body).encode("utf-8")
            self.send_response(status)
            self._write_cors_headers()
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(encoded_body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(encoded_body)

        def do_OPTIONS(self) -> None:
            if not self._is_allowed_origin():
                self._send_json(HTTPStatus.FORBIDDEN, {"error": "Origin is not allowed."})
                return
            self.send_response(HTTPStatus.NO_CONTENT)
            self._write_cors_headers()
            self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Accept")
            self.end_headers()

        def do_GET(self) -> None:
            if not self._is_allowed_origin():
                self._send_json(HTTPStatus.FORBIDDEN, {"error": "Origin is not allowed."})
                return
            if self.path != "/v1/dashboard/stream":
                self._send_json(HTTPStatus.NOT_FOUND, {"error": "Not found."})
                return
            self._stream_dashboard()

        def _stream_dashboard(self) -> None:
            self.send_response(HTTPStatus.OK)
            self._write_cors_headers()
            self.send_header("Content-Type", "text/event-stream; charset=utf-8")
            self.send_header("Cache-Control", "no-cache, no-transform")
            self.send_header("Connection", "keep-alive")
            self.end_headers()
            self.wfile.write(b"retry: 5000\n\n")
            self.wfile.flush()

            version = -1
            while True:
                snapshot, version, error = publisher.wait_for_snapshot(version)
                if snapshot is not None:
                    event = f"data: {json.dumps(snapshot, separators=(',', ':'))}\n\n".encode("utf-8")
                elif error:
                    event = b"event: error\ndata: {\"error\":\"Portfolio data is temporarily unavailable.\"}\n\n"
                else:
                    event = b": waiting for portfolio data\n\n"
                try:
                    self.wfile.write(event)
                    self.wfile.flush()
                except (BrokenPipeError, ConnectionResetError):
                    return

        def log_message(self, format: str, *args: object) -> None:
            LOGGER.info("%s - %s", self.address_string(), format % args)

    return PortfolioRequestHandler


def main() -> None:
    logging.basicConfig(level=os.environ.get("LOG_LEVEL", "INFO").upper(), format="%(asctime)s %(levelname)s %(message)s")
    settings = Settings.from_environment()
    publisher = PortfolioPublisher(settings)
    publisher.start()
    server = ThreadingHTTPServer((settings.host, settings.port), make_handler(settings, publisher))
    LOGGER.info("Serving Alpaca portfolio stream on %s:%d", settings.host, settings.port)
    server.serve_forever()


if __name__ == "__main__":
    main()
