#!/usr/bin/env python3
"""Build and atomically publish the GitHub Pages market-data snapshot.

The exporter reuses the application's validated publication and stock-detail
builders. A failed or incomplete update never replaces the last valid static
snapshot already present in the frontend's public directory.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "data-service"))

from app.snapshot import (  # noqa: E402
    PUBLICATION_VERSION,
    UNIVERSE_VERSION,
    build_publication,
    build_stock_detail,
    publication_is_current,
)
from app.snapshot import load_cached_backtest_series  # noqa: E402
from app.size_history import _merged_history  # noqa: E402
from app.universe import HISTORICAL_BACKTEST_TICKERS, MEMBER_BY_TICKER  # noqa: E402

DEFAULT_OUTPUT = ROOT / "frontend" / "public" / "data"
DEFAULT_SEED = ROOT / "data-service" / "seed" / "publication.json"
SCHEMA_VERSION = 2
BACKTEST_INPUT_VERSION = 1


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _parse_time(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return None
    return parsed.replace(tzinfo=timezone.utc) if parsed.tzinfo is None else parsed


def _write_json(path: Path, value: object) -> int:
    path.parent.mkdir(parents=True, exist_ok=True)
    encoded = json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    path.write_text(encoded)
    return len(encoded.encode("utf-8"))


def build_backtest_inputs() -> dict:
    """Serialize the validated historical inputs needed by a browser backtest.

    Values stay per-symbol and date-aligned, avoiding a wide matrix full of nulls.
    Historical share disclosures are included so the browser applies the same
    point-in-time outstanding-share size proxy as Python.
    """
    series_map = load_cached_backtest_series()
    def numeric_values(values):
        return [float(value) if value is not None and value == value else None for value in values]

    symbols = {}
    for symbol in [*HISTORICAL_BACKTEST_TICKERS, "SPY", "SPMO"]:
        series = series_map.get(symbol)
        if series is None or not series.adjusted:
            continue
        frame = series.frame
        symbols[symbol] = {
            "dates": [stamp.strftime("%Y-%m-%d") for stamp in frame.index],
            "adj": numeric_values(frame["adj"]),
            "close": numeric_values(frame["close"]),
            "volume": numeric_values(frame["volume"]),
            "dividends": [float(value) if value == value else 0.0 for value in frame["dividends"]],
            "splits": [float(value) if value == value else 0.0 for value in frame["splits"]],
            "shares": [[date, int(count)] for date, count in _merged_history(symbol)],
            "sector": MEMBER_BY_TICKER[symbol].sector if symbol in MEMBER_BY_TICKER else None,
            "source": series.source,
        }
    if not symbols:
        raise RuntimeError("historical backtest inputs are empty")
    return {
        "schemaVersion": BACKTEST_INPUT_VERSION,
        "generatedAt": _now().isoformat(timespec="seconds"),
        "asOf": max((value["dates"][-1] for value in symbols.values() if value["dates"]), default=None),
        "universe": [symbol for symbol in HISTORICAL_BACKTEST_TICKERS if symbol in symbols],
        "benchmarks": [symbol for symbol in ("SPY", "SPMO") if symbol in symbols],
        "symbols": symbols,
    }


def _set_github_output(name: str, value: object) -> None:
    output = os.environ.get("GITHUB_OUTPUT")
    if not output:
        return
    normalized = str(value).replace("\n", " ")
    with Path(output).open("a") as handle:
        handle.write(f"{name}={normalized}\n")


def _print_refresh_diagnostics(payload: dict, errors: list[str] | None = None) -> None:
    """Emit the runtime refresh report to Actions logs without provider secrets."""
    report = {
        "errors": list(errors or []),
        **(payload.get("diagnostics") or {}),
    }
    print("REFRESH_DIAGNOSTICS " + json.dumps(report, indent=2), file=sys.stderr, flush=True)


def validate_publication(
    payload: dict,
    *,
    max_as_of_age_days: int,
    min_stock_ratio: float,
    require_schedules: bool = True,
) -> list[str]:
    errors: list[str] = []
    if not isinstance(payload, dict):
        return ["publication is not a JSON object"]
    if not publication_is_current(payload):
        errors.append("snapshot version does not match the current application")

    meta = payload.get("meta") or {}
    stocks = payload.get("stocks") or []
    requested = (payload.get("universe") or {}).get("requested") or 0
    loaded = (payload.get("universe") or {}).get("loaded")
    if meta.get("connection_status") != "connected":
        errors.append("provider connection is not connected")
    if not stocks:
        errors.append("snapshot contains no eligible stocks")
    if requested and len(stocks) < max(1, round(requested * min_stock_ratio)):
        errors.append(f"only {len(stocks)} of {requested} universe stocks are available")
    # Eligibility filters may legitimately exclude a stock (for example an
    # ADR or sub-$5 security), but a provider omission is never publishable.
    # This is intentionally checked independently of the eligible stock ratio.
    if requested and loaded != requested:
        errors.append(f"only {loaded or 0} of {requested} universe price series loaded")
    if (payload.get("universe") or {}).get("partial"):
        errors.append("universe refresh is partial")
    if (payload.get("universe") or {}).get("unavailable"):
        errors.append("universe has unavailable ticker(s)")
    if not (payload.get("portfolio") or {}).get("available"):
        errors.append("model portfolio is unavailable")
    portfolios = payload.get("portfolios") or {}
    for portfolio_id, expected_count in (("top100", 100), ("top20", 20)):
        book = portfolios.get(portfolio_id) or {}
        holdings = book.get("holdings") or []
        if not book.get("available"):
            errors.append(f"{portfolio_id} model portfolio is unavailable")
        elif len(holdings) != expected_count:
            errors.append(
                f"{portfolio_id} model portfolio has {len(holdings)} holdings, "
                f"expected {expected_count}"
            )
        elif abs(sum((holding.get("finalWeight") or 0) for holding in holdings) - 100.0) > 0.01:
            errors.append(f"{portfolio_id} model portfolio weights do not sum to 100%")
        target = next(
            (constraint for constraint in book.get("constraints", []) if constraint.get("id") == "target-holdings"),
            None,
        )
        if not target or target.get("rule") != f"= {expected_count}":
            errors.append(f"{portfolio_id} target holdings constraint is inconsistent")
    for key in ("top100", "top20"):
        backtest = (payload.get("backtest") or {}).get(key) or {}
        if not backtest.get("available"):
            errors.append(f"{key} backtest is unavailable")
        elif not backtest.get("dates") or not backtest.get("strategy"):
            errors.append(f"{key} backtest has no published series")
    datasets = payload.get("datasets") or {}
    for universe, expected_count in (("top100", 100), ("top20", 20)):
        dataset = datasets.get(universe) or {}
        if not dataset:
            errors.append(f"{universe} dataset is missing")
            continue
        if (dataset.get("meta") or {}).get("universe") != universe:
            errors.append(f"{universe} dataset does not describe its own universe")
        rows = dataset.get("stockTickers") or []
        holdings = (dataset.get("portfolio") or {}).get("holdings") or []
        if len(rows) != expected_count:
            errors.append(f"{universe} dataset lists {len(rows)} stocks, expected {expected_count}")
        if len(holdings) != expected_count:
            errors.append(
                f"{universe} dataset portfolio has {len(holdings)} holdings, expected {expected_count}"
            )
        row_tickers = set(rows)
        holding_tickers = {holding.get("ticker") for holding in holdings}
        if row_tickers and holding_tickers and row_tickers != holding_tickers:
            errors.append(f"{universe} dataset stocks do not match its portfolio holdings")
        if not (dataset.get("overview") or {}).get("performance"):
            errors.append(f"{universe} dataset has no performance series")
    if require_schedules:
        schedules = payload.get("backtestSchedules") or {}
        for portfolio in ("top100", "top20"):
            for frequency in ("monthly", "quarterly", "semiannual", "annual"):
                block = (schedules.get(portfolio) or {}).get(frequency) or {}
                constraint_infeasible = (
                    frequency == "monthly"
                    and portfolio == "top20"
                    and "portfolio constraints infeasible" in str(block.get("reason") or "")
                )
                if (
                    not constraint_infeasible
                    and (not block.get("available") or not block.get("dates") or not block.get("strategy"))
                ):
                    errors.append(f"{portfolio} {frequency} backtest is unavailable")

    as_of = _parse_time(meta.get("as_of"))
    if not as_of:
        errors.append("market as-of date is missing or invalid")
    elif as_of < _now() - timedelta(days=max_as_of_age_days):
        errors.append(
            f"market snapshot is older than {max_as_of_age_days} days "
            f"(as-of {as_of.date().isoformat()})"
        )
    return errors


def validate_static_directory(
    output: Path,
    *,
    max_as_of_age_days: int,
    min_stock_ratio: float,
) -> list[str]:
    publication_path = output / "publication.json"
    manifest_path = output / "manifest.json"
    try:
        payload = json.loads(publication_path.read_text())
        manifest = json.loads(manifest_path.read_text())
    except (OSError, json.JSONDecodeError) as exc:
        return [f"static data cannot be read: {type(exc).__name__}: {exc}"]

    errors = validate_publication(
        payload,
        max_as_of_age_days=max_as_of_age_days,
        min_stock_ratio=min_stock_ratio,
        require_schedules=False,
    )
    if manifest.get("schemaVersion") != SCHEMA_VERSION:
        errors.append("static manifest schema is unsupported")
    if manifest.get("publicationVersion") != PUBLICATION_VERSION:
        errors.append("static manifest publication version is stale")
    if manifest.get("stockCount") != len(payload.get("stocks") or []):
        errors.append("static manifest stock count does not match publication")
    missing_details = [
        ticker
        for ticker in manifest.get("stockTickers", [])
        if not (output / "stocks" / f"{ticker}.json").is_file()
    ]
    if missing_details:
        errors.append(f"{len(missing_details)} stock detail files are missing")
    missing_backtests = [
        label
        for portfolio, files in (manifest.get("backtestFiles") or {}).items()
        for frequency, relative in files.items()
        if not (output / Path(relative).relative_to("data")).is_file()
        for label in [f"{portfolio}/{frequency}"]
    ]
    if missing_backtests:
        errors.append(f"{len(missing_backtests)} backtest files are missing")
    # Keep already deployed schema-2 snapshots valid while requiring complete
    # inputs from any newly generated manifest that declares them.
    if manifest.get("backtestInputsPath"):
        try:
            inputs = json.loads((output / "backtest-inputs.json").read_text())
            if inputs.get("schemaVersion") != BACKTEST_INPUT_VERSION or not inputs.get("universe"):
                errors.append("browser backtest inputs are empty or unsupported")
            if not set(inputs.get("benchmarks") or ()) >= {"SPY", "SPMO"}:
                errors.append("browser backtest inputs are missing SPY or SPMO")
            if len(inputs.get("universe") or []) < round(len(HISTORICAL_BACKTEST_TICKERS) * 0.95):
                errors.append("browser backtest inputs do not cover 95% of the historical universe")
            symbols = inputs.get("symbols") or {}
            for ticker in [*(inputs.get("universe") or []), "SPY", "SPMO"]:
                item = symbols.get(ticker) or {}
                dates = item.get("dates") or []
                if len(dates) < 253:
                    errors.append(f"browser backtest input {ticker} has fewer than 253 daily observations")
                    continue
                if dates != sorted(set(dates)):
                    errors.append(f"browser backtest input {ticker} dates are not unique and ascending")
                for field in ("adj", "close", "volume", "dividends", "splits"):
                    if len(item.get(field) or []) != len(dates):
                        errors.append(f"browser backtest input {ticker} has misaligned {field} data")
                if not item.get("sector") and ticker not in ("SPY", "SPMO"):
                    errors.append(f"browser backtest input {ticker} has no sector classification")
            if not inputs.get("asOf"):
                errors.append("browser backtest input coverage timestamp is missing")
        except (OSError, json.JSONDecodeError):
            errors.append("browser backtest inputs are missing or invalid")
    return errors


def _publish_directory(staging: Path, output: Path) -> None:
    backup = output.parent / f".{output.name}.previous-{os.getpid()}"
    if backup.exists():
        shutil.rmtree(backup)
    if output.exists():
        output.rename(backup)
    try:
        staging.rename(output)
    except Exception:
        if backup.exists() and not output.exists():
            backup.rename(output)
        raise
    if backup.exists():
        shutil.rmtree(backup)


def build_static(
    output: Path,
    *,
    max_as_of_age_days: int,
    min_stock_ratio: float,
    min_detail_ratio: float,
    force: bool = False,
    seed_path: Path | None = None,
    previous_publication: dict | None = None,
) -> dict:
    # A publication refresh must reconcile against the durable deployed book;
    # bypass the publication TTL cache so a runner's restored cache cannot
    # supersede that newer checkpoint.
    payload = build_publication(
        force=force or previous_publication is not None,
        previous_publication=previous_publication,
    )
    errors = validate_publication(
        payload,
        max_as_of_age_days=max_as_of_age_days,
        min_stock_ratio=min_stock_ratio,
    )
    if errors:
        _print_refresh_diagnostics(payload, errors)
        raise RuntimeError("; ".join(errors))

    stocks = payload.get("stocks") or []
    details: dict[str, dict] = {}
    detail_failures: list[str] = []
    for position, stock in enumerate(stocks, start=1):
        ticker = str(stock.get("ticker") or "").upper()
        if not ticker:
            continue
        print(f"detail {position}/{len(stocks)} {ticker}", flush=True)
        detail = build_stock_detail(ticker)
        if detail:
            details[ticker] = detail
        else:
            detail_failures.append(ticker)

    minimum_details = max(1, round(len(stocks) * min_detail_ratio))
    if len(details) < minimum_details:
        examples = ", ".join(detail_failures[:10])
        raise RuntimeError(
            f"only {len(details)} of {len(stocks)} stock detail files were built"
            + (f" (missing: {examples})" if examples else "")
        )

    exported_at = _now().isoformat(timespec="seconds")
    backtest_schedules = payload.get("backtestSchedules") or {}
    backtest_inputs = build_backtest_inputs()
    backtest_paths: dict[str, dict[str, str]] = {}
    backtest_bytes: dict[str, int] = {}
    for portfolio, frequency_blocks in backtest_schedules.items():
        backtest_paths[portfolio] = {}
        for frequency, block in frequency_blocks.items():
            relative = f"backtests/{portfolio}/{frequency}.json"
            backtest_paths[portfolio][frequency] = f"data/{relative}"
            backtest_bytes[f"{portfolio}/{frequency}"] = len(
                json.dumps(block, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
            )
    static_meta = {
        "schemaVersion": SCHEMA_VERSION,
        "exportedAt": exported_at,
        "publicationVersion": PUBLICATION_VERSION,
        "universeVersion": UNIVERSE_VERSION,
        "generatedAt": payload["meta"]["generated_at"],
        "asOf": payload["meta"]["as_of"],
        "stockCount": len(stocks),
        "detailCount": len(details),
        "detailFailures": detail_failures,
        "backtestCount": sum(len(files) for files in backtest_paths.values()),
        "provider": payload["meta"].get("data_provider"),
        "lastSuccessfulUpdate": payload["meta"]["generated_at"],
    }
    compact_payload = {
        key: value
        for key, value in payload.items()
        if key != "backtestSchedules"
    }
    compact_payload["backtestSchedulePaths"] = backtest_paths
    compact_payload = {
        **compact_payload,
        "meta": {**payload["meta"], "delivery": "static", "staticSnapshot": static_meta},
    }

    output.parent.mkdir(parents=True, exist_ok=True)
    staging = Path(tempfile.mkdtemp(prefix=".data-build-", dir=output.parent))
    try:
        publication_bytes = _write_json(staging / "publication.json", compact_payload)
        stock_files = {}
        for ticker, detail in details.items():
            stock_files[ticker] = _write_json(staging / "stocks" / f"{ticker}.json", detail)
        for portfolio, frequency_blocks in backtest_schedules.items():
            for frequency, block in frequency_blocks.items():
                _write_json(staging / "backtests" / portfolio / f"{frequency}.json", block)
        backtest_input_bytes = _write_json(staging / "backtest-inputs.json", backtest_inputs)

        manifest = {
            "schemaVersion": SCHEMA_VERSION,
            "publicationVersion": PUBLICATION_VERSION,
            "universeVersion": UNIVERSE_VERSION,
            "generatedAt": compact_payload["meta"]["generated_at"],
            "asOf": compact_payload["meta"]["as_of"],
            "exportedAt": exported_at,
            "stockCount": len(stocks),
            "detailCount": len(details),
            "stockTickers": sorted(details),
            "provider": compact_payload["meta"].get("data_provider"),
            "cacheState": compact_payload["meta"].get("cache_state"),
            "publicationPath": "data/publication.json",
            "stockPathTemplate": "data/stocks/{ticker}.json",
            "backtestFiles": backtest_paths,
            "backtestInputsPath": "data/backtest-inputs.json",
            "sizes": {
                "publicationBytes": publication_bytes,
                "stockDetailBytes": sum(stock_files.values()),
                "backtestBytes": sum(backtest_bytes.values()),
                "backtestInputBytes": backtest_input_bytes,
            },
        }
        _write_json(staging / "manifest.json", manifest)
        staged_errors = validate_static_directory(
            staging,
            max_as_of_age_days=max_as_of_age_days,
            min_stock_ratio=min_stock_ratio,
        )
        if staged_errors:
            raise RuntimeError("; ".join(staged_errors))
        _publish_directory(staging, output)
    finally:
        if staging.exists():
            shutil.rmtree(staging)

    # The seed is what the API serves before its first live build, so it must
    # describe the same methodology and weights as the published snapshot.
    seed_written = False
    if seed_path is not None:
        seed_path.parent.mkdir(parents=True, exist_ok=True)
        _write_json(
            seed_path,
            {"stored_at": _now().timestamp(), "value": compact_payload},
        )
        seed_written = True

    return {
        "status": "updated",
        "generated_at": compact_payload["meta"]["generated_at"],
        "as_of": compact_payload["meta"]["as_of"],
        "stocks": len(stocks),
        "details": len(details),
        "bytes": publication_bytes + sum(stock_files.values()) + sum(backtest_bytes.values()),
        "seed": str(seed_path) if seed_written else None,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--max-as-of-age-days", type=int, default=10)
    parser.add_argument("--min-stock-ratio", type=float, default=0.95)
    parser.add_argument("--min-detail-ratio", type=float, default=0.98)
    parser.add_argument("--force", action="store_true")
    parser.add_argument("--previous-publication", type=Path, help="Previously deployed publication used to recover active portfolio state.")
    parser.add_argument("--validate-only", action="store_true")
    parser.add_argument(
        "--write-seed",
        action="store_true",
        help="Also refresh data-service/seed/publication.json from the same payload.",
    )
    args = parser.parse_args()

    output = args.output.resolve()
    if args.validate_only:
        errors = validate_static_directory(
            output,
            max_as_of_age_days=args.max_as_of_age_days,
            min_stock_ratio=args.min_stock_ratio,
        )
        if errors:
            print("Static data validation failed:", file=sys.stderr)
            for error in errors:
                print(f"- {error}", file=sys.stderr)
            return 1
        manifest = json.loads((output / "manifest.json").read_text())
        print(
            "Static data valid: "
            f"{manifest['stockCount']} stocks, as-of {manifest['asOf']}, "
            f"generated {manifest['generatedAt']}"
        )
        _set_github_output("data_status", "valid")
        _set_github_output("data_generated_at", manifest["generatedAt"])
        _set_github_output("data_as_of", manifest["asOf"])
        return 0

    try:
        previous_path = args.previous_publication or (output / "publication.json")
        try:
            previous_publication = json.loads(previous_path.read_text())
        except (OSError, json.JSONDecodeError):
            previous_publication = None
        if isinstance(previous_publication, dict) and isinstance(previous_publication.get("value"), dict):
            previous_publication = previous_publication["value"]
        if previous_publication is None:
            raise RuntimeError("previous validated publication is unavailable; refusing to form a replacement portfolio")
        result = build_static(
            output,
            max_as_of_age_days=args.max_as_of_age_days,
            min_stock_ratio=args.min_stock_ratio,
            min_detail_ratio=args.min_detail_ratio,
            force=args.force,
            seed_path=DEFAULT_SEED if args.write_seed else None,
            previous_publication=previous_publication,
        )
        print(json.dumps(result, indent=2))
        _set_github_output("data_status", result["status"])
        _set_github_output("data_generated_at", result["generated_at"])
        _set_github_output("data_as_of", result["as_of"])
        return 0
    except Exception as exc:  # noqa: BLE001 - preserve the last valid snapshot
        print(f"Static data update failed: {type(exc).__name__}: {exc}", file=sys.stderr)
        existing_errors = validate_static_directory(
            output,
            max_as_of_age_days=args.max_as_of_age_days,
            min_stock_ratio=args.min_stock_ratio,
        )
        if existing_errors:
            for error in existing_errors:
                print(f"- {error}", file=sys.stderr)
            _set_github_output("data_status", "failed")
            return 1
        manifest = json.loads((output / "manifest.json").read_text())
        print(
            "Preserved the previous valid static snapshot at "
            f"{manifest['generatedAt']} (market as-of {manifest['asOf']})."
        )
        _set_github_output("data_status", "preserved")
        _set_github_output("data_generated_at", manifest["generatedAt"])
        _set_github_output("data_as_of", manifest["asOf"])
        return 0


if __name__ == "__main__":
    raise SystemExit(main())
