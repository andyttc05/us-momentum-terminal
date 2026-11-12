"""NYSE session clock and data-timeliness classification."""

from __future__ import annotations

from datetime import datetime, time, timezone
from zoneinfo import ZoneInfo

import exchange_calendars as xcals
import pandas as pd

NY = ZoneInfo("America/New_York")
PRE_OPEN = time(4, 0)
POST_CLOSE = time(20, 0)
CALENDAR = xcals.get_calendar("XNYS")


def now_ny() -> datetime:
    return datetime.now(NY)


def market_state(moment: datetime | None = None) -> dict:
    moment = (moment or now_ny()).astimezone(NY)
    current = moment.time()
    session = pd.Timestamp(moment.date())
    is_trading_day = bool(CALENDAR.is_session(session))
    open_at = CALENDAR.session_open(session).tz_convert(NY) if is_trading_day else None
    close_at = CALENDAR.session_close(session).tz_convert(NY) if is_trading_day else None

    if is_trading_day and open_at <= moment < close_at:
        state, is_open = "open", True
    elif is_trading_day and PRE_OPEN <= current < open_at.time():
        state, is_open = "pre-market", False
    elif is_trading_day and close_at.time() <= current < POST_CLOSE:
        state, is_open = "after-hours", False
    else:
        state, is_open = "closed", False

    if state == "open":
        timeliness = "delayed"
        timeliness_note = "Intraday quotes from the provider are delayed (typically ~15 min)."
    elif state in {"pre-market", "after-hours"}:
        timeliness = "delayed"
        timeliness_note = "Extended-hours session; the last regular-session close is used for calculations."
    else:
        timeliness = "end-of-day"
        timeliness_note = "Market closed. Prices are the last regular-session close (end-of-day)."

    return {
        "state": state,
        "is_open": is_open,
        "timeliness": timeliness,
        "timeliness_note": timeliness_note,
        "session_date": moment.strftime("%Y-%m-%d"),
        "new_york_time": moment.strftime("%Y-%m-%d %H:%M %Z"),
        "utc": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    }
