from __future__ import annotations

import logging
import time

from .config import settings
from .ingestion import refresh_all_weather_inputs


logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("weather-worker")


def main() -> None:
    interval = max(60, settings.weather_ingestion_interval_seconds)
    logger.info("Starting weather-worker with interval=%ss grib_enabled=%s", interval, settings.enable_grib_ingestion)
    while True:
        started = time.monotonic()
        try:
            result = refresh_all_weather_inputs()
            logger.info("Weather ingestion complete: %s", result)
        except Exception:
            logger.exception("Weather ingestion failed")
        elapsed = time.monotonic() - started
        time.sleep(max(5, interval - elapsed))


if __name__ == "__main__":
    main()
