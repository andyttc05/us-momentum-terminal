#!/usr/bin/env python
"""Execute one on-demand custom backtest and deliver its result.

This is the runner that GitHub Actions starts for a single visitor request. It
deliberately contains no quantitative logic: the configuration is fetched from
the Cloudflare Worker, the existing production engine produces the result, and
the serialised block is posted back to the Worker. Keeping the calculation in
``app.snapshot.run_historical_backtest`` means a dynamic run can never drift
from the published backtest.

Usage (production, inside the workflow):

    python data-service/scripts/custom_backtest.py

Environment:
    BACKTEST_API_URL         Worker base URL, e.g. https://umt-refresh-broker.…
    BACKTEST_CALLBACK_TOKEN  shared secret; never echoed, never logged
    BACKTEST_REQUEST_ID      request id returned to the browser

Local development can bypass the network:

    python data-service/scripts/custom_backtest.py \
        --config-file /tmp/config.json --output /tmp/result.json
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import requests  # noqa: E402

from app.backtest_job import (  # noqa: E402
    ConfigError,
    normalize_config,
    run_custom_backtest,
    validate_result,
)

REQUEST_TIMEOUT = 30
CALLBACK_TIMEOUT = 120
MAX_ERROR_LENGTH = 400


def _redact(message: str) -> str:
    """Bound an error message and strip any credential that slipped in."""
    text = " ".join(str(message or "").split())
    for name in ("BACKTEST_CALLBACK_TOKEN", "GITHUB_REFRESH_TOKEN", "TURNSTILE_SECRET_KEY"):
        secret = os.environ.get(name, "")
        if secret:
            text = text.replace(secret, "[redacted]")
    return text[:MAX_ERROR_LENGTH]


def _api_base() -> str:
    base = os.environ.get("BACKTEST_API_URL", "").strip().rstrip("/")
    if not base:
        raise SystemExit("BACKTEST_API_URL is not set")
    return base


def _token() -> str:
    token = os.environ.get("BACKTEST_CALLBACK_TOKEN", "").strip()
    if not token:
        raise SystemExit("BACKTEST_CALLBACK_TOKEN is not set")
    return token


def fetch_config(base: str, token: str, request_id: str) -> dict:
    response = requests.get(
        f"{base}/api/backtest/job",
        params={"requestId": request_id},
        headers={"authorization": f"Bearer {token}", "accept": "application/json"},
        timeout=REQUEST_TIMEOUT,
    )
    if response.status_code != 200:
        raise RuntimeError(f"job configuration request failed (HTTP {response.status_code})")
    payload = response.json()
    config = payload.get("config")
    if not isinstance(config, dict):
        raise RuntimeError("job configuration response is missing its config")
    return config


def post_callback(base: str, token: str, body: dict) -> None:
    response = requests.post(
        f"{base}/api/backtest/callback",
        headers={
            "authorization": f"Bearer {token}",
            "content-type": "application/json",
            "accept": "application/json",
        },
        data=json.dumps(body).encode("utf-8"),
        timeout=CALLBACK_TIMEOUT,
    )
    if response.status_code not in (200, 202):
        raise RuntimeError(f"result callback was rejected (HTTP {response.status_code})")


def run(config: dict) -> dict:
    normalized = normalize_config(config)
    print(
        f"running {normalized['portfolio']} {normalized['rebalance_frequency']} "
        f"{normalized['start']}..{normalized['end']}",
        flush=True,
    )
    result = run_custom_backtest(normalized)
    validate_result(result)
    return result


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Run one on-demand backtest.")
    parser.add_argument("--config-file", help="read the job config from a local JSON file")
    parser.add_argument("--output", help="write the result JSON to this path instead of calling back")
    parser.add_argument(
        "--notify-failure",
        metavar="MESSAGE",
        help="report a failure that happened before this script ran (workflow safety net)",
    )
    args = parser.parse_args(argv)

    request_id = os.environ.get("BACKTEST_REQUEST_ID", "").strip()
    base = ""
    token = ""

    if args.notify_failure:
        base = _api_base()
        token = _token()
        if not request_id:
            raise SystemExit("BACKTEST_REQUEST_ID is not set")
        _upload_failure(base, token, request_id, args.notify_failure, "workflow_failed")
        return 1

    config: dict | None = None

    if args.config_file:
        config = json.loads(Path(args.config_file).read_text())
    else:
        if not request_id:
            raise SystemExit("BACKTEST_REQUEST_ID is not set")
        base = _api_base()
        token = _token()
        try:
            config = fetch_config(base, token, request_id)
        except Exception as error:  # noqa: BLE001 - reported to the visitor
            print(f"could not load the job configuration: {_redact(error)}", flush=True)
            _upload_failure(base, token, request_id, _redact(error), "config_unavailable")
            return 1
        # The runner is alive and working: move the job out of "queued" so the
        # page can show real progress instead of an indefinite queue.
        try:
            post_callback(base, token, {"requestId": request_id, "status": "running"})
        except Exception as error:  # noqa: BLE001 - progress only
            print(f"could not report progress: {_redact(error)}", flush=True)

    started = time.time()
    try:
        result = run(config or {})
    except ConfigError as error:
        message = _redact(error.message)
        print(f"invalid configuration: {message}", flush=True)
        if base and token and request_id:
            _upload_failure(base, token, request_id, message, error.code)
        return 1
    except Exception as error:  # noqa: BLE001 - surface the reason, never a token
        message = _redact(f"{type(error).__name__}: {error}")
        print(f"backtest failed: {message}", flush=True)
        if base and token and request_id:
            _upload_failure(base, token, request_id, message, "engine_failed")
        return 1

    encoded = json.dumps(result)
    print(
        f"completed in {time.time() - started:.1f}s, {len(encoded) / 1024:.0f} KiB result",
        flush=True,
    )

    if args.output:
        Path(args.output).write_text(encoded)
        return 0

    try:
        post_callback(
            base,
            token,
            {"requestId": request_id, "status": "completed", "result": result},
        )
    except Exception as error:  # noqa: BLE001
        print(f"could not deliver the result: {_redact(error)}", flush=True)
        return 1
    print("result delivered", flush=True)
    return 0


def _upload_failure(base: str, token: str, request_id: str, message: str, code: str) -> None:
    """Always try to release the job so the visitor sees a real error."""
    try:
        post_callback(
            base,
            token,
            {"requestId": request_id, "status": "failed", "error": message, "code": code},
        )
        print("failure delivered", flush=True)
    except Exception as error:  # noqa: BLE001
        print(f"could not deliver the failure: {_redact(error)}", flush=True)


if __name__ == "__main__":
    raise SystemExit(main())
