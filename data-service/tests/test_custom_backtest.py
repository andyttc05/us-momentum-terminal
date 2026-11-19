"""Contract tests for the on-demand backtest job path.

These cover the request contract shared by the Worker, the FastAPI service and
the GitHub Actions runner, plus the runner's delivery behaviour. The engine is
never executed here: the point is that exactly one implementation of the
quantitative work exists and this path only forwards to it.
"""

from __future__ import annotations

import io
import json
import sys
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.backtest_job import (  # noqa: E402
    ConfigError,
    config_summary,
    normalize_config,
    run_custom_backtest,
    validate_result,
)

VALID = {
    "portfolio": "top100",
    "start": "2020-01-02",
    "end": "2021-01-02",
    "rebalance_frequency": "semiannual",
}


def config(**overrides):
    return {**VALID, **overrides}


class NormalizeConfigTests(unittest.TestCase):
    def test_defaults_match_the_published_first_run(self):
        parsed = normalize_config({"start": "2020-01-02", "end": "2021-01-02"})
        self.assertEqual(parsed["portfolio"], "top100")
        self.assertEqual(parsed["rebalance_frequency"], "semiannual")
        self.assertEqual(parsed["initial_capital"], 10_000.0)
        self.assertFalse(parsed["cashflow_enabled"])
        self.assertEqual(parsed["cashflow_direction"], "inflow")

    def test_top20_and_every_rebalance_frequency_are_accepted(self):
        for frequency in ("monthly", "quarterly", "semiannual", "annual"):
            parsed = normalize_config(config(portfolio="top20", rebalance_frequency=frequency))
            self.assertEqual(parsed["portfolio"], "top20")
            self.assertEqual(parsed["rebalance_frequency"], frequency)

    def test_cashflow_frequency_is_normalised(self):
        parsed = normalize_config(
            config(cashflow_enabled=True, cashflow_amount=250, cashflow_frequency="annually"),
        )
        self.assertEqual(parsed["cashflow_frequency"], "annual")
        self.assertEqual(parsed["cashflow_amount"], 250.0)

    def test_custom_dates_survive_round_trip(self):
        parsed = normalize_config(config(start="2019-03-15", end="2024-08-30"))
        self.assertEqual(parsed["start"], "2019-03-15")
        self.assertEqual(parsed["end"], "2024-08-30")

    def test_rejects_bad_input_with_stable_codes(self):
        cases = {
            "invalid_portfolio": config(portfolio="top50"),
            "invalid_rebalance_frequency": config(rebalance_frequency="weekly"),
            "invalid_start": config(start="15/03/2019"),
            "invalid_range": config(start="2022-01-02", end="2021-01-02"),
            "invalid_initial_capital": config(initial_capital=0),
            "invalid_cashflow_amount": config(cashflow_enabled=True),
            "invalid_cashflow_frequency": config(cashflow_frequency="daily"),
            "invalid_cashflow_direction": config(cashflow_direction="sideways"),
            "invalid_config": "not-a-dict",
        }
        for code, payload in cases.items():
            with self.subTest(code=code):
                with self.assertRaises(ConfigError) as caught:
                    normalize_config(payload)
                self.assertEqual(caught.exception.code, code)
                self.assertTrue(caught.exception.message)

    def test_rejects_non_finite_and_boolean_numbers(self):
        for payload in (config(initial_capital=float("inf")), config(initial_capital=True)):
            with self.subTest(payload=payload):
                with self.assertRaises(ConfigError):
                    normalize_config(payload)

    def test_rejects_an_absurd_window(self):
        with self.assertRaises(ConfigError) as caught:
            normalize_config(config(start="1900-01-01", end="2025-01-01"))
        self.assertEqual(caught.exception.code, "range_too_long")

    def test_summary_is_frontend_shaped_and_carries_the_label(self):
        summary = config_summary(normalize_config(config()))
        self.assertEqual(summary["rebalanceLabel"], "Semiannual (Mar / Sep)")
        self.assertEqual(summary["portfolio"], "top100")
        self.assertEqual(summary["rebalanceFrequency"], "semiannual")
        self.assertNotIn("cashflow_amount", summary)


class RunCustomBacktestTests(unittest.TestCase):
    def test_delegates_to_the_existing_engine_once(self):
        sentinel = {"available": True, "dates": ["2020-01-02"], "strategy": [1.0]}
        with mock.patch(
            "app.snapshot.run_historical_backtest", return_value=dict(sentinel),
        ) as engine:
            result = run_custom_backtest(normalize_config(config(initial_capital=5000)))
        engine.assert_called_once()
        kwargs = engine.call_args.kwargs
        self.assertEqual(kwargs["portfolio"], "top100")
        self.assertEqual(kwargs["initial_capital"], 5000.0)
        self.assertEqual(kwargs["start"], "2020-01-02")
        self.assertEqual(result["rebalanceLabel"], "Semiannual (Mar / Sep)")

    def test_engine_arguments_are_the_validated_config(self):
        parsed = normalize_config(config(portfolio="top20", rebalance_frequency="monthly"))
        with mock.patch("app.snapshot.run_historical_backtest", return_value={"available": False, "reason": "x"}) as engine:
            run_custom_backtest(parsed)
        self.assertEqual(engine.call_args.kwargs, parsed)


class ValidateResultTests(unittest.TestCase):
    def test_accepts_a_well_formed_block(self):
        validate_result(
            {
                "available": True,
                "dates": ["2020-01-02", "2020-01-03"],
                "strategy": [100.0, 101.0],
                "drawdown": [0.0, -1.0],
                "spy": [100.0, 100.5],
                "spmo": [100.0, 100.4],
                "metrics": {},
            },
        )

    def test_rejects_a_misaligned_series(self):
        with self.assertRaises(ConfigError):
            validate_result(
                {
                    "available": True,
                    "dates": ["2020-01-02", "2020-01-03"],
                    "strategy": [100.0],
                    "metrics": {},
                },
            )

    def test_requires_a_reason_when_unavailable(self):
        with self.assertRaises(ConfigError):
            validate_result({"available": False})
        validate_result({"available": False, "reason": "insufficient history"})


class RunnerTests(unittest.TestCase):
    """The runner must always try to release a job, including on failure."""

    @classmethod
    def setUpClass(cls):
        sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
        import custom_backtest  # noqa: PLC0415

        cls.runner = custom_backtest

    def _run(self, argv):
        buffer = io.StringIO()
        with redirect_stdout(buffer):
            code = self.runner.main(argv)
        return code, buffer.getvalue()

    def test_local_run_writes_the_result(self):
        import tempfile

        with tempfile.TemporaryDirectory() as directory:
            config_path = Path(directory) / "config.json"
            output_path = Path(directory) / "result.json"
            config_path.write_text(json.dumps(config()))
            result = {
                "available": True,
                "dates": ["2020-01-02"],
                "strategy": [100.0],
                "metrics": {},
            }
            with mock.patch.object(self.runner, "run_custom_backtest", return_value=result):
                code, output = self._run(
                    ["--config-file", str(config_path), "--output", str(output_path)],
                )
            self.assertEqual(code, 0)
            self.assertEqual(json.loads(output_path.read_text()), result)
            self.assertIn("completed", output)

    def test_engine_failure_posts_a_failure_callback_and_exits_non_zero(self):
        posted = []

        def fake_post(url, **kwargs):
            posted.append((url, json.loads(kwargs["data"])))
            return mock.Mock(status_code=200)
        with mock.patch.dict(
            "os.environ",
            {
                "BACKTEST_API_URL": "https://broker.test",
                "BACKTEST_CALLBACK_TOKEN": "token-value-not-to-be-printed",
                "BACKTEST_REQUEST_ID": "req-1",
            },
        ), mock.patch.object(
            self.runner, "fetch_config", return_value=config(),
        ), mock.patch.object(
            self.runner, "run_custom_backtest", side_effect=RuntimeError("provider exploded"),
        ), mock.patch.object(
            self.runner.requests, "post", side_effect=fake_post,
        ):
            code, output = self._run([])

        self.assertEqual(code, 1)
        urls = [url for url, _ in posted]
        payloads = [payload for _, payload in posted]
        self.assertTrue(all(url.endswith("/api/backtest/callback") for url in urls))
        self.assertEqual([payload["status"] for payload in payloads], ["running", "failed"])
        self.assertEqual(payloads[-1]["requestId"], "req-1")
        self.assertEqual(payloads[-1]["code"], "engine_failed")
        self.assertNotIn("token-value-not-to-be-printed", output)

    def test_success_posts_the_completed_result(self):
        posted = []

        def fake_post(url, **kwargs):
            posted.append(json.loads(kwargs["data"]))
            return mock.Mock(status_code=202)

        result = {"available": True, "dates": ["2020-01-02"], "strategy": [1.0], "metrics": {}}
        with mock.patch.dict(
            "os.environ",
            {
                "BACKTEST_API_URL": "https://broker.test",
                "BACKTEST_CALLBACK_TOKEN": "secret",
                "BACKTEST_REQUEST_ID": "req-2",
            },
        ), mock.patch.object(
            self.runner, "fetch_config", return_value=config(),
        ), mock.patch.object(
            self.runner, "run_custom_backtest", return_value=result,
        ), mock.patch.object(
            self.runner.requests, "post", side_effect=fake_post,
        ):
            code, _ = self._run([])

        self.assertEqual(code, 0)
        self.assertEqual([payload["status"] for payload in posted], ["running", "completed"])
        self.assertEqual(posted[-1]["requestId"], "req-2")
        self.assertEqual(posted[-1]["result"], result)

    def test_a_workflow_level_failure_can_still_release_the_job(self):
        posted = []

        def fake_post(url, **kwargs):
            posted.append(json.loads(kwargs["data"]))
            return mock.Mock(status_code=200)

        with mock.patch.dict(
            "os.environ",
            {
                "BACKTEST_API_URL": "https://broker.test",
                "BACKTEST_CALLBACK_TOKEN": "secret",
                "BACKTEST_REQUEST_ID": "req-4",
            },
        ), mock.patch.object(self.runner.requests, "post", side_effect=fake_post):
            code, output = self._run(["--notify-failure", "Dependency install failed"])

        self.assertEqual(code, 1)
        self.assertEqual(posted[0]["status"], "failed")
        self.assertEqual(posted[0]["code"], "workflow_failed")
        self.assertEqual(posted[0]["requestId"], "req-4")
        self.assertIn("failure delivered", output)

    def test_callback_rejection_is_reported_not_hidden(self):
        with mock.patch.dict(
            "os.environ",
            {
                "BACKTEST_API_URL": "https://broker.test",
                "BACKTEST_CALLBACK_TOKEN": "secret",
                "BACKTEST_REQUEST_ID": "req-3",
            },
        ), mock.patch.object(
            self.runner, "fetch_config", return_value=config(),
        ), mock.patch.object(
            self.runner,
            "run_custom_backtest",
            return_value={"available": True, "dates": ["2020-01-02"], "strategy": [1.0], "metrics": {}},
        ), mock.patch.object(
            self.runner.requests, "post", return_value=mock.Mock(status_code=401),
        ):
            code, output = self._run([])
        self.assertEqual(code, 1)
        self.assertIn("rejected", output)


if __name__ == "__main__":
    unittest.main()
