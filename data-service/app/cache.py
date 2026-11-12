"""Small JSON disk cache with per-entry TTL and atomic writes."""

from __future__ import annotations

import json
import os
import tempfile
import threading
import time
from pathlib import Path
from typing import Any

from .config import CACHE_DIR

_lock = threading.Lock()


def _path(namespace: str, key: str) -> Path:
    safe = key.replace("/", "_").replace(":", "_")
    directory = CACHE_DIR / namespace
    directory.mkdir(parents=True, exist_ok=True)
    return directory / f"{safe}.json"


def read(namespace: str, key: str, ttl: float) -> Any | None:
    path = _path(namespace, key)
    if not path.exists():
        return None
    try:
        payload = json.loads(path.read_text())
    except (OSError, json.JSONDecodeError):
        return None
    stored_at = payload.get("stored_at", 0)
    if ttl >= 0 and time.time() - stored_at > ttl:
        return None
    return payload.get("value")


def write(namespace: str, key: str, value: Any) -> None:
    path = _path(namespace, key)
    payload = {"stored_at": time.time(), "value": value}
    with _lock:
        fd, tmp = tempfile.mkstemp(dir=str(path.parent), suffix=".tmp")
        try:
            with os.fdopen(fd, "w") as handle:
                json.dump(payload, handle)
            os.replace(tmp, path)
        except Exception:
            Path(tmp).unlink(missing_ok=True)
            raise


def stored_at(namespace: str, key: str) -> float | None:
    path = _path(namespace, key)
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text()).get("stored_at")
    except (OSError, json.JSONDecodeError):
        return None


def age_seconds(namespace: str, key: str) -> float | None:
    stored = stored_at(namespace, key)
    return None if stored is None else round(max(0.0, time.time() - stored), 1)


def read_stale(namespace: str, key: str) -> Any | None:
    """Return a cached value regardless of age (used only for diagnostics)."""
    return read(namespace, key, ttl=-1)


def write_bars(namespace: str, key: str, value: dict, min_retention: float = 0.95) -> bool:
    """Write a bar series unless it would replace a materially longer one.

    Providers occasionally return a truncated window (partial outage, plan
    downgrade). A short response must never overwrite a good, longer history,
    so the write is refused when the new series keeps less than
    ``min_retention`` of the previous row count.
    """
    previous = read_stale(namespace, key)
    new_count = len(value.get("bars") or [])
    old_count = len((previous or {}).get("bars") or [])
    if old_count and new_count < old_count * min_retention:
        return False
    write(namespace, key, value)
    return True
