"""Local-only same-origin Jev assistance and dist server; no request-body logs."""
from decimal import Decimal, InvalidOperation
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
import logging
import os
from pathlib import Path
import re
from threading import Lock
from urllib.parse import urlsplit

from typesafe_sdk import RetryPolicy, TypeSafeClient
from jev_experiment import prepare, decode

ROOT = Path(__file__).resolve().parents[1] / "dist"
HOSTS = {"127.0.0.1:4173", "localhost:4173", "127.0.0.1:4174", "localhost:4174"}
BUSY = Lock()
DIGITS = {c: i for i, c in enumerate("零一二三四五六七八九") } | {"两": 2, "〇": 0}
UNITS = {"十": 10, "百": 100, "千": 1000, "万": 10000}


def amount(span):
    """Exact conversion of supported spans; shorthand or malformed input stays empty."""
    if not isinstance(span, str) or len(span) > 50:
        return None
    try:
        if re.fullmatch(r"(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?[万千百]?", span):
            multiplier = {"万": 10000, "千": 1000, "百": 100}.get(span[-1], 1)
            number = span[:-1] if multiplier != 1 else span
            value = Decimal(number.replace(",", "")) * multiplier
        elif re.fullmatch(r"(?:\d+[万千百])+", span):
            parts = re.findall(r"(\d+)([万千百])", span)
            powers = [UNITS[unit] for _, unit in parts]
            if any(a <= b for a, b in zip(powers, powers[1:])):
                return None
            value = Decimal(sum(int(n) * UNITS[u] for n, u in parts))
        elif re.fullmatch(r"[零〇一二两三四五六七八九十百千万]+", span):
            total = section = digit = 0
            last_unit = 100000
            prev_digit = False
            zero = False
            for char in span:
                if char in DIGITS:
                    if prev_digit and not zero:
                        return None
                    digit = DIGITS[char]
                    zero = digit == 0
                    prev_digit = True
                else:
                    unit = UNITS[char]
                    if unit == 10000:
                        if total or not section and not digit:
                            return None
                        total = (section + digit) * unit
                        section = 0
                        last_unit = 10000
                    else:
                        if unit >= last_unit or not digit and not (char == "十" and not section and not total):
                            return None
                        section += (digit or 1) * unit
                        last_unit = unit
                    digit = 0
                    prev_digit = False
                    zero = False
            # 一千五/一万二 can mean multiple values; require explicit units or 零.
            if digit and last_unit > 10 and any(c in UNITS for c in span) and "零" not in span[-2:] and "〇" not in span[-2:]:
                return None
            value = Decimal(total + section + digit)
        else:
            return None
        cents = value * 100
        if not value.is_finite() or cents != cents.to_integral_value() or not 0 < cents <= 99999999999999999:
            return None
        return format(value.quantize(Decimal("0.01")), "f")
    except (InvalidOperation, ValueError):
        return None


def fields_from_answers(actual):
    fields = {}
    for key, source in (("income", "monthly_income"), ("taxBasis", "income_basis"), ("purchaseAmount", "purchase_price")):
        item = actual[source]
        status = item["status"]
        span = item.get("span")
        value = None
        if status in ("present", "estimated"):
            value = {"pre-tax": "before-tax", "post-tax": "after-tax"}.get(item.get("value")) if key == "taxBasis" else amount(span)
            if value is None:
                status = "unsupported"
        fields[key] = dict(value=value, span=span, status=status)
    return {"fields": fields}


def assist(text):
    state, maps, questions = prepare(text)
    with TypeSafeClient(api_key=os.environ["TYPESAFE_API_KEY"], model="jev-1.13.0",
                        base_url="https://api.typesafe.ai/", timeout=30,
                        retry=RetryPolicy(max_retries=0)) as client:
        response = client.system_one(state=state, questions=questions)
    return fields_from_answers(decode(response.choices, maps))


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
            if not isinstance(payload, dict) or set(payload) != {"text"} or not isinstance(payload["text"], str):
                raise ValueError()
            prepare(payload["text"])
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
            self.reply(200, assist(payload["text"]))
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
    Server(("127.0.0.1", 4174), partial(Handler, directory=str(ROOT))).serve_forever()
