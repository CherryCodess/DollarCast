import type { NormalizedMarket } from "@dollarcast/shared";

export const KALSHI_MARKETS_URL = "https://kalshi.com/markets";

const DAILY_HIGH_SERIES_SLUGS: Record<string, string> = {
  kxhighny: "highest-temperature-in-nyc",
  kxhighchi: "highest-temperature-in-chicago",
  kxhighaus: "highest-temperature-in-austin",
  kxhighmia: "highest-temperature-in-miami",
  kxhighlax: "highest-temperature-in-los-angeles",
  kxhighden: "highest-temperature-in-denver"
};

function tickerSeries(ticker: string): string {
  return ticker.split("-")[0] ?? "";
}

function tickerEvent(ticker: string): string {
  const parts = ticker.split("-");
  return parts.length >= 2 ? parts.slice(0, 2).join("-") : ticker;
}

function slugFromTitle(title: string): string {
  const normalized = title
    .replace(/\*\*/g, "")
    .replace(/\$cast/gi, "dollarcast")
    .toLowerCase();

  const highCity = normalized.match(/high temp(?:erature)? in ([a-z\s]+?) (?:be|on|at|>|<)/);
  if (highCity) {
    return `highest-temperature-in-${highCity[1].trim().replace(/\s+/g, "-")}`;
  }

  const hourlyCity = normalized.match(/temp(?:erature)? in ([a-z\s]+?) at/);
  if (hourlyCity) {
    return `temperature-in-${hourlyCity[1].trim().replace(/\s+/g, "-")}`;
  }

  return normalized
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function constructedKalshiMarketHref(
  market: Pick<NormalizedMarket, "marketTicker" | "eventTicker" | "seriesTicker" | "rawTitle">
): string | null {
  const series = (market.seriesTicker || tickerSeries(market.marketTicker)).toLowerCase();
  const event = (market.eventTicker || tickerEvent(market.marketTicker)).toLowerCase();
  if (!series || !event || !market.marketTicker) return null;

  const slug = DAILY_HIGH_SERIES_SLUGS[series] ?? slugFromTitle(market.rawTitle);
  if (!slug) return null;

  return `${KALSHI_MARKETS_URL}/${series}/${slug}/${event}?op_market_ticker=${encodeURIComponent(market.marketTicker)}`;
}

export function kalshiMarketHref(
  market: Pick<NormalizedMarket, "contractUrl" | "marketTicker" | "eventTicker" | "seriesTicker" | "rawTitle">
): string {
  const contractUrl = market.contractUrl?.replace(/\/$/, "");
  if (contractUrl && /^https:\/\/(www\.)?kalshi\.com\//.test(contractUrl) && contractUrl !== KALSHI_MARKETS_URL) {
    return market.contractUrl!;
  }

  return constructedKalshiMarketHref(market) ?? KALSHI_MARKETS_URL;
}

export function modelProbabilitySourceHref(
  market: Pick<NormalizedMarket, "stationLatitude" | "stationLongitude" | "marketTicker">
): string {
  if (market.stationLatitude != null && market.stationLongitude != null) {
    return `https://api.weather.gov/points/${market.stationLatitude.toFixed(4)},${market.stationLongitude.toFixed(4)}`;
  }

  return `/market/${encodeURIComponent(market.marketTicker)}#sources`;
}
