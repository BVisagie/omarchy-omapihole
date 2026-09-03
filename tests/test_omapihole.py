#!/usr/bin/env python3
"""Helper contract tests: fixtures, pause payload, 401 once, 429, totp, mode."""

from __future__ import annotations

import importlib.machinery
import importlib.util
import io
import json
import os
import stat
import tempfile
import unittest
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
FIXTURES = Path(__file__).resolve().parent / "fixtures"


def load_helper():
    path = ROOT / "scripts" / "omapihole"
    loader = importlib.machinery.SourceFileLoader("omapihole", str(path))
    spec = importlib.util.spec_from_loader("omapihole", loader)
    mod = importlib.util.module_from_spec(spec)
    loader.exec_module(mod)
    return mod


def fixture(name):
    return json.loads((FIXTURES / name).read_text(encoding="utf-8"))


class FakeHttp:
    def __init__(self, script):
        self.script = list(script)
        self.calls = []

    def __call__(self, method, url, headers, body, insecure):
        self.calls.append(
            {
                "method": method,
                "url": url,
                "headers": dict(headers),
                "body": body,
                "insecure": insecure,
            }
        )
        if not self.script:
            raise AssertionError("unexpected request %s %s" % (method, url))
        step = self.script.pop(0)
        expect = step.get("expect")
        if expect:
            if "method" in expect:
                assert method == expect["method"], (method, expect["method"])
            if "path" in expect:
                assert url.endswith(expect["path"]), url
            if "body" in expect:
                got = body if not isinstance(body, str) else json.loads(body)
                assert got == expect["body"], got
            if "has_sid" in expect:
                has = "X-FTL-SID" in headers
                assert has is expect["has_sid"], headers
            if "no_password" in expect and expect["no_password"] and body:
                payload = body if not isinstance(body, str) else json.loads(body)
                assert "password" not in payload
        if step.get("error"):
            return None, "", step["error"]
        body_obj = step.get("json")
        text = "" if body_obj is None else json.dumps(body_obj)
        return step.get("status", 200), text, None

    def path_calls(self):
        return [(c["method"], c["url"].split("://", 1)[-1].split("/", 1)[-1] if "://" in c["url"] else c["url"]) for c in self.calls]

    def bodies(self):
        out = []
        for call in self.calls:
            body = call["body"]
            if body is None:
                out.append(None)
            elif isinstance(body, str):
                out.append(json.loads(body))
            else:
                out.append(body)
        return out


class HelperTests(unittest.TestCase):
    def setUp(self):
        self.mod = load_helper()
        self.tmpdir = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmpdir.cleanup)
        self.state = Path(self.tmpdir.name) / "state"
        self.state.mkdir()
        self.password_path = Path(self.tmpdir.name) / "password"
        self.env = {
            "HOME": self.tmpdir.name,
            "XDG_STATE_HOME": str(self.state),
            "OMAPIHOLE_URL": "http://pi.hole",
            "OMAPIHOLE_PASSWORD_FILE": str(self.password_path),
            "OMAPIHOLE_ALLOW_INSECURE": "0",
        }

    def write_password(self, text="secret", mode=0o600):
        self.password_path.write_text(text + "\n", encoding="utf-8")
        os.chmod(self.password_path, mode)

    def run_cmd(self, *argv, http=None):
        if http is not None:
            self.mod.http_exchange = http
        buf = io.StringIO()
        with mock.patch("sys.stdout", buf):
            code = self.mod.run(["omapihole", *argv], self.env)
        self.assertEqual(code, 0)
        return json.loads(buf.getvalue())

    def test_unconfigured_empty_url(self):
        self.env["OMAPIHOLE_URL"] = ""
        result = self.run_cmd("status", "--bar")
        self.assertEqual(result["state"], "unconfigured")
        self.assertFalse(result["ok"])

    def test_passwordless_missing_file(self):
        http = FakeHttp(
            [
                {"status": 200, "json": fixture("auth_valid_passwordless.json")},
                {"status": 200, "json": fixture("summary.json")},
                {"status": 200, "json": fixture("blocking_enabled.json")},
            ]
        )
        result = self.run_cmd("status", "--bar", http=http)
        self.assertTrue(result["ok"])
        self.assertEqual(result["state"], "enabled")
        self.assertEqual(result["queries"]["total"], 48213)
        self.assertIsNone(result["history"])
        self.assertEqual(result["recent_blocked"], [])
        self.assertFalse(any(c["method"] == "POST" for c in http.calls))

    def test_maps_paused_and_failed_blocking(self):
        self.write_password()
        login = fixture("auth_login_ok.json")
        http = FakeHttp(
            [
                {"status": 401, "json": fixture("auth_required.json")},
                {"status": 200, "json": login},
                {"status": 200, "json": fixture("summary.json")},
                {"status": 200, "json": fixture("blocking_paused.json")},
            ]
        )
        result = self.run_cmd("status", "--bar", http=http)
        self.assertEqual(result["state"], "paused")
        self.assertEqual(result["timer"], 272)
        self.assertFalse(result["blocking"])

        http2 = FakeHttp(
            [
                {"status": 200, "json": fixture("summary.json")},
                {"status": 200, "json": fixture("blocking_failed.json")},
            ]
        )
        self.mod.http_exchange = http2
        # leftover session from previous login
        failed = self.run_cmd("status", "--bar")
        self.assertEqual(failed["state"], "failed")
        self.assertFalse(failed["ok"])

    def test_full_status_fetches_history(self):
        http = FakeHttp(
            [
                {"status": 200, "json": fixture("auth_valid_passwordless.json")},
                {"status": 200, "json": fixture("summary.json")},
                {"status": 200, "json": fixture("blocking_enabled.json")},
                {"status": 200, "json": fixture("history.json")},
                {"status": 200, "json": fixture("recent_blocked.json")},
            ]
        )
        result = self.run_cmd("status", http=http)
        self.assertEqual(result["state"], "enabled")
        self.assertEqual(len(result["history"]), 6)
        self.assertEqual(result["history"][0]["t"], 1770000000)
        self.assertEqual(result["recent_blocked"][0], "tracker.example.com")

    def test_ping_fails_when_blocking_endpoint_is_unavailable(self):
        http = FakeHttp(
            [
                {"status": 200, "json": fixture("auth_valid_passwordless.json")},
                {"status": 200, "json": fixture("summary.json")},
                {"status": 500, "json": {"error": {"message": "blocking unavailable"}}},
            ]
        )
        result = self.run_cmd("ping", http=http)
        self.assertFalse(result["ok"])
        self.assertEqual(result["state"], "failed")
        self.assertEqual(result["error"], "blocking unavailable")

    def test_pause_payload_and_bar_shape(self):
        self.write_password()
        http = FakeHttp(
            [
                {"status": 401, "json": fixture("auth_required.json")},
                {"status": 200, "json": fixture("auth_login_ok.json")},
                {
                    "status": 200,
                    "json": fixture("blocking_paused.json"),
                    "expect": {
                        "method": "POST",
                        "path": "/api/dns/blocking",
                        "body": {"blocking": False, "timer": 30},
                    },
                },
                {"status": 200, "json": fixture("summary.json")},
                {"status": 200, "json": fixture("blocking_paused.json")},
            ]
        )
        result = self.run_cmd("pause", "30", http=http)
        self.assertEqual(result["state"], "paused")
        self.assertIsNone(result["history"])
        posts = [c for c in http.calls if c["method"] == "POST"]
        self.assertEqual(len(posts), 2)  # login + pause
        pause_body = posts[1]["body"]
        if isinstance(pause_body, str):
            pause_body = json.loads(pause_body)
        self.assertEqual(pause_body, {"blocking": False, "timer": 30})

    def test_resume_payload(self):
        self.write_password()
        http = FakeHttp(
            [
                {"status": 401, "json": fixture("auth_required.json")},
                {"status": 200, "json": fixture("auth_login_ok.json")},
                {
                    "status": 200,
                    "json": fixture("blocking_enabled.json"),
                    "expect": {"body": {"blocking": True, "timer": None}},
                },
                {"status": 200, "json": fixture("summary.json")},
                {"status": 200, "json": fixture("blocking_enabled.json")},
            ]
        )
        result = self.run_cmd("resume", http=http)
        self.assertEqual(result["state"], "enabled")
        self.assertTrue(result["blocking"])

    def test_401_reauth_once_then_retry(self):
        self.write_password()
        sid_path = self.state / "omapihole" / "session"
        sid_path.parent.mkdir(parents=True, exist_ok=True)
        sid_path.write_text("stale-sid\n", encoding="utf-8")
        os.chmod(sid_path, 0o600)
        http = FakeHttp(
            [
                {"status": 401, "json": fixture("auth_401_stale_sid.json")},
                {"status": 401, "json": fixture("auth_required.json")},
                {"status": 200, "json": fixture("auth_login_ok.json")},
                {"status": 200, "json": fixture("summary.json")},
                {"status": 200, "json": fixture("blocking_enabled.json")},
            ]
        )
        result = self.run_cmd("status", "--bar", http=http)
        self.assertEqual(result["state"], "enabled")
        summary_gets = [
            c for c in http.calls if c["method"] == "GET" and c["url"].endswith("/api/stats/summary")
        ]
        self.assertEqual(len(summary_gets), 2)
        self.assertEqual(summary_gets[0]["headers"].get("X-FTL-SID"), "stale-sid")
        self.assertEqual(
            summary_gets[1]["headers"].get("X-FTL-SID"),
            "vFA+EP4MQ5JJvJg+3Q2Jnw=",
        )

    def test_401_retry_exhausted_is_auth(self):
        self.write_password()
        sid_path = self.state / "omapihole" / "session"
        sid_path.parent.mkdir(parents=True, exist_ok=True)
        sid_path.write_text("stale-sid\n", encoding="utf-8")
        http = FakeHttp(
            [
                {"status": 401, "json": fixture("auth_401_stale_sid.json")},
                {"status": 401, "json": fixture("auth_required.json")},
                {"status": 200, "json": fixture("auth_login_ok.json")},
                {"status": 401, "json": fixture("auth_401_stale_sid.json")},
            ]
        )
        result = self.run_cmd("status", "--bar", http=http)
        self.assertEqual(result["state"], "auth")
        self.assertFalse(result["ok"])

    def test_429_seats_no_reauth(self):
        self.write_password()
        sid_path = self.state / "omapihole" / "session"
        sid_path.parent.mkdir(parents=True, exist_ok=True)
        sid_path.write_text("live-sid\n", encoding="utf-8")
        http = FakeHttp(
            [
                {"status": 429, "json": fixture("auth_429_seats.json")},
            ]
        )
        result = self.run_cmd("status", "--bar", http=http)
        self.assertEqual(result["state"], "auth")
        self.assertEqual(result["error"], "increase webserver.api.max_sessions")
        self.assertEqual(len(http.calls), 1)
        self.assertFalse(any(c["method"] == "POST" for c in http.calls))

    def test_429_rate_limit_on_login(self):
        self.write_password()
        http = FakeHttp(
            [
                {"status": 401, "json": fixture("auth_required.json")},
                {"status": 429, "json": fixture("auth_429_rate_limit.json")},
            ]
        )
        result = self.run_cmd("ping", http=http)
        self.assertEqual(result["state"], "auth")
        self.assertEqual(result["error"], "Rate-limiting login attempts")

    def test_totp_web_password_uses_app_password_copy(self):
        self.write_password("web-password")
        http = FakeHttp(
            [
                {"status": 401, "json": fixture("auth_required_2fa.json")},
                {"status": 400, "json": fixture("auth_totp_missing.json")},
            ]
        )
        result = self.run_cmd("status", "--bar", http=http)
        self.assertEqual(result["state"], "auth")
        self.assertIn("app password", result["error"])
        posts = [c for c in http.calls if c["method"] == "POST"]
        self.assertEqual(len(posts), 1)
        body = posts[0]["body"]
        if isinstance(body, str):
            body = json.loads(body)
        self.assertEqual(body, {"password": "web-password"})
        self.assertNotIn("totp", body)

    def test_totp_plus_app_password_succeeds(self):
        self.write_password("app-password")
        login = fixture("auth_login_ok.json")
        login["session"]["totp"] = True
        http = FakeHttp(
            [
                {"status": 401, "json": fixture("auth_required_2fa.json")},
                {"status": 200, "json": login},
                {"status": 200, "json": fixture("summary.json")},
                {"status": 200, "json": fixture("blocking_enabled.json")},
            ]
        )
        result = self.run_cmd("status", "--bar", http=http)
        self.assertEqual(result["state"], "enabled")

    def test_password_rejected_when_2fa_off(self):
        self.write_password("wrong")
        http = FakeHttp(
            [
                {"status": 401, "json": fixture("auth_required.json")},
                {"status": 401, "json": fixture("auth_401_stale_sid.json")},
            ]
        )
        result = self.run_cmd("status", "--bar", http=http)
        self.assertEqual(result["state"], "auth")
        self.assertEqual(result["error"], "password rejected")

    def test_world_readable_file_never_sends_password(self):
        self.write_password("leaked", mode=0o644)
        http = FakeHttp([])
        result = self.run_cmd("status", "--bar", http=http)
        self.assertEqual(result["state"], "auth")
        self.assertIn("chmod 600", result["error"])
        self.assertEqual(http.calls, [])

    def test_symlinked_password_file_is_rejected(self):
        target = Path(self.tmpdir.name) / "real-password"
        target.write_text("leaked\n", encoding="utf-8")
        os.chmod(target, 0o600)
        self.password_path.symlink_to(target)
        http = FakeHttp([])
        result = self.run_cmd("status", "--bar", http=http)
        self.assertEqual(result["state"], "auth")
        self.assertIn("cannot read password file", result["error"])
        self.assertEqual(http.calls, [])

    def test_oversized_password_file_is_rejected(self):
        self.write_password("x" * (self.mod.MAX_SECRET_BYTES + 1))
        http = FakeHttp([])
        result = self.run_cmd("status", "--bar", http=http)
        self.assertEqual(result["state"], "auth")
        self.assertIn("cannot read password file", result["error"])
        self.assertEqual(http.calls, [])

    def test_missing_file_when_password_required(self):
        http = FakeHttp(
            [
                {"status": 401, "json": fixture("auth_required.json")},
            ]
        )
        result = self.run_cmd("status", "--bar", http=http)
        self.assertEqual(result["state"], "auth")
        self.assertTrue(result["error"].startswith("no password file at "))

    def test_offline_timeout(self):
        http = FakeHttp([{"error": "connection timed out"}])
        result = self.run_cmd("status", "--bar", http=http)
        self.assertEqual(result["state"], "offline")
        self.assertEqual(result["error"], "connection timed out")

    def test_allow_insecure_flag_reaches_http(self):
        self.env["OMAPIHOLE_ALLOW_INSECURE"] = "1"
        http = FakeHttp(
            [
                {"status": 200, "json": fixture("auth_valid_passwordless.json")},
                {"status": 200, "json": fixture("summary.json")},
                {"status": 200, "json": fixture("blocking_enabled.json")},
            ]
        )
        self.run_cmd("status", "--bar", http=http)
        self.assertTrue(all(c["insecure"] for c in http.calls))

    def test_usage_error_nonzero(self):
        buf = io.StringIO()
        with mock.patch("sys.stderr", buf):
            with self.assertRaises(SystemExit) as raised:
                self.mod.dispatch(["omapihole", "pause"], self.env)
        self.assertEqual(raised.exception.code, 2)


if __name__ == "__main__":
    unittest.main()
