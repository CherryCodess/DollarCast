from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from typing import Iterable
from zoneinfo import ZoneInfo

from fastapi import FastAPI
import httpx
from psycopg.rows import dict_row

from .config import settings
from .db import db_connection
from .grib import ModelSeries, load_grib_model_series
from .models import ForecastGroupRequest, MarketProbability, SourceLink
from .probability import cap_finite_simulation_probability, probability_for_range, simulate_paths, summarize
from .sources import source_links

app = FastAPI(title="$cast weather service", version="0.1.0")

DistributionCacheValue = tuple[list[float], dict[str, float], list[str], list[SourceLink]]
distribution_cache: dict[str, tuple[datetime, DistributionCacheValue]] = {}
nws_cache: dict[str, tuple[datetime, tuple[list["ForecastPeriod"], list[str]]]] = {}
metar_cache: dict[str, tuple[datetime, tuple[float, datetime] | None]] = {}


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "weather-service"}


@app.get("/ingestion/status")
def ingestion_status() -> dict[str, object]:
    try:
        with db_connection() as conn:
            with conn.cursor(row_factory=dict_row) as cur:
                latest = cur.execute(
                    """
                    SELECT "status", "startedAt", "completedAt", "message", "rawPayload"
                    FROM "DataRefreshLog"
                    WHERE "source" = 'weather-worker'
                    ORDER BY "startedAt" DESC
                    LIMIT 1
                    """
                ).fetchone()
                counts = cur.execute(
                    """
                    SELECT "modelName", COUNT(*) AS count, MAX("createdAt") AS "latestCreatedAt", MAX("runTimeUtc") AS "latestRunTimeUtc"
                    FROM "WeatherForecastRun"
                    WHERE "createdAt" >= NOW() - (%s || ' seconds')::interval
                    GROUP BY "modelName"
                    ORDER BY "modelName"
                    """,
                    (settings.forecast_cache_max_age_seconds,),
                ).fetchall()
                observations = cur.execute(
                    """
                    SELECT COUNT(*) AS count, MAX("createdAt") AS "latestCreatedAt", MAX("observedAt") AS "latestObservedAt"
                    FROM "WeatherObservation"
                    WHERE "createdAt" >= NOW() - (%s || ' seconds')::interval
                    """,
                    (int(settings.observation_refresh_seconds * settings.stale_observation_factor),),
                ).fetchone()
    except Exception as exc:
        return {"status": "unavailable", "error": str(exc)}
    return {
        "status": latest["status"] if latest else "unavailable",
        "startedAt": latest["startedAt"].isoformat() if latest and latest["startedAt"] else None,
        "completedAt": latest["completedAt"].isoformat() if latest and latest["completedAt"] else None,
        "message": latest["message"] if latest else "No weather-worker refresh has completed.",
        "payload": latest["rawPayload"] if latest else None,
        "recentForecastRowsByModel": {row["modelName"]: row["count"] for row in counts},
        "sourceFreshness": {
            row["modelName"]: {
                "recentRows": row["count"],
                "latestCreatedAt": row["latestCreatedAt"].isoformat() if row["latestCreatedAt"] else None,
                "latestRunTimeUtc": row["latestRunTimeUtc"].isoformat() if row["latestRunTimeUtc"] else None,
            }
            for row in counts
        },
        "metarFreshness": {
            "recentRows": observations["count"] if observations else 0,
            "latestCreatedAt": observations["latestCreatedAt"].isoformat() if observations and observations["latestCreatedAt"] else None,
            "latestObservedAt": observations["latestObservedAt"].isoformat() if observations and observations["latestObservedAt"] else None,
        },
    }


@app.get("/forecast/market/{market_ticker}", response_model=MarketProbability)
def forecast_market(
    market_ticker: str,
    latitude: float | None = None,
    longitude: float | None = None,
    station_id: str = "UNKNOWN",
    market_type: str = "daily_temperature",
    direction: str = "high",
    lower_f: float | None = None,
    upper_f: float | None = None,
    lower_inclusive: bool = True,
    upper_inclusive: bool = True,
    event_date_local: str | None = None,
    event_hour_local: str | None = None,
    timezone_name: str | None = None,
    simulation_limit: int = 1000,
) -> MarketProbability:
    event_date = parse_event_date(event_date_local)
    target_values, model_inputs, warnings, model_source_links = get_or_build_distribution(
        latitude,
        longitude,
        station_id,
        market_type,
        direction,
        event_date,
        event_date_local,
        event_hour_local,
        timezone_name,
    )
    warnings = [*warnings]
    raw_yes = probability_for_range(target_values, lower_f, upper_f, lower_inclusive, upper_inclusive)
    yes, probability_warning = cap_finite_simulation_probability(raw_yes, len(target_values))
    if probability_warning:
        warnings.append(probability_warning)
    summary = summarize(target_values)
    confidence = probability_confidence(market_type, event_hour_local, event_date, model_inputs, warnings)
    return MarketProbability(
        marketTicker=market_ticker,
        yesProbability=yes,
        noProbability=1 - yes,
        confidence=confidence,
        uncertaintyF=settings.sigma_daily_f + settings.sigma_hourly_f,
        modelInputs=model_inputs,
        reasons=[
            "Loaded NOAA NBM and HRRR GRIB2 temperature fields for the settlement station coordinates when available.",
            "Loaded real NWS hourly forecast temperatures for the settlement station coordinates as official forecast context and fallback.",
            "Blended available NBM, HRRR, and NWS forecast hours before simulation.",
            "Filtered forecast hours to the contract local date or exact contract hour when those terms were available.",
            "Generated a correlated hourly temperature distribution, then evaluated the exact contract interval with Kalshi-style strict/inclusive threshold handling.",
            "Conditioned same-day daily high/low outcomes on the latest METAR temperature when a current station observation was available.",
        ],
        warnings=warnings,
        sourceLinks=[*source_links(market_ticker, station_id, latitude, longitude), *model_source_links],
        simulation={"temperaturesF": target_values[:max(0, min(simulation_limit, len(target_values)))]},
        **summary,
    )


@app.post("/forecast/group", response_model=list[MarketProbability])
def forecast_group(request: ForecastGroupRequest) -> list[MarketProbability]:
    event_date = parse_event_date(request.eventDateLocal)
    target_values, model_inputs, warnings, model_source_links = get_or_build_distribution(
        request.latitude,
        request.longitude,
        request.stationId,
        request.marketType,
        request.direction,
        event_date,
        request.eventDateLocal,
        request.eventHourLocal,
        request.timezoneName,
    )
    warnings = [*warnings]
    summary = summarize(target_values)
    confidence = probability_confidence(request.marketType, request.eventHourLocal, event_date, model_inputs, warnings)
    simulation = {"temperaturesF": target_values[:max(0, min(request.simulationLimit, len(target_values)))]}
    links = [*source_links("group-forecast", request.stationId, request.latitude, request.longitude), *model_source_links]
    reasons = [
        "Loaded one shared station/date forecast distribution for this correlated event group.",
        "Evaluated each Kalshi interval against the same simulated temperature distribution.",
        "Used the same NBM/HRRR/NWS/METAR inputs as the single-market forecast endpoint.",
    ]
    out: list[MarketProbability] = []
    for market in request.markets:
        raw_yes = probability_for_range(target_values, market.lowerF, market.upperF, market.lowerInclusive, market.upperInclusive)
        yes, probability_warning = cap_finite_simulation_probability(raw_yes, len(target_values))
        market_warnings = [*warnings]
        if probability_warning:
            market_warnings.append(probability_warning)
        out.append(MarketProbability(
            marketTicker=market.marketTicker,
            yesProbability=yes,
            noProbability=1 - yes,
            confidence=confidence,
            uncertaintyF=settings.sigma_daily_f + settings.sigma_hourly_f,
            modelInputs=model_inputs,
            reasons=reasons,
            warnings=market_warnings,
            sourceLinks=links,
            simulation=simulation,
            **summary,
        ))
    return out


def probability_confidence(
    market_type: str,
    event_hour_local: str | None,
    event_date: date | None,
    model_inputs: dict[str, float],
    warnings: list[str],
) -> str:
    has_blocking_issue = False
    if settings.monte_carlo_paths < 25000:
        has_blocking_issue = True
        warnings.append("Monte Carlo path count is below the configured production minimum.")
    if event_date is None:
        has_blocking_issue = True
    if market_type == "hourly_temperature" and event_hour_local is None:
        has_blocking_issue = True
    if has_timeframe_warning(warnings):
        has_blocking_issue = True
    if all_model_inputs_missing(model_inputs):
        warnings.append("No usable NBM, HRRR, or NWS forecast points were available; the probability estimate used fallback temperatures.")
        has_blocking_issue = True
    if has_freshness_blocking_warning(warnings):
        has_blocking_issue = True
    if has_blocking_issue:
        return "low"
    has_official_forecast = model_inputs.get("nwsWeight", 0.0) > 0
    has_grib_model = model_inputs.get("nbmWeight", 0.0) > 0 or model_inputs.get("hrrrWeight", 0.0) > 0
    if has_official_forecast and has_grib_model:
        return "high"
    return "medium"


def all_model_inputs_missing(model_inputs: dict[str, float]) -> bool:
    return (
        model_inputs.get("nbmWeight", 0.0) == 0
        and model_inputs.get("hrrrWeight", 0.0) == 0
        and model_inputs.get("nwsWeight", 0.0) == 0
    )


ForecastPeriod = tuple[datetime | None, float]


def get_or_build_distribution(
    latitude: float | None,
    longitude: float | None,
    station_id: str,
    market_type: str,
    direction: str,
    event_date: date | None,
    event_date_local: str | None,
    event_hour_local: str | None,
    timezone_name: str | None,
) -> DistributionCacheValue:
    cache_key = "|".join([
        f"{latitude:.4f}" if latitude is not None else "none",
        f"{longitude:.4f}" if longitude is not None else "none",
        station_id,
        market_type,
        direction,
        event_date_local or "",
        event_hour_local or "",
        timezone_name or "",
    ])
    cached = distribution_cache.get(cache_key)
    now = datetime.now(timezone.utc)
    if cached and cached[0] > now:
        target_values, model_inputs, warnings, links = cached[1]
        return target_values, model_inputs, [*warnings, "Forecast distribution loaded from in-memory cache."], links

    value = build_distribution(latitude, longitude, station_id, market_type, direction, event_date, event_hour_local, timezone_name)
    distribution_cache[cache_key] = (now + timedelta(seconds=900), value)
    return value


def build_distribution(
    latitude: float | None,
    longitude: float | None,
    station_id: str,
    market_type: str,
    direction: str,
    event_date: date | None,
    event_hour_local: str | None,
    timezone_name: str | None,
) -> DistributionCacheValue:
    warnings: list[str] = []
    tz = resolve_timezone(timezone_name, [])
    cached = load_cached_forecast_periods(station_id, event_date, tz)
    if cached is not None:
        forecast_periods, model_inputs, model_source_links, cache_warnings = cached
        warnings.extend(cache_warnings)
    else:
        nws_periods, nws_warnings = load_nws_hourly_temperatures(latitude, longitude)
        warnings.extend(nws_warnings)
        tz = resolve_timezone(timezone_name, nws_periods)
        nbm_series, hrrr_series = load_grib_model_series(latitude, longitude, required_forecast_hours(event_date, tz))
        warnings.extend(nbm_series.warnings)
        warnings.extend(hrrr_series.warnings)
        forecast_periods, model_inputs, model_source_links = build_blended_forecast_periods(nbm_series, hrrr_series, nws_periods, event_date, tz)
    hourly = select_hourly_window(forecast_periods, event_date, tz, warnings)
    observed = load_current_metar_temperature_f(station_id, warnings)
    used_observation = observation_applies(observed, event_date, tz)
    paths = simulate_paths(hourly, paths=min(settings.monte_carlo_paths, 25000))
    if market_type == "hourly_temperature":
        target_index = select_hourly_index(forecast_periods, hourly, event_date, event_hour_local, tz, warnings)
        target_values = [path[target_index] for path in paths]
    elif direction == "low":
        target_values = [condition_daily_low(min(path), observed, event_date, tz) for path in paths]
    else:
        target_values = [condition_daily_high(max(path), observed, event_date, tz) for path in paths]
    if latitude is None or longitude is None:
        warnings.append("NWS coordinates were not supplied; using fallback fixture-like forecast path.")
    if event_date is None:
        warnings.append("Contract local date could not be parsed; using the first available forecast window.")
    if market_type == "hourly_temperature" and event_hour_local is None:
        warnings.append("Contract local hour was not supplied; using the first available forecast hour.")
    return target_values, apply_observation_weight(model_inputs, used_observation), warnings, model_source_links


def load_cached_forecast_periods(
    station_id: str,
    event_date: date | None,
    tz: ZoneInfo,
) -> tuple[list[ForecastPeriod], dict[str, float], list[SourceLink], list[str]] | None:
    if not station_id or station_id == "UNKNOWN":
        return None
    now = datetime.now(timezone.utc)
    earliest_created_at = now - timedelta(seconds=settings.forecast_cache_max_age_seconds)
    fresh_cutoff = now - timedelta(seconds=int(settings.forecast_refresh_seconds * settings.stale_forecast_factor))
    if event_date is None:
        start_utc = now - timedelta(hours=2)
        end_utc = now + timedelta(hours=48)
    else:
        start_utc = datetime.combine(event_date, datetime.min.time(), tzinfo=tz).astimezone(timezone.utc)
        end_utc = datetime.combine(event_date, datetime.max.time(), tzinfo=tz).astimezone(timezone.utc)
    try:
        with db_connection() as conn:
            with conn.cursor(row_factory=dict_row) as cur:
                rows = cur.execute(
                    """
                    SELECT "modelName", "modelVersion", "runTimeUtc", "forecastHour", "validTimeUtc",
                           "sourceUrl", "temperatureF", "createdAt"
                    FROM "WeatherForecastRun"
                    WHERE "stationId" = %s
                      AND "validTimeUtc" >= %s
                      AND "validTimeUtc" <= %s
                      AND "createdAt" >= %s
                    ORDER BY "validTimeUtc" ASC, "createdAt" DESC
                    """,
                    (station_id, start_utc, end_utc, earliest_created_at),
                ).fetchall()
    except Exception:
        return None
    if not rows:
        return None

    by_time: dict[datetime, dict[str, float]] = {}
    latest_source_by_model: dict[str, dict[str, object]] = {}
    rows_by_model = {"nbm": 0, "hrrr": 0, "nws": 0}
    for row in rows:
        model = str(row["modelName"]).lower()
        if model not in {"nbm", "hrrr", "nws"}:
            continue
        rows_by_model[model] += 1
        valid_time = hour_key(row["validTimeUtc"])
        by_time.setdefault(valid_time, {})[model] = float(row["temperatureF"])
        current = latest_source_by_model.get(model)
        if current is None or row["createdAt"] > current["createdAt"]:
            latest_source_by_model[model] = dict(row)

    if not by_time:
        return None

    blended: list[ForecastPeriod] = []
    weight_totals = {"nbm": 0.0, "hrrr": 0.0, "nws": 0.0}
    used_rows = 0
    for valid_time in sorted(by_time):
        values = by_time[valid_time]
        weights = model_weights_for_valid_time(valid_time, event_date, tz, values.keys())
        total = sum(weights.values())
        if total <= 0:
            continue
        temp = sum(values[name] * weights[name] for name in weights) / total
        blended.append((valid_time, temp))
        used_rows += 1
        for name, weight in weights.items():
            weight_totals[name] += weight / total

    if not blended:
        return None

    links = [
        SourceLink(
            label=model_source_label(model),
            url=str(row["sourceUrl"]),
            sourceType=model,
            whyItMatters=model_source_why(model),
            observedAt=f"{row['runTimeUtc'].isoformat()} cached {row['createdAt'].isoformat()}",
        )
        for model, row in sorted(latest_source_by_model.items())
    ]
    divisor = max(1, used_rows)
    warnings = ["Forecast path loaded from Postgres weather-worker cache."]
    freshness_parts: list[str] = []
    for model in ("nbm", "hrrr", "nws"):
        row = latest_source_by_model.get(model)
        if row is None:
            freshness_parts.append(f"{model.upper()} missing")
            continue
        created_at = ensure_utc(row["createdAt"])
        state = "fresh" if created_at >= fresh_cutoff else "stale"
        freshness_parts.append(f"{model.upper()} {state} ({rows_by_model[model]} rows, cached {created_at.isoformat()})")
    warnings.append("Forecast source freshness: " + "; ".join(freshness_parts) + ".")
    if settings.require_fresh_nws and latest_source_by_model.get("nws") is None:
        warnings.append("Forecast freshness blocking: NWS hourly forecast is missing from the weather-worker cache.")
    elif settings.require_fresh_nws and ensure_utc(latest_source_by_model["nws"]["createdAt"]) < fresh_cutoff:
        warnings.append("Forecast freshness blocking: NWS hourly forecast is stale.")
    if settings.enable_grib_ingestion and settings.require_grib_when_enabled:
        has_fresh_grib = any(
            latest_source_by_model.get(model) is not None and ensure_utc(latest_source_by_model[model]["createdAt"]) >= fresh_cutoff
            for model in ("nbm", "hrrr")
        )
        if not has_fresh_grib:
            warnings.append("Forecast freshness blocking: no fresh NBM or HRRR GRIB forecast is available while GRIB ingestion is enabled.")
    return (
        blended,
        {
            "nbmWeight": weight_totals["nbm"] / divisor,
            "hrrrWeight": weight_totals["hrrr"] / divisor,
            "nwsWeight": weight_totals["nws"] / divisor,
            "observationsWeight": 0.0,
        },
        links,
        warnings,
    )


def ensure_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def model_source_label(model: str) -> str:
    if model == "nbm":
        return "NOAA NBM cached forecast"
    if model == "hrrr":
        return "NOAA HRRR cached forecast"
    return "NWS cached hourly forecast"


def model_source_why(model: str) -> str:
    if model == "nbm":
        return "NBM: blended NOAA forecast baseline precomputed by the weather worker"
    if model == "hrrr":
        return "HRRR: high-resolution short-term forecast precomputed by the weather worker"
    return "NWS: official hourly forecast context precomputed by the weather worker"


def required_forecast_hours(event_date: date | None, tz: ZoneInfo) -> int:
    if event_date is None:
        return 36
    now = datetime.now(tz)
    end = datetime.combine(event_date, datetime.max.time(), tzinfo=tz)
    return max(1, min(72, int((end - now).total_seconds() // 3600) + 6))


def build_blended_forecast_periods(
    nbm: ModelSeries,
    hrrr: ModelSeries,
    nws_periods: list[ForecastPeriod],
    event_date: date | None,
    tz: ZoneInfo,
) -> tuple[list[ForecastPeriod], dict[str, float], list[SourceLink]]:
    by_time: dict[datetime, dict[str, float]] = {}
    links: list[SourceLink] = []

    for point in nbm.points:
        key = hour_key(point.valid_time_utc)
        by_time.setdefault(key, {})["nbm"] = point.temperature_f
    for point in hrrr.points:
        key = hour_key(point.valid_time_utc)
        by_time.setdefault(key, {})["hrrr"] = point.temperature_f
    for start, temp in nws_periods:
        if start is not None:
            by_time.setdefault(hour_key(start), {})["nws"] = temp

    if nbm.points:
        links.append(model_source_link("NOAA NBM GRIB2", "nbm", nbm.points))
    if hrrr.points:
        links.append(model_source_link("NOAA HRRR GRIB2", "hrrr", hrrr.points))

    if not by_time:
        return nws_periods, {"nbmWeight": 0.0, "hrrrWeight": 0.0, "nwsWeight": 1.0, "observationsWeight": 0.0}, links

    blended: list[ForecastPeriod] = []
    weight_totals = {"nbm": 0.0, "hrrr": 0.0, "nws": 0.0}
    used_rows = 0
    for valid_time in sorted(by_time):
        if event_date is not None and valid_time.astimezone(tz).date() > event_date:
            continue
        values = by_time[valid_time]
        weights = model_weights_for_valid_time(valid_time, event_date, tz, values.keys())
        total = sum(weights.values())
        if total <= 0:
            continue
        temp = sum(values[name] * weights[name] for name in weights) / total
        blended.append((valid_time, temp))
        used_rows += 1
        for name, value in weights.items():
            weight_totals[name] += value / total

    if not blended:
        return nws_periods, {"nbmWeight": 0.0, "hrrrWeight": 0.0, "nwsWeight": 1.0, "observationsWeight": 0.0}, links

    divisor = max(1, used_rows)
    return (
        blended,
        {
            "nbmWeight": weight_totals["nbm"] / divisor,
            "hrrrWeight": weight_totals["hrrr"] / divisor,
            "nwsWeight": weight_totals["nws"] / divisor,
            "observationsWeight": 0.0,
        },
        links,
    )


def hour_key(value: datetime) -> datetime:
    return value.astimezone(timezone.utc).replace(minute=0, second=0, microsecond=0)


def model_weights_for_valid_time(valid_time: datetime, event_date: date | None, tz: ZoneInfo, available: Iterable[str]) -> dict[str, float]:
    available_set = set(available)
    hours_to_event = 36.0
    if event_date is not None:
        event_end = datetime.combine(event_date, datetime.max.time(), tzinfo=tz)
        hours_to_event = max(0.0, (event_end - datetime.now(tz)).total_seconds() / 3600)
    if hours_to_event <= 18:
        desired = {"nbm": 0.30, "hrrr": 0.50, "nws": 0.20}
    elif hours_to_event <= 36:
        desired = {"nbm": 0.65, "hrrr": 0.20, "nws": 0.15}
    else:
        desired = {"nbm": 0.80, "hrrr": 0.0, "nws": 0.20}
    return {name: weight for name, weight in desired.items() if name in available_set and weight > 0}


def apply_observation_weight(model_inputs: dict[str, float], used_observation: bool) -> dict[str, float]:
    if not used_observation:
        return model_inputs
    return {
        "nbmWeight": model_inputs["nbmWeight"] * 0.85,
        "hrrrWeight": model_inputs["hrrrWeight"] * 0.85,
        "nwsWeight": model_inputs["nwsWeight"] * 0.85,
        "observationsWeight": 0.15,
    }


def model_source_link(label: str, source_type: str, points: list[object]) -> SourceLink:
    first = points[0]
    last = points[-1]
    url = getattr(first, "source_url", "") or (settings.noaa_nbm_source_base if source_type == "nbm" else settings.noaa_hrrr_source_base)
    return SourceLink(
        label=label,
        url=url,
        sourceType=source_type,
        whyItMatters=f"{label}: direct NOAA GRIB2 temperature input sampled at the settlement station",
        observedAt=f"{getattr(first, 'run_time_utc').isoformat()} through f{getattr(last, 'forecast_hour'):02d}",
    )


def load_nws_hourly_temperatures(latitude: float | None, longitude: float | None) -> tuple[list[ForecastPeriod], list[str]]:
    fallback: list[ForecastPeriod] = [(None, temp) for temp in [72, 74, 77, 79, 80, 79, 76, 73]]
    if latitude is None or longitude is None:
        return fallback, ["NWS forecast unavailable: station coordinates missing."]
    cache_key = f"{latitude:.4f},{longitude:.4f}"
    now = datetime.now(timezone.utc)
    cached = nws_cache.get(cache_key)
    if cached and cached[0] > now:
        periods, warnings = cached[1]
        return periods, [*warnings]
    try:
        headers = {"User-Agent": "$cast local weather-market analytics"}
        with httpx.Client(timeout=4, headers=headers, follow_redirects=True) as client:
            point = client.get(f"{settings.nws_api_base}/points/{latitude:.4f},{longitude:.4f}")
            point.raise_for_status()
            hourly_url = point.json()["properties"]["forecastHourly"]
            hourly_response = client.get(hourly_url)
            hourly_response.raise_for_status()
            periods = hourly_response.json()["properties"]["periods"]
            temps: list[ForecastPeriod] = []
            for period in periods[:72]:
                if period.get("temperature") is None:
                    continue
                start_time = parse_datetime(period.get("startTime"))
                temps.append((start_time, float(period["temperature"])))
            if len(temps) >= 4:
                nws_cache[cache_key] = (now + timedelta(seconds=900), (temps, []))
                return temps, []
    except Exception as exc:
        warnings = [f"NWS forecast unavailable: {exc}"]
        nws_cache[cache_key] = (now + timedelta(seconds=60), (fallback, warnings))
        return fallback, warnings
    warnings = ["NWS forecast unavailable: no hourly temperatures returned."]
    nws_cache[cache_key] = (now + timedelta(seconds=60), (fallback, warnings))
    return fallback, warnings


def parse_datetime(value: object) -> datetime | None:
    if isinstance(value, (int, float)):
        try:
            return datetime.fromtimestamp(float(value), tz=timezone.utc)
        except (OverflowError, OSError, ValueError):
            return None
    if not isinstance(value, str) or not value:
        return None
    cleaned = value.strip()
    try:
        parsed = datetime.fromisoformat(cleaned.replace("Z", "+00:00"))
        return parsed if parsed.tzinfo is not None else parsed.replace(tzinfo=timezone.utc)
    except ValueError:
        pass
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M", "%Y%m%d%H%M", "%Y%m%d%H%M%S"):
        try:
            return datetime.strptime(cleaned, fmt).replace(tzinfo=timezone.utc)
        except ValueError:
            continue
    return None


def parse_event_date(value: str | None) -> date | None:
    if not value:
        return None
    cleaned = value.strip().replace(".", "")
    for fmt in ("%Y-%m-%d", "%b %d, %Y", "%B %d, %Y", "%d%b%y"):
        try:
            return datetime.strptime(cleaned, fmt).date()
        except ValueError:
            continue
    return None


def resolve_timezone(timezone_name: str | None, periods: list[ForecastPeriod]) -> ZoneInfo:
    if timezone_name:
        try:
            return ZoneInfo(timezone_name)
        except Exception:
            pass
    for start, _ in periods:
        if start is not None and start.tzinfo is not None:
            return ZoneInfo("UTC")
    return ZoneInfo("UTC")


def select_hourly_window(periods: list[ForecastPeriod], event_date: date | None, tz: ZoneInfo, warnings: list[str]) -> list[float]:
    if event_date is None:
        return [temp for _, temp in periods[:36]]
    selected = [
        temp
        for start, temp in periods
        if start is not None and start.astimezone(tz).date() == event_date
    ]
    if len(selected) >= 4:
        return selected
    warnings.append("NWS forecast did not include enough hours for the contract local date; using the first available forecast window.")
    return [temp for _, temp in periods[:36]]


def has_timeframe_warning(warnings: list[str]) -> bool:
    blocking_phrases = (
        "using the first available forecast window",
        "Contract local date could not be parsed",
        "Contract local hour was not supplied",
        "Exact hourly forecast timestamp was unavailable",
        "NWS forecast unavailable",
    )
    return any(any(phrase in warning for phrase in blocking_phrases) for warning in warnings)


def has_freshness_blocking_warning(warnings: list[str]) -> bool:
    return any("Forecast freshness blocking:" in warning for warning in warnings)


def parse_event_hour(value: str | None) -> int | None:
    if not value:
        return None
    cleaned = value.strip().upper().replace(".", "")
    for fmt in ("%I %p", "%I:%M %p", "%H:%M", "%H"):
        try:
            return datetime.strptime(cleaned, fmt).hour
        except ValueError:
            continue
    return None


def select_hourly_index(
    all_periods: list[ForecastPeriod],
    selected_temps: list[float],
    event_date: date | None,
    event_hour_local: str | None,
    tz: ZoneInfo,
    warnings: list[str],
) -> int:
    event_hour = parse_event_hour(event_hour_local)
    if event_date is None or event_hour is None:
        return 0
    matching_periods = [
        (start, temp)
        for start, temp in all_periods
        if start is not None and start.astimezone(tz).date() == event_date
    ]
    for index, (start, _) in enumerate(matching_periods):
        if start is not None and start.astimezone(tz).hour == event_hour:
            return min(index, len(selected_temps) - 1)
    warnings.append("Exact hourly forecast timestamp was unavailable; using the nearest available forecast hour.")
    if not matching_periods:
        return 0
    nearest_index = min(
        range(len(matching_periods)),
        key=lambda index: abs((matching_periods[index][0].astimezone(tz).hour if matching_periods[index][0] else 0) - event_hour),
    )
    return min(nearest_index, len(selected_temps) - 1)


def load_current_metar_temperature_f(station_id: str, warnings: list[str]) -> tuple[float, datetime] | None:
    if not station_id or station_id == "UNKNOWN":
        return None
    now = datetime.now(timezone.utc)
    cached = metar_cache.get(station_id)
    if cached and cached[0] > now:
        return cached[1]
    stored = load_cached_metar_temperature_f(station_id)
    if stored is not None:
        metar_cache[station_id] = (now + timedelta(seconds=settings.observation_refresh_seconds), stored)
        warnings.append("METAR observation loaded from Postgres weather-worker cache.")
        return stored
    observed = fetch_live_metar_temperature_f(station_id, warnings)
    metar_cache[station_id] = (now + timedelta(seconds=300 if observed else 60), observed)
    return observed


def fetch_live_metar_temperature_f(station_id: str, warnings: list[str]) -> tuple[float, datetime] | None:
    if not station_id or station_id == "UNKNOWN":
        return None
    try:
        with httpx.Client(timeout=10, follow_redirects=True) as client:
            response = client.get(f"{settings.aviation_weather_api_base}/metar", params={"ids": station_id, "format": "json"})
            response.raise_for_status()
            payload = response.json()
            records = payload if isinstance(payload, list) else [payload]
            if not records:
                warnings.append(f"METAR observation unavailable: no records returned for {station_id}.")
                return None
            record = records[0]
            if not isinstance(record, dict):
                warnings.append(f"METAR observation unavailable: unexpected payload shape for {station_id}.")
                return None
            temp_c = first_number(record, ("temp", "temp_c", "tempC", "temperature", "temperature_c"))
            obs_time = parse_datetime(record.get("obsTime") or record.get("reportTime") or record.get("receiptTime") or record.get("report_time"))
            if temp_c is None or obs_time is None:
                warnings.append(f"METAR observation unavailable: temperature or observation time missing for {station_id}.")
                return None
            return (float(temp_c) * 9 / 5 + 32, obs_time)
    except Exception as exc:
        warnings.append(f"METAR observation unavailable: {exc}")
    return None


def first_number(record: dict[str, object], keys: tuple[str, ...]) -> float | None:
    for key in keys:
        value = record.get(key)
        if value is None:
            continue
        try:
            return float(value)
        except (TypeError, ValueError):
            continue
    return None


def load_cached_metar_temperature_f(station_id: str) -> tuple[float, datetime] | None:
    cutoff = datetime.now(timezone.utc) - timedelta(seconds=int(settings.observation_refresh_seconds * settings.stale_observation_factor))
    try:
        with db_connection() as conn:
            with conn.cursor(row_factory=dict_row) as cur:
                row = cur.execute(
                    """
                    SELECT "temperatureF", "observedAt"
                    FROM "WeatherObservation"
                    WHERE "stationId" = %s
                      AND "createdAt" >= %s
                    ORDER BY "observedAt" DESC
                    LIMIT 1
                    """,
                    (station_id, cutoff),
                ).fetchone()
    except Exception:
        return None
    if not row:
        return None
    return (float(row["temperatureF"]), ensure_utc(row["observedAt"]))


def observation_applies(observed: tuple[float, datetime] | None, event_date: date | None, tz: ZoneInfo) -> bool:
    if observed is None or event_date is None:
        return False
    return observed[1].astimezone(tz).date() == event_date


def condition_daily_high(value: float, observed: tuple[float, datetime] | None, event_date: date | None, tz: ZoneInfo) -> float:
    if observation_applies(observed, event_date, tz):
        return max(value, observed[0])
    return value


def condition_daily_low(value: float, observed: tuple[float, datetime] | None, event_date: date | None, tz: ZoneInfo) -> float:
    if observation_applies(observed, event_date, tz):
        return min(value, observed[0])
    return value


@app.get("/forecast/station/{station_id}")
def forecast_station(station_id: str) -> dict[str, object]:
    now = datetime.now(timezone.utc).isoformat()
    return {
        "stationId": station_id,
        "generatedAt": now,
        "modelName": "NBM/HRRR/NWS blend",
        "hourlyTemperatureF": [72, 74, 77, 79, 80, 79, 76, 73],
        "sourceLinks": [link.model_dump() for link in source_links("station-forecast", station_id)],
    }


@app.get("/sources/market/{market_ticker}")
def sources_market(market_ticker: str) -> dict[str, object]:
    return {"marketTicker": market_ticker, "sourceLinks": [link.model_dump() for link in source_links(market_ticker)]}


@app.post("/refresh/market/{market_ticker}")
def refresh_market(market_ticker: str) -> dict[str, str]:
    return {"status": "queued", "marketTicker": market_ticker}


@app.post("/refresh/all")
def refresh_all() -> dict[str, object]:
    from .ingestion import refresh_all_weather_inputs

    return refresh_all_weather_inputs()


@app.post("/refresh/observations")
def refresh_observations() -> dict[str, object]:
    from .ingestion import refresh_all_observations

    return refresh_all_observations()
