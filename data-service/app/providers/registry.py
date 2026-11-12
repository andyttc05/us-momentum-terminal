"""Provider registry: ordered failover chain with health tracking.

Every dataset that leaves this module carries its provenance (provider id,
label, fetch timestamp, whether it came from a backup, and the attempts that
failed on the way). Nothing is ever silently substituted.
"""

from __future__ import annotations

import threading
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone

from ..config import settings
from ..models import (
    ProviderAuthError,
    ProviderBlocked,
    ProviderError,
    ProviderNoData,
    ProviderRateLimited,
    ProviderUnavailable,
    QuoteSnapshot,
    SeriesResult,
)
from .fmp import FmpProvider
from .stooq import StooqProvider
from .twelvedata import TwelveDataProvider
from .yahoo import YahooProvider

# After this many consecutive hard failures a provider is benched for a while so
# one dead source cannot make a 112-symbol refresh serialise into minutes.
TRIP_THRESHOLD = 3
TRIP_COOLDOWN_SECONDS = 180

_ALL: dict[str, type] = {
    "yahoo": YahooProvider,
    "stooq": StooqProvider,
    "twelvedata": TwelveDataProvider,
    "fmp": FmpProvider,
}


@dataclass
class Attempt:
    provider: str
    ok: bool
    error: str | None = None
    error_kind: str | None = None
    elapsed_ms: int = 0


@dataclass
class ResolvedSeries:
    result: SeriesResult
    primary: str
    used_backup: bool
    attempts: list[Attempt] = field(default_factory=list)


class ProviderRegistry:
    def __init__(self) -> None:
        self._adapters = {key: cls() for key, cls in _ALL.items()}
        self._health: dict[str, dict] = {}
        self._tripped_at: dict[str, float] = {}
        self._preferred: str | None = None
        self._lock = threading.Lock()
        self._load_preference()

    # -------------------------------------------------------------- preference
    def _state_file(self):
        from ..config import CACHE_DIR  # local import keeps config import-light

        return CACHE_DIR / "state.json"

    def _load_preference(self) -> None:
        """Restore the operator's provider choice across restarts."""
        import json

        try:
            payload = json.loads(self._state_file().read_text())
        except (OSError, ValueError):
            return
        preferred = payload.get("preferred_provider")
        if preferred in self._adapters:
            self._preferred = preferred

    def _save_preference(self) -> None:
        import json

        try:
            self._state_file().write_text(json.dumps({"preferred_provider": self._preferred}))
        except OSError:
            pass

    def preferred(self) -> str | None:
        return self._preferred

    def clear_preferred(self) -> None:
        with self._lock:
            self._preferred = None
        self._save_preference()

    def set_preferred(self, provider_id: str) -> str:
        """Make an available provider the primary source for subsequent builds."""
        adapter = self._adapters.get(provider_id)
        if adapter is None:
            raise ValueError(f"unknown provider '{provider_id}'")
        if not adapter.available():
            raise ValueError(f"{adapter.label} is not configured (missing API key)")
        if self._is_tripped(provider_id):
            raise ValueError(f"{adapter.label} is currently unavailable (circuit open after repeated failures)")
        with self._lock:
            self._preferred = provider_id
            # A fresh choice deserves a fresh attempt even if it tripped earlier.
            self._tripped_at.pop(provider_id, None)
            entry = self._health.get(provider_id)
            if entry:
                entry["consecutive_failures"] = 0
                entry["tripped"] = False
                if entry.get("status") == "unavailable (circuit open)":
                    entry["status"] = "untested"
        self._save_preference()
        return provider_id

    # ------------------------------------------------------------------ health
    def _is_tripped(self, provider_id: str) -> bool:
        tripped = self._tripped_at.get(provider_id)
        if tripped is None:
            return False
        if time.time() - tripped > TRIP_COOLDOWN_SECONDS:
            self._tripped_at.pop(provider_id, None)
            with self._lock:
                entry = self._health.setdefault(provider_id, {})
                entry["consecutive_failures"] = 0
            return False
        return True

    def _record(self, provider_id: str, ok: bool, error: str | None = None, kind: str | None = None, elapsed_ms: int = 0, fatal: bool = False) -> None:
        with self._lock:
            entry = self._health.setdefault(
                provider_id,
                {"status": "untested", "last_error": None, "last_success": None, "last_attempt": None,
                 "consecutive_failures": 0, "latency_ms": None},
            )
            entry["last_attempt"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
            if ok:
                entry.update(status="connected", last_error=None, consecutive_failures=0, latency_ms=elapsed_ms,
                             last_success=entry["last_attempt"])
            else:
                entry.update(status="error", last_error=error, error_kind=kind, latency_ms=elapsed_ms)
                entry["consecutive_failures"] = entry.get("consecutive_failures", 0) + 1
                if fatal and entry["consecutive_failures"] >= TRIP_THRESHOLD:
                    self._tripped_at[provider_id] = time.time()
                    entry["status"] = "unavailable (circuit open)"
                    entry["tripped"] = True

    def health(self, provider_id: str) -> dict:
        return dict(self._health.get(provider_id, {"status": "untested"}))

    # ------------------------------------------------------------------- chain
    def adapter(self, provider_id: str):
        return self._adapters.get(provider_id)

    def chain(self, include_tripped: bool = False) -> list[str]:
        """Configured order (with the operator's pick first), filtered to usable adapters."""
        order = list(settings.provider_chain)
        if self._preferred and self._preferred in order:
            order.remove(self._preferred)
            order.insert(0, self._preferred)
        usable = [pid for pid in order if pid in self._adapters and self._adapters[pid].available()]
        healthy = [pid for pid in usable if include_tripped or not self._is_tripped(pid)]
        # Never end up with nothing to try: fall back to the full list.
        return healthy or usable or ["yahoo"]

    def status(self) -> list[dict]:
        rows = []
        chain = self.chain()
        for pid, adapter in self._adapters.items():
            health = self.health(pid)
            rows.append(
                {
                    **adapter.status(),
                    "role": "primary" if chain and pid == chain[0] else ("backup" if pid in chain else "unconfigured"),
                    "enabled": adapter.available(),
                    "selectable": adapter.available() and not self._is_tripped(pid),
                    "active": bool(chain) and pid == chain[0],
                    "tripped": self._is_tripped(pid),
                    **health,
                }
            )
        return rows

    # ------------------------------------------------------------------ series
    def series(self, symbol: str, years: int | None = None) -> ResolvedSeries:
        """Fetch one symbol, walking the chain until a provider answers."""
        attempts: list[Attempt] = []
        chain = self.chain()
        last_error: Exception | None = None

        for index, provider_id in enumerate(chain):
            adapter = self._adapters[provider_id]
            started = time.perf_counter()
            try:
                result = adapter.fetch_series(symbol, years)
            except ProviderError as exc:
                elapsed = int((time.perf_counter() - started) * 1000)
                attempts.append(Attempt(provider_id, False, str(exc)[:200], type(exc).__name__, elapsed))
                fatal = not isinstance(exc, ProviderNoData)
                self._record(provider_id, False, str(exc)[:200], type(exc).__name__, elapsed, fatal=fatal)
                last_error = exc
                # Auth/blocked/no-data will not be fixed by retrying the same
                # provider for this symbol - move on immediately.
                continue
            except Exception as exc:  # noqa: BLE001 - defensive: never leak a stack trace to the API
                elapsed = int((time.perf_counter() - started) * 1000)
                attempts.append(Attempt(provider_id, False, f"{type(exc).__name__}: {exc}"[:200], "Unexpected", elapsed))
                self._record(provider_id, False, str(exc)[:200], "Unexpected", elapsed, fatal=True)
                last_error = ProviderUnavailable(str(exc))
                continue

            elapsed = int((time.perf_counter() - started) * 1000)
            attempts.append(Attempt(provider_id, True, elapsed_ms=elapsed))
            self._record(provider_id, True, elapsed_ms=elapsed)
            result.is_backup = index > 0
            return ResolvedSeries(result=result, primary=chain[0], used_backup=index > 0, attempts=attempts)

        raise last_error or ProviderNoData(f"no provider could supply {symbol}")

    def quote(self, symbol: str) -> tuple[QuoteSnapshot, str] | None:
        """Best-effort metadata. Failure is reported, never invented."""
        for provider_id in self.chain():
            adapter = self._adapters[provider_id]
            try:
                return adapter.fetch_quote(symbol), provider_id
            except (ProviderAuthError, ProviderBlocked, ProviderNoData, ProviderUnavailable, ProviderRateLimited):
                continue
            except Exception:  # noqa: BLE001
                continue
        return None

    def quotes(self, symbols: list[str]) -> dict[str, dict]:
        """Fetch metadata concurrently for the given symbols."""
        from concurrent.futures import ThreadPoolExecutor

        out: dict[str, dict] = {}

        def worker(symbol: str):
            resolved = self.quote(symbol)
            if not resolved:
                return symbol, None
            quote, provider_id = resolved
            return symbol, {**quote.__dict__, "provider": provider_id}

        with ThreadPoolExecutor(max_workers=settings.max_workers) as pool:
            for symbol, payload in pool.map(worker, symbols):
                if payload:
                    out[symbol] = payload
        return out


registry = ProviderRegistry()
