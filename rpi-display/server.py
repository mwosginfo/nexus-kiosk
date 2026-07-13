#!/usr/bin/env python3
"""Nexus RPi Queue Display — local static server.

Serves the wrapper page and exposes the Pi's Nexus URL config to the browser
at /nexus-url.json. Chromium points at http://localhost:8080/ in kiosk mode.

The operator sets nexusUrl once by editing /opt/rpi-display/config.json:

    { "nexusUrl": "http://nexus.local:3000" }

Every other setting (mode, online URL, refresh interval) is controlled from
the Nexus admin page and polled by app.js — nothing else changes on the Pi.
"""

from __future__ import annotations

import json
import os
import sys
from http.server import HTTPServer, SimpleHTTPRequestHandler
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
PUBLIC_DIR = BASE_DIR / "public"
CONFIG_PATH = Path(os.environ.get("RPI_DISPLAY_CONFIG", "/opt/rpi-display/config.json"))
BIND_HOST = os.environ.get("RPI_DISPLAY_HOST", "127.0.0.1")
BIND_PORT = int(os.environ.get("RPI_DISPLAY_PORT", "8080"))


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(PUBLIC_DIR), **kwargs)

    def do_GET(self) -> None:  # noqa: N802 — stdlib API
        if self.path.startswith("/nexus-url.json"):
            self._send_json(self._read_config())
            return
        super().do_GET()

    def _read_config(self) -> dict:
        try:
            with CONFIG_PATH.open("r", encoding="utf-8") as fh:
                data = json.load(fh)
        except FileNotFoundError:
            return {"nexusUrl": ""}
        except json.JSONDecodeError:
            return {"nexusUrl": "", "error": "invalid JSON"}
        url = str(data.get("nexusUrl", "")).strip()
        return {"nexusUrl": url}

    def _send_json(self, obj: dict) -> None:
        body = json.dumps(obj).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format: str, *args) -> None:  # noqa: A002
        # Systemd captures stderr; keep it terse.
        sys.stderr.write("[rpi-display] " + (format % args) + "\n")


def main() -> None:
    if not PUBLIC_DIR.is_dir():
        sys.stderr.write(f"public/ not found at {PUBLIC_DIR}\n")
        sys.exit(1)
    server = HTTPServer((BIND_HOST, BIND_PORT), Handler)
    sys.stderr.write(f"[rpi-display] serving {PUBLIC_DIR} on http://{BIND_HOST}:{BIND_PORT}\n")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        server.server_close()


if __name__ == "__main__":
    main()
