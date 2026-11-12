"""Runtime configuration for the market data service.

API keys are read from environment variables (optionally seeded from a
git-ignored ``.env`` file at the repository root). Keys are never sent to the
browser: the SPA only ever talks to this service.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = ROOT / "data-service"
_cache_override = os.environ.get("DATA_CACHE_DIR", "").strip()
CACHE_DIR = Path(_cache_override) if _cache_override else DATA_DIR / "cache"
DOCS_DIR = DATA_DIR / "docs"


def load_dotenv(path: Path | None = None) -> None:
    """Minimal .env loader (KEY=VALUE, # comments). Existing env wins."""
    path = path or ROOT / ".env"
    if not path.exists():
        return
    for raw in path.read_text().splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        os.environ.setdefault(key, value)


load_dotenv()


def _int(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, default))
    except (TypeError, ValueError):
        return default


@dataclass(frozen=True)
class Settings:
    host: str = os.environ.get("DATA_SERVICE_HOST", "127.0.0.1")
    port: int = _int("DATA_SERVICE_PORT", 8787)

    # Provider credentials (all optional; a missing key disables that provider).
    fmp_api_key: str = os.environ.get("FMP_API_KEY", "")
    alpha_vantage_api_key: str = os.environ.get("ALPHAVANTAGE_API_KEY", "")
    finnhub_api_key: str = os.environ.get("FINNHUB_API_KEY", "")
    twelve_data_api_key: str = os.environ.get("TWELVEDATA_API_KEY", "")
    polygon_api_key: str = os.environ.get("POLYGON_API_KEY", "")

    # Failover order. Only providers that are actually usable in this process
    # are kept; the first entry becomes the primary source.
    provider_chain: tuple[str, ...] = field(
        default_factory=lambda: tuple(
            part.strip()
            for part in os.environ.get("DATA_PROVIDER_CHAIN", "yahoo,twelvedata,fmp").split(",")
            if part.strip()
        )
    )

    request_timeout: int = _int("DATA_REQUEST_TIMEOUT", 25)
    history_years: int = _int("DATA_HISTORY_YEARS", 10)
    max_workers: int = _int("DATA_MAX_WORKERS", 8)
    history_batch_size: int = _int("DATA_HISTORY_BATCH_SIZE", 40)
    history_batch_workers: int = _int("DATA_HISTORY_BATCH_WORKERS", 2)
    series_fetch_workers: int = _int("DATA_SERIES_FETCH_WORKERS", 4)
    quote_fetch_workers: int = _int("DATA_QUOTE_WORKERS", 4)
    retry_attempts: int = _int("DATA_RETRY_ATTEMPTS", 2)
    retry_base_seconds: float = float(os.environ.get("DATA_RETRY_BASE_SECONDS", "0.75"))
    warm_error_cooldown: int = _int("DATA_WARM_ERROR_COOLDOWN", 30)

    # Cache TTLs in seconds.
    ttl_bars_intraday: int = _int("DATA_TTL_BARS_INTRADAY", 900)       # 15 min while the market is open
    ttl_bars_closed: int = _int("DATA_TTL_BARS_CLOSED", 21_600)        # 6 h after the close
    ttl_meta: int = _int("DATA_TTL_META", 86_400)                      # 24 h for name/sector/market cap
    ttl_snapshot: int = _int("DATA_TTL_SNAPSHOT", 900)
    ttl_probe: int = _int("DATA_TTL_PROBE", 600)

    def keys_present(self) -> dict[str, bool]:
        return {
            "FMP_API_KEY": bool(self.fmp_api_key),
            "ALPHAVANTAGE_API_KEY": bool(self.alpha_vantage_api_key),
            "FINNHUB_API_KEY": bool(self.finnhub_api_key),
            "TWELVEDATA_API_KEY": bool(self.twelve_data_api_key),
            "POLYGON_API_KEY": bool(self.polygon_api_key),
        }


settings = Settings()
CACHE_DIR.mkdir(parents=True, exist_ok=True)
