from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Iterable

import numpy as np

from .config import settings


@dataclass(frozen=True)
class ModelPoint:
    model: str
    run_time_utc: datetime
    forecast_hour: int
    valid_time_utc: datetime
    source_url: str
    temperature_f: float


@dataclass(frozen=True)
class ModelSeries:
    model: str
    points: list[ModelPoint]
    warnings: list[str]


def load_grib_model_series(latitude: float | None, longitude: float | None, hours: int) -> tuple[ModelSeries, ModelSeries]:
    if not settings.enable_grib_ingestion:
        disabled = ModelSeries("disabled", [], ["GRIB ingestion disabled by ENABLE_GRIB_INGESTION=false."])
        return disabled, disabled
    if latitude is None or longitude is None:
        missing = ModelSeries("missing-coordinates", [], ["GRIB ingestion skipped because station coordinates were not supplied."])
        return missing, missing

    max_hours = max(1, hours)
    return (
        load_model_series("nbm", latitude, longitude, min(max_hours, settings.nbm_max_forecast_hour)),
        load_model_series("hrrr", latitude, longitude, min(max_hours, settings.hrrr_max_forecast_hour)),
    )


def load_model_series(model: str, latitude: float, longitude: float, max_forecast_hour: int) -> ModelSeries:
    warnings: list[str] = []
    run_time = latest_synoptic_run(model)
    points: list[ModelPoint] = []

    for forecast_hour in range(0, max_forecast_hour + 1):
        try:
            point = load_model_point(model, run_time, forecast_hour, latitude, longitude)
            if point is not None:
                points.append(point)
        except Exception as exc:
            if len(warnings) < 4:
                warnings.append(f"{model.upper()} f{forecast_hour:02d} unavailable: {exc}")

    if not points and not warnings:
        warnings.append(f"{model.upper()} GRIB returned no usable 2-meter temperature points.")
    return ModelSeries(model, points, warnings)


def latest_synoptic_run(model: str) -> datetime:
    now = datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0)
    if model == "hrrr":
        return now - timedelta(hours=2)
    cycle = 6
    hour = (now.hour // cycle) * cycle
    return now.replace(hour=hour) - timedelta(hours=3)


def load_model_point(model: str, run_time: datetime, forecast_hour: int, latitude: float, longitude: float) -> ModelPoint | None:
    from herbie import Herbie

    Path(settings.grib_cache_dir).mkdir(parents=True, exist_ok=True)
    product = "sfc" if model == "hrrr" else "co"
    search = r":TMP:2 m above ground:.*:nan:nan" if model == "nbm" else r":TMP:2 m above ground:"
    herbie_run_time = run_time.astimezone(timezone.utc).replace(tzinfo=None)
    herbie = Herbie(
        herbie_run_time,
        model=model,
        product=product,
        fxx=forecast_hour,
        save_dir=settings.grib_cache_dir,
        verbose=False,
    )
    grib_path = herbie.download(search, verbose=False)
    source = str(getattr(herbie, "grib", "") or getattr(herbie, "IDX_SUFFIX", "") or "")
    temp_k = sample_temperature_k_from_grib(grib_path, latitude, longitude)
    if temp_k is None:
        return None
    valid_time = run_time + timedelta(hours=forecast_hour)
    return ModelPoint(
        model=model,
        run_time_utc=run_time,
        forecast_hour=forecast_hour,
        valid_time_utc=valid_time,
        source_url=source,
        temperature_f=(temp_k - 273.15) * 9 / 5 + 32,
    )


def sample_temperature_k_from_grib(path: object, latitude: float, longitude: float) -> float | None:
    try:
        import pygrib

        grbs = pygrib.open(str(path))
        try:
            message = next(iter(grbs), None)
            if message is None:
                return None
            lats, lons = message.latlons()
            values = message.values
            target_lon = longitude
            if float(np.nanmax(lons)) > 180 and target_lon < 0:
                target_lon = target_lon % 360
            distance = (lats - latitude) ** 2 + (lons - target_lon) ** 2
            y_index, x_index = np.unravel_index(np.nanargmin(distance), distance.shape)
            return float(values[y_index, x_index])
        finally:
            grbs.close()
    except ImportError:
        import xarray as xr

        dataset = xr.open_dataset(str(path), engine="cfgrib", backend_kwargs={"indexpath": ""})
        try:
            return sample_temperature_k(dataset, latitude, longitude)
        finally:
            dataset.close()


def sample_temperature_k(dataset: object, latitude: float, longitude: float) -> float | None:
    ds = dataset[0] if isinstance(dataset, list) else dataset
    variable = first_temperature_variable(ds)
    if variable is None:
        return None

    data = ds[variable]
    lat_name = first_present(data.coords, ("latitude", "lat"))
    lon_name = first_present(data.coords, ("longitude", "lon"))
    if lat_name is None or lon_name is None:
        return float(data.mean().values)

    lats = data.coords[lat_name]
    lons = data.coords[lon_name]
    target_lon = longitude if float(np.nanmax(lons.values)) <= 180 else longitude % 360

    if len(lats.shape) == 1 and len(lons.shape) == 1:
        selected = data.sel({lat_name: latitude, lon_name: target_lon}, method="nearest")
        return float(selected.values)

    distance = (lats.values - latitude) ** 2 + (lons.values - target_lon) ** 2
    y_index, x_index = np.unravel_index(np.nanargmin(distance), distance.shape)
    dims = list(data.dims)
    indexers: dict[str, int] = {}
    if len(dims) >= 2:
        indexers[dims[-2]] = int(y_index)
        indexers[dims[-1]] = int(x_index)
    selected = data.isel(indexers)
    return float(np.asarray(selected.values).squeeze())


def first_temperature_variable(dataset: object) -> str | None:
    for name in getattr(dataset, "data_vars", {}):
        lname = str(name).lower()
        attrs = getattr(dataset[name], "attrs", {})
        long_name = str(attrs.get("long_name", "")).lower()
        level = str(attrs.get("level", "")).lower()
        if lname in {"t2m", "t"} or ("temperature" in long_name and ("2 m" in level or "2 metre" in long_name)):
            return str(name)
    for name in getattr(dataset, "data_vars", {}):
        if "t" in str(name).lower():
            return str(name)
    return None


def first_present(values: Iterable[object], candidates: tuple[str, ...]) -> str | None:
    available = {str(value) for value in values}
    for candidate in candidates:
        if candidate in available:
            return candidate
    return None
