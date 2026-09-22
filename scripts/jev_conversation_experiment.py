"""One-pass Jev evaluation for fixed, fictional conversational purchase fixtures."""
import argparse
from datetime import datetime, timezone
import hashlib
import json
import logging
import os
from pathlib import Path
import time

from typesafe_sdk import RetryPolicy, TypeSafeClient

from jev_conversation import FIELD_KEYS, decode, prepare

STATUSES = {"present", "estimated", "missing", "ambiguous", "unsupported", "unknown"}


def _read_fixtures(path):
    cases = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(cases, list) or not 1 <= len(cases) <= 20:
        raise ValueError("Expected 1-20 fictional cases")
    ids = set()
    prepared = []
    total_turns = 0
    for case in cases:
        if not isinstance(case, dict) or set(case) != {"id", "turns"}:
            raise ValueError("Each case must contain only id and turns")
        case_id, turns = case["id"], case["turns"]
        if not isinstance(case_id, str) or not case_id or case_id in ids:
            raise ValueError("Fixture ids must be unique non-empty strings")
        ids.add(case_id)
        if not isinstance(turns, list) or not turns:
            raise ValueError(f"{case_id} must contain at least one turn")
        prepared_turns = []
        for turn_number, turn in enumerate(turns, 1):
            if not isinstance(turn, dict) or set(turn) != {"text", "questionId", "context", "expected"}:
                raise ValueError(f"{case_id}/{turn_number}: invalid turn shape")
            state, maps, questions = prepare(turn["text"], turn["questionId"], turn["context"])
            expected = turn["expected"]
            if not isinstance(expected, dict) or not set(expected).issubset(FIELD_KEYS):
                raise ValueError(f"{case_id}/{turn_number}: invalid expected fields")
            for field, expectation in expected.items():
                if not isinstance(expectation, dict) or not set(expectation).issubset({"value", "span", "status"}):
                    raise ValueError(f"{case_id}/{turn_number}: invalid expectation for {field}")
                allowed_statuses = expectation.get("status")
                if isinstance(allowed_statuses, str):
                    allowed_statuses = [allowed_statuses]
                if not isinstance(allowed_statuses, list) or not allowed_statuses or not set(allowed_statuses).issubset(STATUSES):
                    raise ValueError(f"{case_id}/{turn_number}: invalid expected status for {field}")
                if set(allowed_statuses).issubset({"present", "estimated"}):
                    span = expectation.get("span")
                    allowed_spans = [span] if isinstance(span, str) else span
                    if (not isinstance(allowed_spans, list) or not allowed_spans
                            or not all(isinstance(item, str) and item in turn["text"] for item in allowed_spans)):
                        raise ValueError(f"{case_id}/{turn_number}: source span must occur in current text")
            prepared_turns.append((turn, state, maps, questions))
            total_turns += 1
        prepared.append(prepared_turns)
    if total_turns > 30:
        raise ValueError("Expected at most 30 fixture turns")
    return cases, prepared, total_turns


def _compare(actual, expected):
    differences = []
    for field in FIELD_KEYS:
        expected_field = expected.get(field, {"status": "missing", "value": None, "span": None})
        actual_field = actual["fields"][field]
        for key, expected_value in expected_field.items():
            actual_value = actual_field.get(key)
            if isinstance(expected_value, list):
                matches = actual_value in expected_value
            else:
                matches = actual_value == expected_value
            if not matches:
                differences.append({"field": field, "key": key,
                                   "expected": expected_value, "actual": actual_value})
    return differences


def self_check(fixtures_path=None):
    path = fixtures_path or Path(__file__).with_name("jev_conversation_cases.json")
    cases, prepared, total_turns = _read_fixtures(path)
    assert len(cases) >= 1
    if path.name == "jev_conversation_cases.json":
        assert len(cases) >= 6
        assert any(len(case["turns"]) > 1 for case in cases)
        assert total_turns >= 8
    assert len(prepared) == len(cases)
    assert _compare({"fields": {field: {"value": None, "span": None, "status": "missing"}
                               for field in FIELD_KEYS}}, {}) == []
    print(f"Self-check passed; {len(cases)} fictional cases, {total_turns} turns validated; no API calls")


def run(cases_path, output_path, model):
    cases, prepared, total_turns = _read_fixtures(cases_path)
    if not os.environ.get("TYPESAFE_API_KEY", "").strip():
        raise ValueError("TYPESAFE_API_KEY is missing; load it with uv --env-file without printing it")
    logging.getLogger("typesafe_sdk").disabled = True
    output_path.parent.mkdir(parents=True, exist_ok=True)
    fixtures_hash = hashlib.sha256(cases_path.read_bytes()).hexdigest()
    script_hash = hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
    attempted = succeeded = errors = mismatches = 0
    with output_path.open("x", encoding="utf-8") as output:
        with TypeSafeClient(api_key=os.environ["TYPESAFE_API_KEY"], model=model,
                            base_url="https://api.typesafe.ai/", timeout=30,
                            retry=RetryPolicy(max_retries=0)) as client:
            for case, turns in zip(cases, prepared):
                for turn_number, (turn, state, maps, questions) in enumerate(turns, 1):
                    record = {
                        "case_id": case["id"], "turn": turn_number, "text": turn["text"],
                        "questionId": turn["questionId"], "expected": turn["expected"],
                        "timestamp": datetime.now(timezone.utc).isoformat(), "requested_model": model,
                        "fixtures_sha256": fixtures_hash, "script_sha256": script_hash,
                    }
                    started = time.monotonic()
                    attempted += 1
                    try:
                        response = client.system_one(state=state, questions=questions)
                        succeeded += 1
                        record["request_count"] = 1
                        record["request_id"] = response.request_id
                        record["http_status"] = response.raw_http_response.status_code
                        actual = decode(response.choices, maps)
                        differences = _compare(actual, turn["expected"])
                        record["actual"] = actual
                        record["differences"] = differences
                        record["status"] = "mismatch" if differences else "pass"
                        mismatches += bool(differences)
                    except Exception as error:
                        errors += 1
                        record.update(request_count=1, status="error", error_type=type(error).__name__)
                    record["elapsed_seconds"] = round(time.monotonic() - started, 3)
                    output.write(json.dumps(record, ensure_ascii=False) + "\n")
                    output.flush()
                    print(f"{case['id']}/{turn_number}: {record['status']}", flush=True)
        summary = {
            "record_type": "summary", "timestamp": datetime.now(timezone.utc).isoformat(),
            "requested_model": model, "fixture_turns": total_turns, "attempted_requests": attempted,
            "successful_responses": succeeded, "service_errors": errors, "content_mismatches": mismatches,
            "automatic_retries": 0, "fixtures_sha256": fixtures_hash, "script_sha256": script_hash,
        }
        output.write(json.dumps(summary, ensure_ascii=False) + "\n")
        output.flush()
    print(json.dumps(summary, ensure_ascii=False))
    print(f"Saved one-pass results to {output_path}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--self-check", action="store_true")
    parser.add_argument("--run", action="store_true", help="Run each fixed fictional turn exactly once")
    parser.add_argument("--cases", type=Path, default=Path(__file__).with_name("jev_conversation_cases.json"))
    parser.add_argument("--output", type=Path)
    parser.add_argument("--model", default="jev-1.13.0")
    args = parser.parse_args()
    if args.self_check:
        self_check(args.cases)
        return
    if not args.run or args.output is None:
        parser.error("Specify --self-check or --run --output PATH")
    try:
        run(args.cases, args.output, args.model)
    except (ValueError, FileExistsError) as error:
        parser.error(str(error))


if __name__ == "__main__":
    main()
