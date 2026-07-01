import type { NormalizedMarket, WeatherStationMapping } from "./types";

type RawKalshiMarket = Record<string, unknown>;

const asString = (value: unknown): string | null =>
  typeof value === "string" && value.length > 0 ? value : null;

const asNumber = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) return Number(value);
  return null;
};

const centsToDollars = (value: unknown): number | null => {
  const n = asNumber(value);
  if (n == null) return null;
  return n > 1 ? n / 100 : n;
};

const normalizeText = (value: string): string =>
  value
    .toLowerCase()
    .replace(/\*\*/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

function seriesRoot(value: string): string {
  return value.toUpperCase().replace(/^KX/, "").replace(/D$/, "");
}

function mappingMatchesSeries(mapping: WeatherStationMapping, seriesTicker: string): boolean {
  return mapping.seriesTicker.toUpperCase() === seriesTicker.toUpperCase() ||
    seriesRoot(mapping.seriesTicker) === seriesRoot(seriesTicker);
}

function mappingMatchesText(mapping: WeatherStationMapping, text: string): boolean {
  const normalized = normalizeText(text);
  const city = normalizeText(mapping.cityName);
  const station = normalizeText(mapping.stationName);
  const stationId = normalizeText(mapping.stationId);
  return normalized.includes(city) || normalized.includes(station) || normalized.includes(stationId);
}

function verifiedMappingForMarket(
  raw: RawKalshiMarket,
  mappings: WeatherStationMapping[],
  joined: string,
  warnings: string[]
): WeatherStationMapping | null {
  const seriesTicker = asString(raw.series_ticker) ?? "";
  const candidates = mappings.filter((mapping) => mappingMatchesSeries(mapping, seriesTicker) || mappingMatchesText(mapping, joined));
  if (!candidates.length) {
    warnings.push("Settlement station mapping could not be verified.");
    return null;
  }

  const uniqueByStation = new Map(candidates.map((mapping) => [mapping.stationId, mapping]));
  if (uniqueByStation.size > 1) {
    warnings.push("Settlement station mapping is ambiguous for this market.");
    return null;
  }

  const mapping = candidates[0];
  if (mapping.sourceConfidence !== "verified") {
    warnings.push("Station mapping is not marked verified.");
  }
  if (!mappingMatchesText(mapping, joined) && !mappingMatchesSeries(mapping, seriesTicker)) {
    warnings.push("Live contract text does not match the mapped city or station.");
  }
  const rawTimezone = asString(raw.timezone) ?? asString(raw.time_zone) ?? asString(raw.event_timezone);
  if (rawTimezone && normalizeText(rawTimezone) !== normalizeText(mapping.timezone)) {
    warnings.push("Live market timezone does not match the verified station mapping.");
  }

  const rulesText = normalizeText([raw.rules_primary, raw.rules_secondary, raw.settlement_source_name, raw.settlement_source_url].filter(Boolean).join(" "));
  const sourceName = normalizeText(mapping.settlementSourceName);
  const stationName = normalizeText(mapping.stationName);
  const stationId = normalizeText(mapping.stationId);
  const cityName = normalizeText(mapping.cityName);

  if (!rulesText) {
    warnings.push("Contract settlement rule missing.");
  } else {
    const mentionsMappedSource = sourceName.length > 0 && (rulesText.includes(sourceName) || sourceName.includes("national weather service") && rulesText.includes("national weather service"));
    const mentionsMappedStation = rulesText.includes(stationName) || rulesText.includes(stationId) || rulesText.includes(cityName);
    if (!mentionsMappedSource && !mentionsMappedStation) {
      warnings.push("Live settlement rules/source text does not reference the verified station or source mapping.");
    }
  }

  return warnings.some((warning) =>
    warning.includes("mapping") ||
    warning.includes("settlement") ||
    warning.includes("station") ||
    warning.includes("source")
  ) ? null : mapping;
}

export function parseTemperatureRange(text: string): {
  lower: number | null;
  upper: number | null;
  lowerInclusive: boolean;
  upperInclusive: boolean;
} {
  const normalized = text.replace(/\u00b0/g, "").replace(/degrees?/gi, "").replace(/fahrenheit/gi, "F");
  const number = "(-?\\d+(?:\\.\\d+)?)";
  const between = normalized.match(new RegExp(`(?:between|from)\\s+${number}\\s*(?:and|to|-)\\s*${number}`, "i"));
  if (between) {
    return { lower: Number(between[1]), upper: Number(between[2]), lowerInclusive: true, upperInclusive: true };
  }
  const range = normalized.match(new RegExp(`${number}\\s*(?:to|-)\\s*${number}\\s*F?`, "i"));
  if (range) {
    return { lower: Number(range[1]), upper: Number(range[2]), lowerInclusive: true, upperInclusive: true };
  }
  const atLeast = normalized.match(new RegExp(`(?:at least|above or equal to|>=|not below)\\s*${number}`, "i"));
  if (atLeast) return { lower: Number(atLeast[1]), upper: null, lowerInclusive: true, upperInclusive: false };
  const above = normalized.match(new RegExp(`(?:above|over|greater than|>)\\s*${number}`, "i"));
  if (above) return { lower: Number(above[1]), upper: null, lowerInclusive: false, upperInclusive: false };
  const atMost = normalized.match(new RegExp(`(?:at most|below or equal to|<=|not above)\\s*${number}`, "i"));
  if (atMost) return { lower: null, upper: Number(atMost[1]), lowerInclusive: false, upperInclusive: true };
  const below = normalized.match(new RegExp(`(?:below|under|less than|<)\\s*${number}`, "i"));
  if (below) return { lower: null, upper: Number(below[1]), lowerInclusive: false, upperInclusive: false };
  const exact = normalized.match(new RegExp(`(?:is|equals?)\\s*${number}\\s*F`, "i"));
  if (exact) return { lower: Number(exact[1]), upper: Number(exact[1]), lowerInclusive: true, upperInclusive: true };
  return { lower: null, upper: null, lowerInclusive: false, upperInclusive: false };
}

export function classifyMarket(raw: RawKalshiMarket): {
  marketType: NormalizedMarket["marketType"];
  direction: NormalizedMarket["direction"];
} {
  const text = [
    raw.title,
    raw.subtitle,
    raw.yes_sub_title,
    raw.no_sub_title,
    raw.rules_primary,
    raw.rules_secondary,
    raw.series_ticker,
    raw.ticker
  ].map((v) => String(v ?? "").toLowerCase()).join(" ");
  const isTemp = /temp|temperature|high|low|hourly/.test(text);
  if (!isTemp) return { marketType: "unsupported", direction: "unknown" };
  if (/hourly|at \d{1,2}\s?(am|pm)|\b\d{1,2}:00\b/.test(text)) return { marketType: "hourly_temperature", direction: "hourly" };
  if (/\blow(?:est)?\b|\bmin(?:imum)?\b/.test(text)) return { marketType: "daily_temperature", direction: "low" };
  if (/\bhigh(?:est)?\b|\bmax(?:imum)?\b|temperature/.test(text)) return { marketType: "daily_temperature", direction: "high" };
  return { marketType: "unsupported", direction: "unknown" };
}

export function normalizeKalshiMarket(
  raw: RawKalshiMarket,
  mappings: WeatherStationMapping[] = []
): NormalizedMarket {
  const ticker = asString(raw.ticker) ?? "";
  const seriesTicker = asString(raw.series_ticker) ?? asString(raw.seriesTicker) ?? ticker.split("-")[0] ?? "";
  const eventTicker = asString(raw.event_ticker) ?? asString(raw.eventTicker) ?? ticker.split("-").slice(0, 2).join("-");
  const title = asString(raw.title) ?? ticker;
  const subtitle = asString(raw.subtitle);
  const yesSubtitle = asString(raw.yes_sub_title);
  const noSubtitle = asString(raw.no_sub_title);
  const { marketType, direction } = classifyMarket(raw);
  const joined = [title, subtitle, yesSubtitle, noSubtitle, raw.rules_primary, raw.rules_secondary].filter(Boolean).join(" ");
  const range = parseTemperatureRange(joined);
  const warnings: string[] = [];
  if (marketType === "unsupported") warnings.push("Unsupported market type.");
  if (range.lower == null && range.upper == null) warnings.push("Temperature range could not be verified.");
  if (!asString(raw.close_time)) warnings.push("Close time missing.");
  const mapping = marketType === "unsupported" ? null : verifiedMappingForMarket(raw, mappings, joined, warnings);

  const cityMatch = joined.match(/\b([A-Z][a-z]+(?:\s[A-Z][a-z]+)*)\s*,\s*([A-Z]{2})\b/);
  const dateMatch = joined.match(/(20\d{2}-\d{2}-\d{2}|\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},?\s+20\d{2})/i);
  const hourMatch = joined.match(/\b(\d{1,2})(?::00)?\s?(AM|PM)\b/i);

  const parseStatus: NormalizedMarket["parseStatus"] =
    warnings.length === 0 ? "verified" : marketType === "unsupported" ? "unsupported" : "needs_review";

  return {
    marketTicker: ticker,
    eventTicker,
    seriesTicker,
    rawTitle: title,
    rawSubtitle: subtitle,
    yesSubtitle,
    noSubtitle,
    marketType,
    direction,
    cityName: mapping?.cityName ?? cityMatch?.[1] ?? null,
    stateCode: mapping?.stateCode ?? cityMatch?.[2] ?? null,
    eventDateLocal: asString(raw.event_date) ?? dateMatch?.[1] ?? null,
    eventHourLocal: asString(raw.event_hour) ?? (hourMatch ? `${hourMatch[1]} ${hourMatch[2].toUpperCase()}` : null),
    timezone: mapping?.timezone ?? null,
    rangeLowerF: range.lower,
    rangeUpperF: range.upper,
    lowerInclusive: range.lowerInclusive,
    upperInclusive: range.upperInclusive,
    stationId: mapping?.stationId ?? null,
    stationName: mapping?.stationName ?? null,
    stationLatitude: mapping?.latitude ?? null,
    stationLongitude: mapping?.longitude ?? null,
    settlementSourceName: mapping?.settlementSourceName ?? asString(raw.settlement_source_name),
    settlementSourceUrl: mapping?.settlementSourceUrl ?? asString(raw.settlement_source_url),
    contractUrl: asString(raw.contract_url),
    contractTermsUrl: asString(raw.contract_terms_url),
    closeTime: asString(raw.close_time) ?? new Date(0).toISOString(),
    expirationTime: asString(raw.expiration_time),
    yesBid: centsToDollars(raw.yes_bid),
    yesAsk: centsToDollars(raw.yes_ask) ?? (centsToDollars(raw.no_bid) == null ? null : 1 - centsToDollars(raw.no_bid)!),
    noBid: centsToDollars(raw.no_bid),
    noAsk: centsToDollars(raw.no_ask) ?? (centsToDollars(raw.yes_bid) == null ? null : 1 - centsToDollars(raw.yes_bid)!),
    lastPrice: centsToDollars(raw.last_price),
    volume: asNumber(raw.volume),
    volume24h: asNumber(raw.volume_24h),
    openInterest: asNumber(raw.open_interest),
    liquidityDollars: centsToDollars(raw.liquidity) ?? asNumber(raw.liquidity_dollars),
    fractionalTradingEnabled: Boolean(raw.fractional_trading_enabled),
    rawRulesPrimary: asString(raw.rules_primary),
    rawRulesSecondary: asString(raw.rules_secondary),
    parseStatus,
    parseWarnings: warnings
  };
}

export function isRecommendationParseReady(market: NormalizedMarket): boolean {
  const hasRange = market.rangeLowerF !== null || market.rangeUpperF !== null;
  if (market.marketType === "unsupported" || !hasRange) return false;
  return Boolean(
    market.eventDateLocal &&
      market.cityName &&
      market.timezone &&
      market.stationId &&
      (market.rawRulesPrimary || market.rawRulesSecondary) &&
      ((market.yesAsk !== null && market.yesAsk > 0) || (market.noAsk !== null && market.noAsk > 0))
  );
}
