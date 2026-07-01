from __future__ import annotations

from datetime import datetime, timezone

from psycopg.rows import dict_row

from .config import settings
from .db import db_connection


def main() -> None:
    max_age_seconds = max(7200, settings.weather_ingestion_interval_seconds * 4)
    with db_connection() as conn:
        with conn.cursor(row_factory=dict_row) as cur:
            row = cur.execute(
                """
                SELECT "status", "startedAt", "completedAt", "message"
                FROM "DataRefreshLog"
                WHERE "source" = 'weather-worker'
                ORDER BY "startedAt" DESC
                LIMIT 1
                """
            ).fetchone()
    if row is None:
        raise SystemExit("No weather-worker heartbeat found.")

    now = datetime.now(timezone.utc)
    status = str(row["status"])
    if status == "running":
        age = (now - ensure_utc(row["startedAt"])).total_seconds()
        if age <= max_age_seconds:
            print(f"weather-worker healthy: running for {int(age)}s")
            return
        raise SystemExit(f"weather-worker has been running for {int(age)}s, over max {max_age_seconds}s.")

    if status not in {"success", "degraded"} or row["completedAt"] is None:
        raise SystemExit(f"weather-worker latest status is {status}: {row['message']}")

    age = (now - ensure_utc(row["completedAt"])).total_seconds()
    if age > max_age_seconds:
        raise SystemExit(f"weather-worker latest completed heartbeat is {int(age)}s old, over max {max_age_seconds}s.")
    print(f"weather-worker healthy: latest {status} {int(age)}s ago")


def ensure_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


if __name__ == "__main__":
    main()
