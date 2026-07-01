from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str = "postgresql+psycopg://dollarcast:dollarcast@postgres:5432/dollarcast"
    nws_api_base: str = "https://api.weather.gov"
    aviation_weather_api_base: str = "https://aviationweather.gov/api/data"
    noaa_nbm_source_base: str = "https://noaa-nbm-grib2-pds.s3.amazonaws.com"
    noaa_hrrr_source_base: str = "https://noaa-hrrr-bdp-pds.s3.amazonaws.com"
    sigma_daily_f: float = 1.4
    sigma_hourly_f: float = 0.9
    ar1_rho: float = 0.8
    monte_carlo_paths: int = 25000
    enable_grib_ingestion: bool = True
    grib_cache_dir: str = "/tmp/dollarcast-grib"
    grib_run_lookback_hours: int = 18
    nbm_max_forecast_hour: int = 36
    hrrr_max_forecast_hour: int = 18
    forecast_refresh_seconds: int = 900
    observation_refresh_seconds: int = 300
    weather_ingestion_interval_seconds: int = 900
    forecast_cache_max_age_seconds: int = 5400
    weather_worker_station_limit: int = 40
    require_fresh_nws: bool = True
    require_grib_when_enabled: bool = True
    stale_forecast_factor: float = 2.0
    stale_observation_factor: float = 3.0


settings = Settings()
