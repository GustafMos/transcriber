#!/usr/bin/env python3
"""Serve the Transcriber web UI on http://127.0.0.1:8000 and proxy /ollama/*
to a local Ollama server (127.0.0.1:11434).

Serving over localhost (rather than file://) is required so the browser allows
microphone access. Run this from anywhere; it serves the repo root.
"""
import http.server
import json
import os
import socketserver
import urllib.error
import urllib.request

PORT = 8000
OLLAMA = "http://127.0.0.1:11434"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # repo root


def proxy_ollama(handler):
    """Forward a /ollama/* request to the local Ollama server."""
    target = OLLAMA + handler.path[len("/ollama"):]
    length = int(handler.headers.get("Content-Length") or 0)
    body = handler.rfile.read(length) if length else None

    req = urllib.request.Request(target, data=body, method=handler.command)
    req.add_header("Content-Type", handler.headers.get("Content-Type", "application/json"))

    def _write(status, data, ctype):
        handler.send_response(status)
        handler.send_header("Content-Type", ctype)
        handler.send_header("Content-Length", str(len(data)))
        handler.end_headers()
        handler.wfile.write(data)

    try:
        with urllib.request.urlopen(req, timeout=300) as resp:
            _write(resp.status, resp.read(),
                   resp.headers.get("Content-Type", "application/json"))
    except urllib.error.HTTPError as e:
        _write(e.code, e.read(), "application/json")
    except Exception:
        _write(502, json.dumps({"error": "Ollama is not running"}).encode(),
               "application/json")


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, fmt, *args):
        pass  # keep the console quiet

    def do_GET(self):
        if self.path.startswith("/ollama"):
            proxy_ollama(self)
        else:
            super().do_GET()

    def do_POST(self):
        if self.path.startswith("/ollama"):
            proxy_ollama(self)
        else:
            super().do_POST()


if __name__ == "__main__":
    with socketserver.TCPServer(("127.0.0.1", PORT), Handler) as httpd:
        print(f"Transcriber UI -> http://127.0.0.1:{PORT}")
        print("Press Ctrl+C to stop.")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            pass
