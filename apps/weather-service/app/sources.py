from .config import settings
from .models import SourceLink


def source_links(market_ticker: str, station_id: str = "KNYC", latitude: float | None = None, longitude: float | None = None) -> list[SourceLink]:
    nws_url = settings.nws_api_base if latitude is None or longitude is None else f"{settings.nws_api_base}/points/{latitude:.4f},{longitude:.4f}"
    return [
        SourceLink(label="Kalshi markets", url="https://kalshi.com/markets", sourceType="kalshi", whyItMatters="Kalshi rules: settlement definition"),
        SourceLink(label="Kalshi contract rules", url="https://kalshi.com/markets", sourceType="rules", whyItMatters="Kalshi rules: settlement definition"),
        SourceLink(label="NOAA NBM source", url=settings.noaa_nbm_source_base, sourceType="nbm", whyItMatters="NBM: blended NOAA forecast baseline"),
        SourceLink(label="NOAA HRRR source", url=settings.noaa_hrrr_source_base, sourceType="hrrr", whyItMatters="HRRR: high-resolution short-term forecast"),
        SourceLink(label="NWS hourly forecast", url=nws_url, sourceType="nws", whyItMatters="NWS: official forecast context"),
        SourceLink(label="Aviation Weather Center METAR", url=f"{settings.aviation_weather_api_base}/metar?ids={station_id}&format=json", sourceType="metar", whyItMatters="METAR: current station observation"),
    ]
