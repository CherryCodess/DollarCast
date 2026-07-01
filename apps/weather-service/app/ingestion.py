from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from typing import Iterable
from zoneinfo import ZoneInfo

from psycopg.rows import dict_row
from psycopg.types.json import Json
import httpx

from .config import settings
from .db import db_connection
from .grib import ModelPoint, load_grib_model_series
from .main import (
    ForecastPeriod,
    fetch_live_metar_temperature_f,
    first_number,
    load_nws_hourly_temperatures,
    parse_datetime,
    parse_event_date,
    resolve_timezone,
)


@dataclass(frozen=True)
class IngestionTarget:
    station_id: str
    latitude: float
    longitude: float
    timezone_name: str
    event_date: date | None


def load_ingestion_targets() -> list[IngestionTarget]:
    with db_connection() as conn:
        with conn.cursor(row_factory=dict_row) as cur:
            rows = cur.execute(
                """
                SELECT DISTINCT
                  COALESCE(km."stationId", wsm."stationId") AS station_id,
                  COALESCE(km."stationLatitude", wsm."latitude") AS latitude,
                  COALESCE(km."stationLongitude", wsm."longitude") AS longitude,
                  COALESCE(km."timezone", wsm."timezone") AS timezone_name,
                  km."eventDateLocal" AS event_date_local
                FROM "KalshiMarket" km
                LEFT JOIN "WeatherStationMapping" wsm
                  ON wsm."seriesTicker" = km."seriesTicker"
                WHERE km."marketType" IN ('daily_temperature', 'hourly_temperature')
                  AND km."parseStatus" = 'verified'
                  AND km."closeTime" >= NOW()
                  AND COALESCE(km."stationId", wsm."stationId") IS NOT NULL
                  AND COALESCE(km."stationLatitude", wsm."latitude") IS NOT NULL
                  AND COALESCE(km."stationLongitude", wsm."longitude") IS NOT NULL
                ORDER BY station_id
                LIMIT %s
                """,
                (settings.weather_worker_station_limit,),
            ).fetchall()

    targets: list[IngestionTarget] = []
    for row in rows:
        targets.append(
            IngestionTarget(
                station_id=str(row["station_id"]),
                latitude=float(row["latitude"]),
                longitude=float(row["longitude"]),
                timezone_name=str(row["timezone_name"] or "UTC"),
                event_date=parse_event_date(row["event_date_local"]),
            )
        )
    return targets


def fallback_targets_from_mappings() -> list[IngestionTarget]:
    with db_connection() as conn:
        with conn.cursor(row_factory=dict_row) as cur:
            rows = cur.execute(
                """
                SELECT DISTINCT "stationId", "latitude", "longitude", "timezone"
                FROM "WeatherStationMapping"
                WHERE "sourceConfidence" = 'verified'
                ORDER BY "stationId"
                LIMIT %s
                """,
                (settings.weather_worker_station_limit,),
            ).fetchall()
    today = datetime.now(timezone.utc).date()
    return [
        IngestionTarget(
            station_id=str(row["stationId"]),
            latitude=float(row["latitude"]),
            longitude=float(row["longitude"]),
            timezone_name=str(row["timezone"] or "UTC"),
            event_date=today,
        )
        for row in rows
    ]


def refresh_all_weather_inputs() -> dict[str, object]:
    started_at = datetime.now(timezone.utc)
    log_id = create_refresh_log(started_at)
    try:
        targets = load_ingestion_targets()
        if not targets:
            targets = fallback_targets_from_mappings()
        targets = dedupe_targets(targets)
        forecast_rows = 0
        observation_rows = 0
        warnings: list[str] = []
        for target in targets:
            result = refresh_target(target)
            forecast_rows += result["forecastRows"]
            observation_rows += result["observationRows"]
            warnings.extend(result["warnings"])
        completed_at = datetime.now(timezone.utc)
        update_refresh_log(
            log_id,
            "success",
            completed_at,
            f"Weather ingestion refreshed {len(targets)} station/date targets, {forecast_rows} forecast rows, {observation_rows} observation rows.",
            {
                "targetCount": len(targets),
                "forecastRows": forecast_rows,
                "observationRows": observation_rows,
                "warnings": warnings[:20],
            },
        )
        return {
            "status": "success",
            "targetCount": len(targets),
            "forecastRows": forecast_rows,
            "observationRows": observation_rows,
            "warnings": warnings[:20],
            "durationMs": int((completed_at - started_at).total_seconds() * 1000),
        }
    except Exception as exc:
        update_refresh_log(log_id, "error", datetime.now(timezone.utc), str(exc), None)
        raise


def refresh_all_observations() -> dict[str, object]:
    started_at = datetime.now(timezone.utc)
    targets = load_ingestion_targets()
    if not targets:
        targets = fallback_targets_from_mappings()
    targets = dedupe_targets_by_station(targets)
    warnings: list[str] = []
    observation_rows = refresh_observations_batch(targets, warnings)
    if observation_rows == 0:
        for target in targets:
            observation_rows += refresh_observation(target, warnings)
    completed_at = datetime.now(timezone.utc)
    return {
        "status": "success",
        "targetCount": len(targets),
        "observationRows": observation_rows,
        "warnings": warnings[:20],
        "durationMs": int((completed_at - started_at).total_seconds() * 1000),
    }


def dedupe_targets(targets: Iterable[IngestionTarget]) -> list[IngestionTarget]:
    by_key: dict[tuple[str, date | None], IngestionTarget] = {}
    for target in targets:
        by_key[(target.station_id, target.event_date)] = target
    return list(by_key.values())


def dedupe_targets_by_station(targets: Iterable[IngestionTarget]) -> list[IngestionTarget]:
    by_key: dict[str, IngestionTarget] = {}
    for target in targets:
        by_key[target.station_id] = target
    return list(by_key.values())


def refresh_target(target: IngestionTarget) -> dict[str, object]:
    warnings: list[str] = []
    tz = safe_zoneinfo(target.timezone_name)
    observation_rows = refresh_observation(target, warnings)
    forecast_hours = required_hours(target.event_date, tz)
    nws_periods, nws_warnings = load_nws_hourly_temperatures(target.latitude, target.longitude)
    warnings.extend(nws_warnings)
    nbm_series, hrrr_series = load_grib_model_series(target.latitude, target.longitude, forecast_hours)
    warnings.extend(nbm_series.warnings)
    warnings.extend(hrrr_series.warnings)
    rows = 0
    rows += store_nws_periods(target, nws_periods)
    rows += store_model_points(target, nbm_series.points, "NBM", "NOAA National Blend of Models GRIB2")
    rows += store_model_points(target, hrrr_series.points, "HRRR", "NOAA HRRR GRIB2")

    return {"forecastRows": rows, "observationRows": observation_rows, "warnings": warnings}


def refresh_observation(target: IngestionTarget, warnings: list[str]) -> int:
    observed = fetch_live_metar_temperature_f(target.station_id, warnings)
    if observed is None:
        return 0
    return store_observation(target.station_id, observed[0], observed[1])


def refresh_observations_batch(targets: list[IngestionTarget], warnings: list[str]) -> int:
    station_ids = sorted({target.station_id for target in targets if target.station_id and target.station_id != "UNKNOWN"})
    if not station_ids:
        return 0
    try:
        with httpx.Client(timeout=20, follow_redirects=True) as client:
            response = client.get(
                f"{settings.aviation_weather_api_base}/metar",
                params={"ids": ",".join(station_ids), "format": "json"},
            )
            response.raise_for_status()
            payload = response.json()
    except Exception as exc:
        warnings.append(f"METAR batch observation unavailable: {exc}")
        return 0

    records = payload if isinstance(payload, list) else [payload]
    rows = 0
    for record in records:
        if not isinstance(record, dict):
            continue
        station_id = str(record.get("icaoId") or record.get("icao") or record.get("station_id") or "").upper()
        if station_id not in station_ids:
            continue
        temp_c = first_number(record, ("temp", "temp_c", "tempC", "temperature", "temperature_c"))
        obs_time = parse_datetime(record.get("obsTime") or record.get("reportTime") or record.get("receiptTime") or record.get("report_time"))
        if temp_c is None or obs_time is None:
            warnings.append(f"METAR observation unavailable: temperature or observation time missing for {station_id}.")
            continue
        rows += store_observation(station_id, float(temp_c) * 9 / 5 + 32, obs_time)
    if rows == 0:
        warnings.append("METAR batch returned no parseable station observations.")
    return rows


def safe_zoneinfo(name: str) -> ZoneInfo:
    try:
        return ZoneInfo(name)
    except Exception:
        return ZoneInfo("UTC")


def required_hours(event_date: date | None, tz: ZoneInfo) -> int:
    if event_date is None:
        return 36
    end = datetime.combine(event_date, datetime.max.time(), tzinfo=tz)
    return max(1, min(72, int((end - datetime.now(tz)).total_seconds() // 3600) + 6))


def store_nws_periods(target: IngestionTarget, periods: list[ForecastPeriod]) -> int:
    rows = 0
    run_time = datetime.now(timezone.utc).replace(microsecond=0)
    source_url = f"{settings.nws_api_base}/points/{target.latitude:.4f},{target.longitude:.4f}"
    points = [(start, temp) for start, temp in periods if start is not None]
    with db_connection() as conn:
        for index, (valid_time, temp_f) in enumerate(points[:72]):
            conn.execute(
                """
                INSERT INTO "WeatherForecastRun" (
                  "id", "modelName", "modelVersion", "runTimeUtc", "forecastHour", "validTimeUtc",
                  "sourceUrl", "stationId", "latitude", "longitude", "temperatureC", "temperatureF", "createdAt", "rawPayload"
                ) VALUES (
                  gen_random_uuid()::text, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, NOW(), %s
                )
                """,
                (
                    "NWS",
                    "api.weather.gov hourly",
                    run_time,
                    index,
                    valid_time.astimezone(timezone.utc),
                    source_url,
                    target.station_id,
                    target.latitude,
                    target.longitude,
                    (float(temp_f) - 32) * 5 / 9,
                    float(temp_f),
                    Json({"source": "weather-worker", "timezone": target.timezone_name}),
                ),
            )
            rows += 1
    return rows


def store_model_points(target: IngestionTarget, points: list[ModelPoint], model_name: str, model_version: str) -> int:
    rows = 0
    with db_connection() as conn:
        for point in points:
            conn.execute(
                """
                INSERT INTO "WeatherForecastRun" (
                  "id", "modelName", "modelVersion", "runTimeUtc", "forecastHour", "validTimeUtc",
                  "sourceUrl", "stationId", "latitude", "longitude", "temperatureC", "temperatureF", "createdAt", "rawPayload"
                ) VALUES (
                  gen_random_uuid()::text, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, NOW(), %s
                )
                """,
                (
                    model_name,
                    model_version,
                    point.run_time_utc,
                    point.forecast_hour,
                    point.valid_time_utc,
                    point.source_url,
                    target.station_id,
                    target.latitude,
                    target.longitude,
                    (point.temperature_f - 32) * 5 / 9,
                    point.temperature_f,
                    Json({"source": "weather-worker", "sourceUrl": point.source_url}),
                ),
            )
            rows += 1
    return rows


def store_observation(station_id: str, temperature_f: float, observed_at: datetime) -> int:
    source_url = f"{settings.aviation_weather_api_base}/metar?ids={station_id}&format=json"
    with db_connection() as conn:
        conn.execute(
            """
            INSERT INTO "WeatherObservation" (
              "id", "stationId", "observedAt", "temperatureF", "sourceUrl", "rawPayload", "createdAt"
            ) VALUES (
              gen_random_uuid()::text, %s, %s, %s, %s, %s, NOW()
            )
            """,
            (
                station_id,
                observed_at.astimezone(timezone.utc),
                temperature_f,
                source_url,
                Json({"source": "weather-worker"}),
            ),
        )
    return 1


def create_refresh_log(started_at: datetime) -> str:
    with db_connection() as conn:
        with conn.cursor(row_factory=dict_row) as cur:
            row = cur.execute(
                """
                INSERT INTO "DataRefreshLog" ("id", "source", "status", "startedAt")
                VALUES (gen_random_uuid()::text, 'weather-worker', 'running', %s)
                RETURNING "id"
                """,
                (started_at,),
            ).fetchone()
    return str(row["id"])


def update_refresh_log(log_id: str, status: str, completed_at: datetime, message: str, payload: dict[str, object] | None) -> None:
    with db_connection() as conn:
        conn.execute(
            """
            UPDATE "DataRefreshLog"
            SET "status" = %s, "completedAt" = %s, "message" = %s, "rawPayload" = %s
            WHERE "id" = %s
            """,
            (status, completed_at, message, Json(payload) if payload is not None else None, log_id),
        )
