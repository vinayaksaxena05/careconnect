from datetime import datetime, timezone
import logging
import math
import re

from postgrest.exceptions import APIError

logger = logging.getLogger("careconnect")


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def visible_until_iso(two_hours_ms: int) -> str:
    from datetime import timedelta

    return (datetime.now(timezone.utc) + timedelta(milliseconds=two_hours_ms)).isoformat()


def is_optional_column_schema_error(err: Exception) -> bool:
    m = ""
    if isinstance(err, APIError):
        m = str(getattr(err, "message", None) or err)
    else:
        m = str(getattr(err, "message", None) or err)
    return bool(
        re.search(r"schema cache", m, re.I)
        or re.search(r"could not find .* column", m, re.I)
        or (re.search(r"column", m, re.I) and re.search(r"does not exist", m, re.I))
    )


def is_open_emergency_status(status) -> bool:
    s = str(status or "").lower()
    return s in ("open", "dispatched")


def parse_ms(value) -> int | None:
    """Parse an ISO timestamp (as stored/returned by Supabase) to epoch ms."""
    if value is None:
        return None
    try:
        return int(
            datetime.fromisoformat(str(value).replace("Z", "+00:00")).timestamp() * 1000
        )
    except (TypeError, ValueError):
        return None


def is_row_visible(row: dict, now_ms: int, fallback_window_ms: int) -> bool:
    """True if a row is still within its visibility window.

    Prefers the `visible_until` column when present (set explicitly at
    creation time); falls back to `created_at` + a fixed window for rows
    written before that column existed (see is_optional_column_schema_error).
    """
    if "visible_until" in row:
        vu = row.get("visible_until")
        return vu is None or (parse_ms(vu) or 0) > now_ms
    created_ms = parse_ms(row.get("created_at"))
    return created_ms is not None and created_ms >= now_ms - fallback_window_ms


def is_pending_request_status(status) -> bool:
    s = str(status or "").lower()
    return s in ("requested", "confirmed", "in_progress")


def api_error_code(err: Exception) -> str | None:
    return getattr(err, "code", None)


def err_message(err: Exception) -> str:
    if isinstance(err, APIError):
        return str(getattr(err, "message", None) or err)
    return str(getattr(err, "message", None) or err)


def round1(n: float) -> float:
    return math.floor(n * 10 + 0.5) / 10


def single_row(resp) -> dict | None:
    """Extract one row from a postgrest response after insert/update/select.

    postgrest-py's `.single()` only exists on the read-only select builder,
    not after `.insert()`/`.update()` (unlike the JS client, where it does).
    Callers instead do `.insert(...).select(...)` / `.update(...).select()`
    without `.single()` and pass the `execute()` result through here.
    """
    data = resp.data
    if isinstance(data, list):
        return data[0] if data else None
    return data
