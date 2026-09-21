"""Stdlib tests for the local Jev assistance server."""
from functools import partial
from http.client import HTTPConnection
import json
import os
from pathlib import Path
import sys
from threading import Lock, Thread
import unittest
from unittest.mock import patch


SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

import jev_server  # noqa: E402


TEST_KEY = "test-key-placeholder"
TEXT = "税后每月八千，想买三千元的相机。"


class AmountTests(unittest.TestCase):
    def test_supported_chinese_arabic_comma_and_myriad_amounts(self):
        cases = {
            "八千": "8000.00",
            "12345": "12345.00",
            "12,345.67": "12345.67",
            "1.2万": "12000.00",
            "一万二千三百": "12300.00",
            "100万": "1000000.00",
        }
        for span, expected in cases.items():
            with self.subTest(span=span):
                self.assertEqual(jev_server.amount(span), expected)

    def test_candidate_extraction_does_not_drop_signs_or_decimal_parts(self):
        from jev_experiment import prepare
        for text, span in (("月收入负八千元", "负八千"), ("价格-300元", "-300"), ("价格.5元", ".5"), ("价格八点五元", "八点五")):
            state, _, _ = prepare(text)
            self.assertEqual(state["number_candidates"][0]["span"], span)
            self.assertIsNone(jev_server.amount(span))
        state, _, _ = prepare("价格1e4元")
        self.assertEqual(state["number_candidates"], [])

    def test_amount_limits_and_ambiguous_shorthand(self):
        for span in ("0", "-0.01", "1.001", "一万二"):
            with self.subTest(span=span):
                self.assertIsNone(jev_server.amount(span))
        self.assertEqual(jev_server.amount("999999999999999.99"), "999999999999999.99")
        self.assertIsNone(jev_server.amount("1000000000000000"))


class FieldTests(unittest.TestCase):
    def test_missing_stays_empty_estimated_is_preserved_and_tax_is_mapped(self):
        actual = {
            "monthly_income": {"status": "estimated", "span": "八千"},
            "income_basis": {"status": "present", "span": "税后", "value": "post-tax"},
            "purchase_price": {"status": "missing"},
        }

        result = jev_server.fields_from_answers(actual)["fields"]

        self.assertEqual(result["income"], {
            "value": "8000.00",
            "span": "八千",
            "status": "estimated",
        })
        self.assertEqual(result["taxBasis"], {
            "value": "after-tax",
            "span": "税后",
            "status": "present",
        })
        self.assertEqual(result["purchaseAmount"], {
            "value": None,
            "span": None,
            "status": "missing",
        })

    def test_both_tax_values_map_to_form_values(self):
        for source, expected in (("pre-tax", "before-tax"), ("post-tax", "after-tax")):
            with self.subTest(source=source):
                actual = {
                    "monthly_income": {"status": "missing"},
                    "income_basis": {"status": "present", "span": source, "value": source},
                    "purchase_price": {"status": "missing"},
                }
                self.assertEqual(
                    jev_server.fields_from_answers(actual)["fields"]["taxBasis"]["value"],
                    expected,
                )


class HttpTests(unittest.TestCase):
    def setUp(self):
        self.server = jev_server.Server(
            ("127.0.0.1", 0),
            partial(jev_server.Handler, directory=str(jev_server.ROOT)),
        )
        self.thread = Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.host = f"127.0.0.1:{self.server.server_port}"
        self.hosts_patch = patch.object(jev_server, "HOSTS", {self.host})
        self.hosts_patch.start()
        self.addCleanup(self.hosts_patch.stop)
        self.addCleanup(self._stop_server)

    def _stop_server(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)

    def post(self, body, *, host=None, origin=None, content_type="application/json"):
        request_host = host or self.host
        headers = {"Host": request_host, "Content-Type": content_type}
        if origin is not None:
            headers["Origin"] = origin
        connection = HTTPConnection("127.0.0.1", self.server.server_port, timeout=2)
        try:
            connection.request("POST", "/api/assist", body=body, headers=headers)
            response = connection.getresponse()
            return response.status, response.read()
        finally:
            connection.close()

    def test_rejected_requests_do_not_call_assist(self):
        valid_body = json.dumps({"text": TEXT}, ensure_ascii=False).encode()
        with patch.dict(os.environ, {"TYPESAFE_API_KEY": TEST_KEY}), patch.object(jev_server, "assist") as assist:
            status, _ = self.post(valid_body, origin="http://bad.example")
            self.assertEqual(status, 403)

            status, _ = self.post(valid_body, host="evil.example", origin=f"http://{self.host}")
            self.assertEqual(status, 403)

            status, _ = self.post(b'{"text":', origin=f"http://{self.host}")
            self.assertEqual(status, 400)

            status, _ = self.post(b"x" * 8193, origin=f"http://{self.host}")
            self.assertEqual(status, 400)

            status, _ = self.post(
                json.dumps({"text": TEXT, "extra": "rejected"}, ensure_ascii=False).encode(),
                origin=f"http://{self.host}",
            )
            self.assertEqual(status, 400)
            assist.assert_not_called()

        with patch.dict(os.environ, {}, clear=True), patch.object(jev_server, "assist") as assist:
            status, body = self.post(valid_body, origin=f"http://{self.host}")
            self.assertEqual(status, 503)
            self.assertEqual(json.loads(body), {"error": "unavailable"})
            assist.assert_not_called()

    def test_valid_request_passes_only_text_and_returns_json(self):
        response_data = {"fields": {"income": {"value": "8000.00"}}}
        body = json.dumps({"text": TEXT}, ensure_ascii=False).encode()
        with patch.dict(os.environ, {"TYPESAFE_API_KEY": TEST_KEY}), patch.object(
            jev_server, "assist", return_value=response_data
        ) as assist:
            status, response_body = self.post(body, origin=f"http://{self.host}")

        self.assertEqual(status, 200)
        self.assertEqual(json.loads(response_body), response_data)
        assist.assert_called_once_with(TEXT)

    def test_service_error_returns_generic_502_without_exception_text(self):
        body = json.dumps({"text": TEXT}, ensure_ascii=False).encode()
        with patch.dict(os.environ, {"TYPESAFE_API_KEY": TEST_KEY}), patch.object(
            jev_server, "assist", side_effect=RuntimeError("secret-error-body")
        ):
            status, response_body = self.post(body, origin=f"http://{self.host}")

        self.assertEqual(status, 502)
        self.assertEqual(json.loads(response_body), {"error": "service_failed"})
        self.assertNotIn(b"secret-error-body", response_body)

    def test_busy_server_rejects_without_calling_assist(self):
        body = json.dumps({"text": TEXT}, ensure_ascii=False).encode()
        busy = Lock()
        self.assertTrue(busy.acquire(blocking=False))
        try:
            with patch.dict(os.environ, {"TYPESAFE_API_KEY": TEST_KEY}), patch.object(jev_server, "BUSY", busy), patch.object(
                jev_server, "assist"
            ) as assist:
                status, response_body = self.post(body, origin=f"http://{self.host}")
        finally:
            busy.release()

        self.assertEqual(status, 429)
        self.assertEqual(json.loads(response_body), {"error": "busy"})
        assist.assert_not_called()


if __name__ == "__main__":
    unittest.main()
