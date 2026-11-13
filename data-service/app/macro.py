"""Dated U.S. CPI data used by the inflation-adjusted backtest.

The official CPI-U All Items series is distributed by FRED as ``CPIAUCNS``.
Monthly observations are intentionally not treated as known before they were
published: the publication timestamp used for reporting is the conservative
15th day of the following month. This avoids using a monthly print at an
earlier daily portfolio valuation than the publication convention permits.
"""

from __future__ import annotations

import csv
import io
import subprocess
import threading
from datetime import date, datetime, timedelta, timezone

from . import cache

CPI_SERIES_ID = "CPIAUCNS"
CPI_SOURCE_URL = (
    "https://fred.stlouisfed.org/graph/fredgraph.csv"
    f"?id={CPI_SERIES_ID}"
)
CPI_CACHE_NAMESPACE = "macro"
CPI_CACHE_KEY = "cpi_cpiaucns"
CPI_CACHE_TTL_SECONDS = 7 * 24 * 60 * 60
PUBLICATION_LAG_DAYS = 15

_LOAD_LOCK = threading.Lock()


def _month_after(value: date) -> date:
    if value.month == 12:
        return date(value.year + 1, 1, 1)
    return date(value.year, value.month + 1, 1)


def _available_from(observation_date: date) -> date:
    first_of_next_month = _month_after(observation_date)
    return first_of_next_month + timedelta(days=PUBLICATION_LAG_DAYS - 1)


def _month_key(value: date) -> str:
    return value.strftime("%Y-%m")


def parse_cpi_csv(text: str, *, start: date = date(2017, 1, 1)) -> dict:
    """Parse, validate and describe the official FRED CSV response.

    Rows outside ``start`` are ignored. Invalid or non-positive observations
    are rejected rather than coerced. The returned ``missing_months`` list is
    empty only when every month through the latest observation is present.
    """
    reader = csv.DictReader(io.StringIO(text))
    if not reader.fieldnames or "observation_date" not in reader.fieldnames:
        raise ValueError("CPI response is missing observation_date")
    value_column = CPI_SERIES_ID if CPI_SERIES_ID in reader.fieldnames else reader.fieldnames[1]
    by_month: dict[str, dict] = {}
    rejected: list[dict] = []
    for row in reader:
        raw_date = str(row.get("observation_date") or "").strip()
        raw_value = str(row.get(value_column) or "").strip()
        try:
            observed = date.fromisoformat(raw_date)
            value = float(raw_value)
        except (TypeError, ValueError):
            if raw_date:
                rejected.append({"date": raw_date, "value": raw_value})
            continue
        if observed < start or value <= 0:
            if observed >= start:
                rejected.append({"date": raw_date, "value": raw_value})
            continue
        month_start = date(observed.year, observed.month, 1)
        by_month[_month_key(month_start)] = {
            "date": month_start.isoformat(),
            "value": round(value, 6),
            "available_from": _available_from(month_start).isoformat(),
        }

    observations = [by_month[key] for key in sorted(by_month)]
    if not observations:
        raise ValueError("CPI response contains no valid observations")

    first_month = date.fromisoformat(observations[0]["date"])
    last_month = date.fromisoformat(observations[-1]["date"])
    present = set(by_month)
    expected = []
    cursor = first_month
    while cursor <= last_month:
        expected.append(_month_key(cursor))
        cursor = _month_after(cursor)

    return {
        "available": True,
        "source": "U.S. Bureau of Labor Statistics via FRED",
        "series_id": CPI_SERIES_ID,
        "series_url": CPI_SOURCE_URL,
        "observations": observations,
        "first_observation": observations[0]["date"],
        "latest_observation": observations[-1]["date"],
        "missing_months": [key for key in expected if key not in present],
        "rejected_rows": rejected[:50],
        "rejected_row_count": len(rejected),
        "publication_alignment": (
            "Monthly CPI-U observations become available to portfolio reporting "
            "on the 15th day of the following month."
        ),
    }


def _fetch_csv(url: str, timeout: float = 30.0) -> str:
    # curl is already available in the deployment image and follows the same
    # HTTP/2 path used by the provider probes. Python's two HTTP clients can
    # stall against this endpoint's edge response despite a successful curl.
    result = subprocess.run(
        [
            "curl",
            "--location",
            "--fail",
            "--silent",
            "--show-error",
            "--max-time",
            str(max(1, int(timeout))),
            url,
        ],
        capture_output=True,
        check=True,
        text=True,
        timeout=timeout + 3,
    )
    return result.stdout


def load_cpi(*, force: bool = False, start: date = date(2017, 1, 1)) -> dict:
    """Load CPI from cache, refreshing weekly with a stale-cache fallback."""
    with _LOAD_LOCK:
        if not force:
            cached = cache.read(CPI_CACHE_NAMESPACE, CPI_CACHE_KEY, CPI_CACHE_TTL_SECONDS)
            if cached:
                return {**cached, "cache_state": "fresh", "cached": True}

        try:
            parsed = parse_cpi_csv(_fetch_csv(CPI_SOURCE_URL), start=start)
            payload = {
                **parsed,
                "retrieved_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                "cache_state": "fresh",
                "cached": False,
            }
            cache.write(CPI_CACHE_NAMESPACE, CPI_CACHE_KEY, payload)
            return payload
        except Exception as exc:  # noqa: BLE001 - stale cache is the intended fallback
            stale = cache.read_stale(CPI_CACHE_NAMESPACE, CPI_CACHE_KEY)
            if stale:
                return {
                    **stale,
                    "available": True,
                    "cache_state": "cached",
                    "cached": True,
                    "refresh_error": f"{type(exc).__name__}: {exc}"[:240],
                }
            return {
                "available": False,
                "source": "U.S. Bureau of Labor Statistics via FRED",
                "series_id": CPI_SERIES_ID,
                "series_url": CPI_SOURCE_URL,
                "observations": [],
                "missing_months": [],
                "cache_state": "unavailable",
                "cached": False,
                "error": f"{type(exc).__name__}: {exc}"[:240],
            }
