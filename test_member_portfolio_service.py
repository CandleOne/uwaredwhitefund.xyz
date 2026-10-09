import json
import os
import tempfile
import unittest
from dataclasses import replace
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from cryptography.fernet import Fernet

from member_portfolio_service import Settings, create_app


class MemberServiceTest(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.settings = Settings(
            allowed_origin="https://uwaredwhitefund.xyz",
            database_path=Path(self.directory.name) / "portfolio.db",
            encryption_key=Fernet.generate_key(),
            session_secret="test-session-secret",
        )
        self.app = create_app(self.settings)
        self.app.config["TESTING"] = True
        self.client = self.app.test_client()
        self.origin = {"Origin": self.settings.allowed_origin}

    def status(self):
        return self.client.get("/v1/auth/status", headers=self.origin)

    def post(self, path, token, payload=None):
        return self.client.post(
            path,
            json=payload or {},
            headers={**self.origin, "X-CSRF-Token": token},
        )

    def test_health_without_credentials(self):
        response = self.client.get("/healthz")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json, {"status": "ok"})
        self.assertNotIn("Set-Cookie", response.headers)

    def test_https_login_logout_and_persistent_users(self):
        response = self.status()
        self.assertTrue(response.json["setup_required"])
        self.assertIn("Secure", response.headers["Set-Cookie"])
        self.assertIn("HttpOnly", response.headers["Set-Cookie"])
        self.assertIn("SameSite=Lax", response.headers["Set-Cookie"])
        credentials = {"email": "manager@example.com", "password": "test-password-123"}
        response = self.post("/v1/auth/setup", response.json["csrf_token"], credentials)
        self.assertEqual(response.status_code, 201)
        status = self.status().json
        self.assertTrue(status["authenticated"])
        self.assertEqual(self.client.get("/v1/portfolios").status_code, 200)
        self.assertEqual(self.post("/v1/auth/logout", status["csrf_token"]).status_code, 204)
        self.assertEqual(self.client.get("/v1/portfolios").status_code, 401)
        self.client = create_app(self.settings).test_client()
        status = self.status().json
        self.assertFalse(status["setup_required"])
        response = self.post("/v1/auth/login", status["csrf_token"], credentials)
        self.assertEqual(response.status_code, 200)
        self.assertTrue(self.status().json["authenticated"])

    def test_cors_preflight_and_csrf(self):
        response = self.client.options(
            "/v1/auth/login",
            headers={**self.origin, "Access-Control-Request-Method": "POST"},
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers["Access-Control-Allow-Origin"], self.settings.allowed_origin)
        self.assertEqual(response.headers["Access-Control-Allow-Credentials"], "true")
        self.assertIn("X-CSRF-Token", response.headers["Access-Control-Allow-Headers"])
        response = self.client.get("/v1/auth/status", headers={"Origin": "https://untrusted.example"})
        self.assertNotIn("Access-Control-Allow-Origin", response.headers)
        self.assertEqual(self.post("/v1/auth/login", "invalid").status_code, 403)

    def test_production_manager_provisioning(self):
        self.app = create_app(replace(self.settings, allow_manager_setup=False))
        self.client = self.app.test_client()
        status = self.status().json
        self.assertFalse(status["setup_required"])
        credentials = {"email": "manager@example.com", "password": "test-password-123"}
        response = self.post("/v1/auth/setup", status["csrf_token"], credentials)
        self.assertEqual(response.status_code, 403)
        runner = self.app.test_cli_runner()
        result = runner.invoke(
            args=["create-manager"],
            input="manager@example.com\ntest-password-123\ntest-password-123\n",
        )
        self.assertEqual(result.exit_code, 0, result.output)
        result = runner.invoke(
            args=["create-manager"],
            input="other@example.com\ntest-password-123\ntest-password-123\n",
        )
        self.assertNotEqual(result.exit_code, 0)
        response = self.post("/v1/auth/login", self.status().json["csrf_token"], credentials)
        self.assertEqual(response.status_code, 200)

    @patch("member_portfolio_service.TradingClient")
    def test_linked_and_default_portfolio_streams(self, trading_client):
        trading_client.return_value.get_account.return_value = SimpleNamespace(equity="100")
        trading_client.return_value.get_all_positions.return_value = []
        trading_client.return_value.get_orders.return_value = []
        token = self.status().json["csrf_token"]
        self.post(
            "/v1/auth/setup", token,
            {"email": "manager@example.com", "password": "test-password-123"},
        )
        token = self.status().json["csrf_token"]
        response = self.post(
            "/v1/portfolios", token,
            {"label": "Paper", "api_key": "test-key", "api_secret": "test-secret"},
        )
        self.assertEqual(response.status_code, 201)
        portfolio_id = response.json["portfolio"]["id"]
        self.assertEqual(len(self.client.get("/v1/portfolios").json["portfolios"]), 1)
        stream = self.client.get(f"/v1/portfolios/{portfolio_id}/stream", buffered=False)
        try:
            self.assertEqual(stream.mimetype, "text/event-stream")
            snapshot = json.loads(next(stream.response).decode().removeprefix("data: "))
            self.assertEqual(snapshot["account"]["equity"], "100")
        finally:
            stream.close()
        trading_client.assert_called_with("test-key", "test-secret", paper=True)
        anonymous = self.app.test_client()
        self.assertEqual(anonymous.get(f"/v1/portfolios/{portfolio_id}/stream").status_code, 401)
        with patch.dict(os.environ, {"ALPACA_API_KEY": "default-key", "ALPACA_API_SECRET": "default-secret"}):
            stream = anonymous.get("/v1/dashboard/stream", buffered=False)
            try:
                self.assertEqual(stream.status_code, 200)
                self.assertIn(b'"equity":"100"', next(stream.response))
            finally:
                stream.close()
        trading_client.assert_called_with("default-key", "default-secret", paper=True)


if __name__ == "__main__":
    unittest.main()