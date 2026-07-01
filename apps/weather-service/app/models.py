from pydantic import BaseModel


class SourceLink(BaseModel):
    label: str
    url: str
    sourceType: str
    whyItMatters: str
    observedAt: str | None = None


class MarketProbability(BaseModel):
    marketTicker: str
    yesProbability: float
    noProbability: float
    meanTemperatureF: float
    medianTemperatureF: float
    p10TemperatureF: float
    p25TemperatureF: float
    p75TemperatureF: float
    p90TemperatureF: float
    confidence: str
    uncertaintyF: float
    modelInputs: dict[str, float]
    reasons: list[str]
    warnings: list[str]
    sourceLinks: list[SourceLink]
    simulation: dict[str, list[float]] | None = None


class ForecastMarketInput(BaseModel):
    marketTicker: str
    lowerF: float | None = None
    upperF: float | None = None
    lowerInclusive: bool = True
    upperInclusive: bool = True


class ForecastGroupRequest(BaseModel):
    latitude: float | None = None
    longitude: float | None = None
    stationId: str = "UNKNOWN"
    marketType: str = "daily_temperature"
    direction: str = "high"
    eventDateLocal: str | None = None
    eventHourLocal: str | None = None
    timezoneName: str | None = None
    simulationLimit: int = 1000
    markets: list[ForecastMarketInput]
