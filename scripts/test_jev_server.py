"""Stdlib tests for the local Jev assistance server."""
from functools import partial
from http.client import HTTPConnection
import json
import os
from pathlib import Path
import sys
from threading import Lock, Thread
from types import SimpleNamespace
import unittest
from unittest.mock import patch


SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

import jev_server  # noqa: E402
import jev_conversation  # noqa: E402


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
        self.assertEqual(jev_server.amount("0", allow_zero=True), "0.00")
        self.assertEqual(jev_server.amount("999999999999999.99"), "999999999999999.99")
        self.assertIsNone(jev_server.amount("1000000000000000"))


class ConversationTests(unittest.TestCase):
    def _answers(self, maps, selected):
        answers = {field: SimpleNamespace(choice="missing") for field in jev_conversation.FIELD_KEYS}
        for field, (span, status) in selected.items():
            answers[field].choice = next(
                key for key, item in maps[field].items()
                if item.get("span") == span and item["status"] == status
            )
        return answers

    def test_decodes_only_current_source_candidates_and_independent_fields(self):
        text = "税后月入大约8000元，想买3000元相机，每周5天、每天7.5小时。"
        _, maps, _ = jev_conversation.prepare(text)
        answers = self._answers(maps, {
            "income": ("8000", "estimated"),
            "taxBasis": ("税后", "present"),
            "purchaseAmount": ("3000", "present"),
            "workTimeMode": ("每周", "present"),
            "workDaysPerWeek": ("5", "present"),
            "workHoursPerDay": ("7.5", "estimated"),
        })

        fields = jev_conversation.decode(answers, maps)["fields"]

        self.assertEqual(fields["income"], {"value": "8000.00", "span": "8000", "status": "estimated"})
        self.assertEqual(fields["taxBasis"], {"value": "after-tax", "span": "税后", "status": "present"})
        self.assertEqual(fields["purchaseAmount"], {"value": "3000.00", "span": "3000", "status": "present"})
        self.assertEqual(fields["workDaysPerWeek"], {"value": "5", "span": "5", "status": "present"})
        self.assertEqual(fields["workHoursPerDay"], {"value": "7.5", "span": "7.5", "status": "estimated"})
        self.assertEqual(fields["workHours"], {"value": None, "span": None, "status": "missing"})
        self.assertTrue(all(item["span"] is None or item["span"] in text for item in fields.values()))

    def test_double_weekend_does_not_supply_daily_hours(self):
        _, maps, _ = jev_conversation.prepare("平时双休。")

        day_options = [item for item in maps["workDaysPerWeek"].values() if item.get("span") == "双休"]

        self.assertEqual(day_options[0]["candidate"]["value"], "5")
        self.assertEqual(jev_conversation._converted_value("workDaysPerWeek", day_options[0]), "5")
        self.assertFalse(any(item.get("value") == "8" for item in maps["workHoursPerDay"].values()))

    def test_individual_fixed_cost_is_never_the_aggregate(self):
        _, item_maps, _ = jev_conversation.prepare("房租三千。")
        self.assertEqual(
            {key for key, item in item_maps["fixedExpenses"].items() if item.get("candidate")},
            set(),
        )

        _, total_maps, _ = jev_conversation.prepare("每月固定支出合计大约三千元。")
        selected = next(item for item in total_maps["fixedExpenses"].values() if item.get("candidate"))
        self.assertEqual(jev_conversation._converted_value("fixedExpenses", selected), "3000.00")

    def test_fixed_expenses_followup_accepts_unlabeled_total_but_not_an_item(self):
        _, maps, questions = jev_conversation.prepare("4200元", "fixedExpenses", {})
        candidates = [item for item in maps["fixedExpenses"].values() if item.get("candidate")]
        self.assertEqual(len(candidates), 2)  # present and estimated choices for one numeric span
        self.assertEqual(jev_conversation._converted_value("fixedExpenses", candidates[0]), "4200.00")
        self.assertIn("裸金额是该总额的直接回答", questions["fixedExpenses"].instructions)
        self.assertIn("可作为本月固定支出总额", next(
            value for key, value in questions["fixedExpenses"].criteria.items() if key.endswith("_present")
        ))

        _, item_maps, _ = jev_conversation.prepare("房租3000元", "fixedExpenses", {})
        self.assertFalse(any(item.get("candidate") for item in item_maps["fixedExpenses"].values()))

    def test_targeted_short_replies_are_current_source_candidates(self):
        cases = (
            ("fixedCostCoverage", "都算上了", "complete"),
            ("fixedCostCoverage", "是的", "complete"),
            ("purchaseIncluded", "算这个月", "included"),
            ("purchaseIncluded", "是的", "included"),
        )
        for field, text, expected_value in cases:
            with self.subTest(field=field, text=text):
                _, maps, _ = jev_conversation.prepare(text, field, {})
                candidates = [item for item in maps[field].values() if item.get("candidate")]
                selected = next(item for item in candidates if item["candidate"].get("value") == expected_value)
                self.assertEqual(selected["span"], text)
                self.assertEqual(jev_conversation._converted_value(field, selected), expected_value)

    def test_unknown_is_scoped_to_the_targeted_field(self):
        _, maps, _ = jev_conversation.prepare("不知道", "workHoursPerDay", {})

        self.assertEqual(maps["workHoursPerDay"]["unknown"]["status"], "unknown")
        self.assertNotIn("unknown", maps["workDaysPerWeek"])
        self.assertNotIn("unknown", maps["income"])

        _, natural_maps, _ = jev_conversation.prepare("每天工作几小时我不知道。")
        self.assertIn("unknown", natural_maps["workHoursPerDay"])
        self.assertNotIn("unknown", natural_maps["workHours"])

    def test_unknown_is_local_to_its_field_when_other_fields_are_explicit(self):
        _, maps, _ = jev_conversation.prepare("月入8000元，购买价格我不知道。")

        self.assertNotIn("unknown", maps["income"])
        self.assertIn("unknown", maps["purchaseAmount"])
        income_candidates = [item for item in maps["income"].values() if item.get("candidate")]
        self.assertTrue(income_candidates)

        _, inverse_maps, _ = jev_conversation.prepare("月收入不知道，购买价格3000元。")
        self.assertIn("unknown", inverse_maps["income"])
        self.assertNotIn("unknown", inverse_maps["purchaseAmount"])

    def test_ambiguous_generic_correction_cannot_be_attached_to_competing_amounts(self):
        context = {
            "income": {"value": "8000.00", "span": "8000"},
            "purchaseAmount": {"value": "3000.00", "span": "3000"},
        }
        _, maps, _ = jev_conversation.prepare("那个金额改成2000。", None, context)

        for field in ("income", "purchaseAmount"):
            self.assertEqual(maps[field], {"ambiguous": {"status": "ambiguous"}})

        _, alternate_maps, _ = jev_conversation.prepare("把之前那个金额调整为2500元。", None, context)
        for field in ("income", "purchaseAmount"):
            self.assertEqual(alternate_maps[field], {"ambiguous": {"status": "ambiguous"}})

        for text in ("那个改成两千。", "把它改成两千。"):
            _, chinese_maps, _ = jev_conversation.prepare(text, None, context)
            for field in ("income", "purchaseAmount"):
                self.assertEqual(chinese_maps[field], {"ambiguous": {"status": "ambiguous"}})

        answers = {field: SimpleNamespace(choice="missing") for field in jev_conversation.FIELD_KEYS}
        answers["income"].choice = "ambiguous"
        answers["purchaseAmount"].choice = "ambiguous"
        fields = jev_conversation.decode(answers, maps)["fields"]
        self.assertEqual(fields["income"]["status"], "ambiguous")
        self.assertEqual(fields["purchaseAmount"]["status"], "ambiguous")

    def test_explicit_no_fixed_cost_is_zero_but_income_and_price_zero_are_rejected(self):
        _, maps, _ = jev_conversation.prepare("没有固定支出。")
        no_cost = next(item for item in maps["fixedExpenses"].values() if item.get("synthetic_zero"))

        self.assertEqual(jev_conversation._converted_value("fixedExpenses", no_cost), "0.00")
        self.assertIsNone(jev_server.amount("0"))

    def test_decimal_time_precision_and_limits(self):
        self.assertEqual(jev_conversation._time_number("7.5"), "7.5")
        self.assertEqual(jev_conversation._time_number("七点五"), "7.5")
        self.assertEqual(jev_conversation._time_number("5.5555"), None)
        self.assertIsNone(jev_conversation._time_number("-5"))
        self.assertIsNone(jev_conversation._time_number("5,5"))
        self.assertIsNone(jev_conversation._time_number("1.2.3"))
        self.assertFalse(jev_conversation._valid_context_value("workDaysPerWeek", "7.1"))
        self.assertFalse(jev_conversation._valid_context_value("workHoursPerDay", "24.1"))
        self.assertFalse(jev_conversation._valid_context_value("workHours", "1000000"))
        self.assertFalse(jev_conversation._valid_context_value("workHoursPerDay", "0"))

    def test_rejects_model_output_that_is_not_a_current_candidate(self):
        _, maps, _ = jev_conversation.prepare("月入8000元")
        answers = {field: SimpleNamespace(choice="missing") for field in jev_conversation.FIELD_KEYS}
        answers["income"].choice = "context_value_8000"

        with self.assertRaises(ValueError):
            jev_conversation.decode(answers, maps)

    def test_question_context_is_validated_and_minimized(self):
        context = {
            "income": {"value": "8000.00", "span": "8000"},
            "taxBasis": {"value": "after-tax", "span": "税后"},
            "purchaseAmount": {"value": "3000.00", "span": "3000"},
        }

        self.assertEqual(
            jev_conversation.validate_request("到手", "taxBasis", context),
            {"income": context["income"]},
        )
        self.assertEqual(
            jev_conversation.validate_request("改收入", "income", context),
            {"income": context["income"]},
        )
        self.assertEqual(
            jev_conversation.validate_request("本月算吗", "purchaseIncluded", context),
            {"purchaseAmount": context["purchaseAmount"]},
        )
        for invalid in (
            {"valueExpectation": {"value": "想多存钱", "span": None}},
            {"taxBasis": {"value": "pre-tax", "span": "税前"}},
            {"workDaysPerWeek": {"value": "8", "span": "8"}},
            {"income": {"value": 8000, "span": None}},
            {"income": {"value": "8000.00", "span": "x" * 201}},
        ):
            with self.subTest(invalid=invalid), self.assertRaises(ValueError):
                jev_conversation.validate_request("改一下", None, invalid)


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
        valid_body = json.dumps({"text": TEXT, "questionId": None, "context": {}}, ensure_ascii=False).encode()
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

            status, _ = self.post(
                json.dumps({"text": TEXT, "questionId": "notAField", "context": {}}, ensure_ascii=False).encode(),
                origin=f"http://{self.host}",
            )
            self.assertEqual(status, 400)

            status, _ = self.post(
                json.dumps({
                    "text": TEXT,
                    "questionId": "taxBasis",
                    "context": {"taxBasis": {"value": "post-tax", "span": "税后"}},
                }, ensure_ascii=False).encode(),
                origin=f"http://{self.host}",
            )
            self.assertEqual(status, 400)

            status, _ = self.post(
                json.dumps({"text": "啊" * 2001, "questionId": None, "context": {}}, ensure_ascii=False).encode(),
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
        response_data = {"fields": {"income": {"value": "8000.00", "span": "八千", "status": "present"}}}
        body = json.dumps({"text": TEXT, "questionId": None, "context": {}}, ensure_ascii=False).encode()
        with patch.dict(os.environ, {"TYPESAFE_API_KEY": TEST_KEY}), patch.object(
            jev_server, "assist", return_value=response_data
        ) as assist:
            status, response_body = self.post(body, origin=f"http://{self.host}")

        self.assertEqual(status, 200)
        self.assertEqual(json.loads(response_body), response_data)
        assist.assert_called_once_with(TEXT, None, {})

    def test_valid_context_is_minimized_before_assist(self):
        context = {
            "income": {"value": "8000.00", "span": "八千"},
            "taxBasis": {"value": "after-tax", "span": "税后"},
            "purchaseAmount": {"value": "3000.00", "span": "三千"},
        }
        body = json.dumps({"text": "到手", "questionId": "taxBasis", "context": context}, ensure_ascii=False).encode()
        with patch.dict(os.environ, {"TYPESAFE_API_KEY": TEST_KEY}), patch.object(
            jev_server, "assist", return_value={"fields": {}}
        ) as assist:
            status, _ = self.post(body, origin=f"http://{self.host}")

        self.assertEqual(status, 200)
        assist.assert_called_once_with("到手", "taxBasis", {"income": context["income"]})

    def test_service_error_returns_generic_502_without_exception_text(self):
        body = json.dumps({"text": TEXT, "questionId": None, "context": {}}, ensure_ascii=False).encode()
        with patch.dict(os.environ, {"TYPESAFE_API_KEY": TEST_KEY}), patch.object(
            jev_server, "assist", side_effect=RuntimeError("secret-error-body")
        ):
            status, response_body = self.post(body, origin=f"http://{self.host}")

        self.assertEqual(status, 502)
        self.assertEqual(json.loads(response_body), {"error": "service_failed"})
        self.assertNotIn(b"secret-error-body", response_body)

    def test_busy_server_rejects_without_calling_assist(self):
        body = json.dumps({"text": TEXT, "questionId": None, "context": {}}, ensure_ascii=False).encode()
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
