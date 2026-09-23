"""Local-only same-origin Jev assistance and dist server; no request-body logs."""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
import logging
import os
from pathlib import Path
from threading import Lock
from urllib.parse import urlsplit

from jev_conversation import amount, assist as assist_conversation, validate_request

ROOT = Path(__file__).resolve().parents[1] / "dist"
HOSTS = {"127.0.0.1:4173", "localhost:4173", "127.0.0.1:4174", "localhost:4174"}
BUSY = Lock()
def assist(text, question_id=None, context=None):
    return assist_conversation(text, question_id, context)


class Handler(SimpleHTTPRequestHandler):
    def log_message(self, *_):
        pass

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Content-Security-Policy", "default-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'")
        super().end_headers()

    def reply(self, code, data):
        body = json.dumps(data, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.headers.get("Host") not in HOSTS:
            self.reply(403, {"error": "forbidden"})
            return
        path = urlsplit(self.path).path
        target = (ROOT / path.lstrip("/")).resolve() if path != "/" else ROOT / "index.html"
        if not target.is_relative_to(ROOT) or not target.is_file() or not (path in ("/", "/index.html") or path.startswith("/assets/")):
            self.reply(404, {"error": "not_found"})
            return
        super().do_GET()

    def do_HEAD(self):
        self.reply(405, {"error": "method_not_allowed"})

    def do_POST(self):
        if self.path != "/api/assist":
            self.reply(404, {"error": "not_found"})
            return
        host = self.headers.get("Host")
        if host not in HOSTS or self.headers.get("Origin") != f"http://{host}":
            self.reply(403, {"error": "forbidden"})
            return
        if self.headers.get("Content-Type", "").split(";")[0].strip() != "application/json" or self.headers.get("Transfer-Encoding"):
            self.reply(415, {"error": "json_required"})
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if not 0 < length <= 8192:
                raise ValueError()
            self.connection.settimeout(5)
            payload = json.loads(self.rfile.read(length))
            if not isinstance(payload, dict) or set(payload) != {"text", "questionId", "context"}:
                raise ValueError()
            context = validate_request(payload["text"], payload["questionId"], payload["context"])
        except (ValueError, UnicodeError, TimeoutError, RecursionError):
            self.reply(400, {"error": "invalid_input"})
            return
        if not os.environ.get("TYPESAFE_API_KEY", "").strip():
            self.reply(503, {"error": "unavailable"})
            return
        # ponytail: one in-flight call for this local-only tool; authenticate and rate-limit before multiuser hosting.
        if not BUSY.acquire(blocking=False):
            self.reply(429, {"error": "busy"})
            return
        try:
            self.reply(200, assist(payload["text"], payload["questionId"], context))
        except Exception:
            self.reply(502, {"error": "service_failed"})
        finally:
            BUSY.release()


class Server(ThreadingHTTPServer):
    def handle_error(self, request, client_address):
        pass  # No traceback or request data in server logs.


if __name__ == "__main__":
    logging.getLogger("typesafe_sdk").disabled = True
    print("Local Zhiguan: http://127.0.0.1:4174 (Ctrl-C to stop)", flush=True)
    Server((os.environ.get("ZHIGUAN_BIND_HOST", "127.0.0.1"), 4174), partial(Handler, directory=str(ROOT))).serve_forever()
