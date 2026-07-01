import {
  FeeCalculator,
  calculateEdge,
  calculateExecutableFill,
  normalizeKalshiMarket,
  probabilityForRange,
  type CandidateOpportunity,
  type MarketProbability,
  type NormalizedMarket,
  type OrderBook,
  type WeatherStationMapping
} from "@dollarcast/shared";
import { env } from "./env";
import { fixtureMarkets, fixtureOrderBooks, fixtureProbabilities } from "./fixtures";
import { getKalshiCircuitState, KalshiClient } from "./kalshi-client";
import { prisma } from "./prisma";

type MarketDataMode = "live" | "demo" | "unavailable";

type MarketDataResult = {
  markets: NormalizedMarket[];
  mode: MarketDataMode;
  lastRefreshed: string;
  error?: string;
  stale?: boolean;
};

type CandidateDataResult = {
  candidates: CandidateOpportunity[];
  mode: MarketDataMode;
  lastRefreshed: string;
  error?: string;
  stale?: boolean;
};

let marketCache: { data: MarketDataResult; expiresAt: number } | null = null;
let marketRefreshPromise: Promise<MarketDataResult> | null = null;
let candidateCache: { key: string; data: CandidateDataResult; expiresAt: number } | null = null;
let candidateRefreshPromise: { key: string; promise: Promise<CandidateDataResult> } | null = null;
let temperatureSeriesCache: { seriesTickers: string[]; expiresAt: number } | null = null;
const probabilityCache = new Map<string, { data: MarketProbability | null; expiresAt: number }>();
const eventTitleCache = new Map<string, { title: string | null; expiresAt: number }>();
const orderBookCache = new Map<string, { data: OrderBook; expiresAt: number }>();
const seriesMarketsCache = new Map<string, { records: unknown[]; refreshedAt: number }>();
let lastSchemaAlertAt = 0;

function isDemoMode(): boolean {
  return env.demoMode || process.env.DEMO_MODE === "true" || process.env.NEXT_PUBLIC_DEMO_MODE === "true";
}

function prismaMappingToShared(row: {
  seriesTicker: string;
  cityName: string;
  stateCode: string;
  stationId: string;
  stationName: string;
  icaoCode: string | null;
  latitude: number;
  longitude: number;
  timezone: string;
  settlementSourceName: string;
  settlementSourceUrl: string;
  dailyObservationWindow: string;
  dailyReportTimezone: string;
  sourceConfidence: string;
  verifiedAt: Date;
  notes: string | null;
}): WeatherStationMapping {
  return {
    ...row,
    sourceConfidence: row.sourceConfidence === "verified" ? "verified" : "needs_review",
    verifiedAt: row.verifiedAt.toISOString(),
    notes: row.notes
  };
}

type PersistedMarketRow = Awaited<ReturnType<typeof prisma.kalshiMarket.findMany>>[number];

function prismaMarketToShared(row: PersistedMarketRow): NormalizedMarket {
  const raw = row.rawPayload && typeof row.rawPayload === "object" ? row.rawPayload as Record<string, unknown> : {};
  return {
    ...(raw as unknown as NormalizedMarket),
    marketTicker: row.marketTicker,
    eventTicker: row.eventTicker,
    seriesTicker: row.seriesTicker,
    rawTitle: row.rawTitle,
    rawSubtitle: row.rawSubtitle,
    yesSubtitle: row.yesSubtitle,
    noSubtitle: row.noSubtitle,
    marketType: row.marketType as NormalizedMarket["marketType"],
    direction: row.direction as NormalizedMarket["direction"],
    cityName: row.cityName,
    stateCode: row.stateCode,
    eventDateLocal: row.eventDateLocal,
    eventHourLocal: row.eventHourLocal,
    timezone: row.timezone,
    rangeLowerF: row.rangeLowerF,
    rangeUpperF: row.rangeUpperF,
    lowerInclusive: row.lowerInclusive,
    upperInclusive: row.upperInclusive,
    stationId: row.stationId,
    stationName: row.stationName,
    stationLatitude: row.stationLatitude,
    stationLongitude: row.stationLongitude,
    settlementSourceName: row.settlementSourceName,
    settlementSourceUrl: row.settlementSourceUrl,
    contractUrl: row.contractUrl,
    contractTermsUrl: row.contractTermsUrl,
    closeTime: row.closeTime.toISOString(),
    expirationTime: row.expirationTime?.toISOString() ?? null,
    yesBid: row.yesBid,
    yesAsk: row.yesAsk,
    noBid: row.noBid,
    noAsk: row.noAsk,
    lastPrice: row.lastPrice,
    volume: row.volume,
    volume24h: row.volume24h,
    openInterest: row.openInterest,
    liquidityDollars: row.liquidityDollars,
    fractionalTradingEnabled: row.fractionalTradingEnabled,
    rawRulesPrimary: row.rawRulesPrimary,
    rawRulesSecondary: row.rawRulesSecondary,
    parseStatus: row.parseStatus as NormalizedMarket["parseStatus"],
    parseWarnings: row.parseWarnings
  };
}

async function getPersistedMarketsFallback(error: Error): Promise<MarketDataResult | null> {
  try {
    const rows = await prisma.kalshiMarket.findMany({
      where: {
        marketType: { in: ["daily_temperature", "hourly_temperature"] },
        closeTime: { gte: new Date() }
      },
      orderBy: { closeTime: "asc" },
      take: 500
    });
    if (!rows.length) return null;
    const lastUpdated = rows.reduce((latest, row) => row.updatedAt > latest ? row.updatedAt : latest, rows[0].updatedAt);
    return {
      markets: rows.map(prismaMarketToShared).filter((market) => !isEffectivelyDecided(market)),
      mode: "live",
      lastRefreshed: lastUpdated.toISOString(),
      stale: true,
      error: `Kalshi refresh degraded; showing persisted market cache. ${error.message}`
    };
  } catch {
    return null;
  }
}

function kalshiSchemaIssues(rawMarkets: unknown[]): string[] {
  const required = ["ticker", "event_ticker", "series_ticker", "title", "close_time"];
  const issues: string[] = [];
  for (const raw of rawMarkets.slice(0, 250)) {
    if (!raw || typeof raw !== "object") {
      issues.push("Kalshi market payload included a non-object record.");
      continue;
    }
    const record = raw as Record<string, unknown>;
    const ticker = typeof record.ticker === "string" ? record.ticker : "unknown";
    const missing = required.filter((field) => record[field] == null);
    if (missing.length) issues.push(`${ticker}: missing ${missing.join(", ")}`);
  }
  return issues;
}

async function logKalshiSchemaIssues(rawMarkets: unknown[]) {
  const issues = kalshiSchemaIssues(rawMarkets);
  if (!issues.length || Date.now() - lastSchemaAlertAt < 15 * 60 * 1000) return;
  lastSchemaAlertAt = Date.now();
  await prisma.dataRefreshLog.create({
    data: {
      source: "kalshi-schema",
      status: "degraded",
      startedAt: new Date(),
      completedAt: new Date(),
      message: `Kalshi market payload schema anomaly detected in ${issues.length} records.`,
      rawPayload: { issues: issues.slice(0, 50) }
    }
  });
}

async function logKalshiIngestionIssue(source: string, error: Error, payload?: Record<string, unknown>) {
  await prisma.dataRefreshLog.create({
    data: {
      source,
      status: "degraded",
      startedAt: new Date(),
      completedAt: new Date(),
      message: error.message,
      rawPayload: {
        ...payload,
        circuit: getKalshiCircuitState()
      }
    }
  });
}

export async function getStationMappings(): Promise<WeatherStationMapping[]> {
  if (!process.env.DATABASE_URL) return [];
  try {
    const rows = await prisma.weatherStationMapping.findMany();
    return rows.map(prismaMappingToShared);
  } catch {
    return [];
  }
}

function toOrderBookLevels(rawLevels: unknown): { price: number; quantity: number }[] {
  if (!Array.isArray(rawLevels)) return [];
  return rawLevels
    .map((level) => {
      if (Array.isArray(level)) {
        const price = Number(level[0]);
        const quantity = Number(level[1]);
        return { price: price > 1 ? price / 100 : price, quantity };
      }
      if (level && typeof level === "object") {
        const record = level as Record<string, unknown>;
        const price = Number(record.price);
        const quantity = Number(record.quantity ?? record.count ?? record.contracts);
        return { price: price > 1 ? price / 100 : price, quantity };
      }
      return { price: Number.NaN, quantity: Number.NaN };
    })
    .filter((level) => Number.isFinite(level.price) && Number.isFinite(level.quantity) && level.price > 0 && level.quantity > 0);
}

function findNestedOrderbook(payload: Record<string, unknown>): Record<string, unknown> {
  const candidates = [payload.orderbook_fp, payload.orderbook, payload.order_book, payload];
  for (const candidate of candidates) {
    if (candidate && typeof candidate === "object") return candidate as Record<string, unknown>;
  }
  return payload;
}

function parseOrderBookFromPayload(payload: Record<string, unknown>): OrderBook | null {
  const orderbook = findNestedOrderbook(payload);
  const yesBids = toOrderBookLevels(orderbook.yes_dollars ?? orderbook.yes ?? orderbook.yes_bids);
  const noBids = toOrderBookLevels(orderbook.no_dollars ?? orderbook.no ?? orderbook.no_bids);
  if (!yesBids.length && !noBids.length) return null;
  return { yesBids, noBids };
}

async function getBulkOrderBooks(client: KalshiClient, tickers: string[]): Promise<Map<string, OrderBook>> {
  const books = new Map<string, OrderBook>();
  const uniqueTickers = [...new Set(tickers)];
  const missing: string[] = [];
  const now = Date.now();
  for (const ticker of uniqueTickers) {
    const cached = orderBookCache.get(ticker);
    if (cached && cached.expiresAt > now) {
      books.set(ticker, cached.data);
    } else {
      missing.push(ticker);
    }
  }
  const chunks: string[][] = [];
  for (let index = 0; index < missing.length; index += 100) {
    chunks.push(missing.slice(index, index + 100));
  }
  await mapWithConcurrency(chunks, Math.min(env.kalshiSeriesConcurrency, 4), async (chunk) => {
    try {
      const payload = await client.getOrderbooks(chunk);
      const rawBooks = (payload.orderbooks ?? []) as unknown[];
      for (const raw of rawBooks) {
        if (!raw || typeof raw !== "object") continue;
        const record = raw as Record<string, unknown>;
        const ticker = typeof record.ticker === "string" ? record.ticker : null;
        const book = parseOrderBookFromPayload(record);
        if (ticker && book) {
          books.set(ticker, book);
          orderBookCache.set(ticker, { data: book, expiresAt: Date.now() + env.kalshiCacheSeconds * 1000 });
        }
      }
    } catch (error) {
      await logKalshiIngestionIssue("kalshi-orderbooks", error instanceof Error ? error : new Error("Kalshi orderbook refresh failed."), {
        tickers: chunk
      });
      // Keep the market visible even if executable pricing is unavailable.
    }
  });
  return books;
}

function applyDisplayPrices(market: NormalizedMarket, book: OrderBook | undefined): NormalizedMarket {
  if (!book) return market;
  const bestYesBid = [...book.yesBids].sort((a, b) => b.price - a.price)[0]?.price ?? null;
  const bestNoBid = [...book.noBids].sort((a, b) => b.price - a.price)[0]?.price ?? null;
  return {
    ...market,
    yesBid: market.yesBid ?? bestYesBid,
    noBid: market.noBid ?? bestNoBid,
    yesAsk: market.yesAsk ?? (bestNoBid == null ? null : 1 - bestNoBid),
    noAsk: market.noAsk ?? (bestYesBid == null ? null : 1 - bestYesBid),
    liquidityDollars:
      market.liquidityDollars ??
      [...book.yesBids, ...book.noBids].reduce((sum, level) => sum + level.price * level.quantity, 0)
  };
}

function isEffectivelyDecided(market: NormalizedMarket): boolean {
  const prices = [market.yesAsk, market.noAsk, market.yesBid, market.noBid].filter((value): value is number => value != null);
  return prices.some((value) => value >= env.excludeDecidedPrice || value <= 1 - env.excludeDecidedPrice);
}

function executableDisplayAsk(market: NormalizedMarket, side: "yes" | "no"): number | null {
  const direct = side === "yes" ? market.yesAsk : market.noAsk;
  if (direct != null && direct > 0 && direct < 1) return direct;
  const oppositeBid = side === "yes" ? market.noBid : market.yesBid;
  if (oppositeBid != null && oppositeBid > 0 && oppositeBid < 1) return 1 - oppositeBid;
  return null;
}

function eventScanGroup(market: NormalizedMarket): string {
  return [
    market.stationId ?? market.cityName ?? market.seriesTicker,
    market.eventDateLocal ?? market.closeTime,
    market.eventHourLocal ?? "daily",
    market.direction,
    market.marketType
  ].join(":");
}

function probabilityGroupKey(market: NormalizedMarket): string {
  return [
    market.stationLatitude == null ? "none" : market.stationLatitude.toFixed(4),
    market.stationLongitude == null ? "none" : market.stationLongitude.toFixed(4),
    market.stationId ?? "UNKNOWN",
    market.marketType,
    market.direction,
    market.eventDateLocal ?? "",
    market.eventHourLocal ?? "",
    market.timezone ?? ""
  ].join("|");
}

function marketScanScore(market: NormalizedMarket): number {
  const asks = [executableDisplayAsk(market, "yes"), executableDisplayAsk(market, "no")]
    .filter((value): value is number => value != null && value > 0 && value < env.excludeDecidedPrice);
  if (!asks.length) return Number.NEGATIVE_INFINITY;

  const bestPriceShape = Math.max(...asks.map((price) => Math.sqrt(price * (1 - price)) * 2));
  const liquidity = Math.max(0, market.liquidityDollars ?? 0);
  const volume = Math.max(0, market.volume24h ?? market.volume ?? 0);
  const openInterest = Math.max(0, market.openInterest ?? 0);
  const liquidityScore = Math.log1p(liquidity) / 8;
  const activityScore = (Math.log1p(volume) + Math.log1p(openInterest)) / 12;
  const closeMs = new Date(market.closeTime).getTime();
  const hoursToClose = Number.isFinite(closeMs) ? Math.max(0, (closeMs - Date.now()) / 3_600_000) : 72;
  const horizonScore = hoursToClose <= 36 ? 1 : hoursToClose <= 72 ? 0.6 : 0.25;
  const hourlyBoost = market.marketType === "hourly_temperature" ? 0.1 : 0;
  return bestPriceShape * 2 + liquidityScore + activityScore + horizonScore + hourlyBoost;
}

function selectMarketsForEdgeScan(markets: NormalizedMarket[]): NormalizedMarket[] {
  const scanLimit = Math.max(1, env.maxEdgeChecks);
  const preselectLimit = Math.max(scanLimit, scanLimit * Math.max(1, env.edgePreselectMultiplier));
  const perEventLimit = Math.max(1, env.maxEdgeChecksPerEvent);
  const ranked = markets
    .filter((market) => market.marketType !== "unsupported" && market.parseStatus === "verified")
    .map((market) => ({ market, score: marketScanScore(market), group: eventScanGroup(market) }))
    .filter((entry) => Number.isFinite(entry.score))
    .sort((a, b) => b.score - a.score)
    .slice(0, preselectLimit);

  const groups = new Map<string, typeof ranked>();
  for (const entry of ranked) {
    const group = groups.get(entry.group) ?? [];
    if (group.length < perEventLimit) {
      group.push(entry);
      groups.set(entry.group, group);
    }
  }

  const buckets = [...groups.values()]
    .sort((a, b) => b[0].score - a[0].score)
    .slice(0, Math.max(1, env.maxEdgeScanGroups));
  const selected: NormalizedMarket[] = [];
  for (let round = 0; selected.length < scanLimit; round++) {
    let added = false;
    for (const bucket of buckets) {
      const entry = bucket[round];
      if (!entry) continue;
      selected.push(entry.market);
      added = true;
      if (selected.length >= scanLimit) break;
    }
    if (!added) break;
  }
  return selected.length ? selected : ranked.slice(0, scanLimit).map((entry) => entry.market);
}

function selectAllVerifiedMarketsForEdgeScan(markets: NormalizedMarket[]): NormalizedMarket[] {
  return markets
    .filter((market) => market.marketType !== "unsupported" && market.parseStatus === "verified")
    .map((market) => ({ market, score: marketScanScore(market) }))
    .filter((entry) => Number.isFinite(entry.score))
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.market);
}

function probabilityForMarketFromDistribution(market: NormalizedMarket, base: MarketProbability): MarketProbability {
  const values = base.simulation?.temperaturesF;
  if (!values?.length) return { ...base, marketTicker: market.marketTicker };
  const yesProbability = probabilityForRange(
    values,
    market.rangeLowerF,
    market.rangeUpperF,
    market.lowerInclusive,
    market.upperInclusive
  );
  return {
    ...base,
    marketTicker: market.marketTicker,
    yesProbability,
    noProbability: 1 - yesProbability
  };
}

async function getGroupProbabilities(markets: NormalizedMarket[]): Promise<Map<string, MarketProbability>> {
  const probabilities = new Map<string, MarketProbability>();
  if (!markets.length) return probabilities;
  const representative = markets[0];
  if (!representative.stationLatitude || !representative.stationLongitude || !representative.stationId) return probabilities;
  try {
    const response = await fetch(`${env.weatherServiceUrl}/forecast/group`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      cache: "no-store",
      body: JSON.stringify({
        latitude: representative.stationLatitude,
        longitude: representative.stationLongitude,
        stationId: representative.stationId,
        marketType: representative.marketType,
        direction: representative.direction,
        eventDateLocal: representative.eventDateLocal,
        eventHourLocal: representative.eventHourLocal,
        timezoneName: representative.timezone,
        simulationLimit: env.edgeResponseSimulationSamples,
        markets: markets.map((market) => ({
          marketTicker: market.marketTicker,
          lowerF: market.rangeLowerF,
          upperF: market.rangeUpperF,
          lowerInclusive: market.lowerInclusive,
          upperInclusive: market.upperInclusive
        }))
      })
    });
    if (!response.ok) throw new Error("weather-service group forecast failed");
    const payload = (await response.json()) as MarketProbability[];
    for (const probability of payload) {
      probabilities.set(probability.marketTicker, probability);
      probabilityCache.set(`${probability.marketTicker}:${env.edgeResponseSimulationSamples}`, {
        data: probability,
        expiresAt: Date.now() + env.probabilityCacheSeconds * 1000
      });
    }
  } catch {
    const probability = await getProbability(representative, env.edgeResponseSimulationSamples);
    if (probability) {
      for (const market of markets) {
        probabilities.set(market.marketTicker, probabilityForMarketFromDistribution(market, probability));
      }
    }
  }
  return probabilities;
}

async function mapWithConcurrency<T, R>(items: T[], concurrency: number, mapper: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;
  const workerCount = Math.max(1, Math.min(concurrency, items.length));
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await mapper(items[currentIndex]);
    }
  }));
  return results;
}

async function getEventTitle(client: KalshiClient, eventTicker: string): Promise<string | null> {
  const cached = eventTitleCache.get(eventTicker);
  if (cached && cached.expiresAt > Date.now()) return cached.title;
  try {
    const payload = await client.getEvent(eventTicker);
    const event = payload.event;
    const title = event && typeof event === "object" && typeof (event as Record<string, unknown>).title === "string"
      ? ((event as Record<string, unknown>).title as string)
      : null;
    eventTitleCache.set(eventTicker, { title, expiresAt: Date.now() + env.kalshiSeriesCacheSeconds * 1000 });
    return title;
  } catch {
    eventTitleCache.set(eventTicker, { title: null, expiresAt: Date.now() + 60_000 });
    return null;
  }
}

async function attachEventTitles(client: KalshiClient, markets: NormalizedMarket[]): Promise<NormalizedMarket[]> {
  if (process.env.KALSHI_FETCH_EVENT_TITLES !== "true") return markets;
  const uniqueEventTickers = [...new Set(markets.map((market) => market.eventTicker).filter(Boolean))];
  const titles = new Map<string, string | null>();
  await mapWithConcurrency(uniqueEventTickers, env.kalshiSeriesConcurrency, async (eventTicker) => {
    titles.set(eventTicker, await getEventTitle(client, eventTicker));
  });
  return markets.map((market) => ({
    ...market,
    eventTitle: titles.get(market.eventTicker) ?? null
  }));
}

async function getOpenKalshiMarkets(client: KalshiClient): Promise<unknown[]> {
  const records: unknown[] = [];
  let cursor: string | undefined;
  for (let pageIndex = 0; pageIndex < env.kalshiMarketMaxPages; pageIndex++) {
    const page = await client.getMarkets({
      status: "open",
      limit: env.kalshiMarketPageLimit,
      mve_filter: "exclude",
      cursor
    });
    records.push(...(((page.markets ?? []) as unknown[]) ?? []));
    cursor = typeof page.cursor === "string" && page.cursor.length > 0 ? page.cursor : undefined;
    if (!cursor) break;
  }
  return records;
}

async function getSeriesMarkets(client: KalshiClient, seriesTickers: string[]): Promise<unknown[]> {
  const batches = await mapWithConcurrency(seriesTickers, env.kalshiSeriesConcurrency, async (seriesTicker) => {
    const records: unknown[] = [];
    let cursor: string | undefined;
    for (let pageIndex = 0; pageIndex < env.kalshiMarketMaxPages; pageIndex++) {
      try {
        const page = await client.getMarkets({
          status: "open",
          limit: env.kalshiMarketPageLimit,
          mve_filter: "exclude",
          series_ticker: seriesTicker,
          cursor
        });
        records.push(...(((page.markets ?? []) as unknown[]) ?? []));
        cursor = typeof page.cursor === "string" && page.cursor.length > 0 ? page.cursor : undefined;
        if (!cursor) break;
      } catch (error) {
        await logKalshiIngestionIssue("kalshi-series-markets", error instanceof Error ? error : new Error("Kalshi series market refresh failed."), {
          seriesTicker,
          usingCachedSeries: seriesMarketsCache.has(seriesTicker)
        });
        return seriesMarketsCache.get(seriesTicker)?.records ?? records;
      }
    }
    seriesMarketsCache.set(seriesTicker, { records, refreshedAt: Date.now() });
    return records;
  });
  return batches.flat();
}

function rawSeriesTicker(raw: unknown): string | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const value = record.ticker ?? record.series_ticker;
  return typeof value === "string" && value.length > 0 ? value : null;
}

function isTemperatureSeries(raw: unknown): boolean {
  const text = JSON.stringify(raw).toLowerCase();
  const isClimate = text.includes("climate and weather") || text.includes("climate") || text.includes("weather");
  const isTaggedTemperature = text.includes("daily temperature") || text.includes("hourly temperature");
  const isNamedTemperature =
    /highest temperature|lowest temperature|high temperature|low temperature|max temp|maximum temperature|min temp|minimum temperature|hourly directional .*temperature|hourly .*temperature/.test(text);
  const unsupported = /rain|snow|hurricane|tornado|storm|drought|gas|mortgage|inflation|crypto|s&p|bitcoin|ethereum/.test(text);
  return isClimate && (isTaggedTemperature || isNamedTemperature) && !unsupported;
}

async function discoverTemperatureSeries(client: KalshiClient): Promise<string[]> {
  if (temperatureSeriesCache && temperatureSeriesCache.expiresAt > Date.now()) return temperatureSeriesCache.seriesTickers;
  const seeded = [...env.dailyTemperatureSeries, ...env.hourlyTemperatureSeries];
  if (!env.kalshiDynamicSeriesDiscovery) {
    const seriesTickers = [...new Set(seeded)];
    temperatureSeriesCache = { seriesTickers, expiresAt: Date.now() + env.kalshiSeriesCacheSeconds * 1000 };
    return seriesTickers;
  }
  try {
    const rawSeries = await client.paginate("/series", { limit: 200 });
    const discovered = rawSeries.filter(isTemperatureSeries).map(rawSeriesTicker).filter((ticker): ticker is string => Boolean(ticker));
    const seriesTickers = [...new Set([...seeded, ...discovered])];
    temperatureSeriesCache = { seriesTickers, expiresAt: Date.now() + env.kalshiSeriesCacheSeconds * 1000 };
    return seriesTickers;
  } catch {
    return seeded;
  }
}

async function getTemperatureMarkets(client: KalshiClient): Promise<unknown[]> {
  const seriesTickers = await discoverTemperatureSeries(client);
  const targeted = await getSeriesMarkets(client, seriesTickers);
  if (targeted.length > 0) return targeted;
  return getOpenKalshiMarkets(client);
}

export async function getMarkets(): Promise<MarketDataResult> {
  if (isDemoMode()) return { markets: fixtureMarkets, mode: "demo", lastRefreshed: new Date().toISOString() };
  if (marketCache && marketCache.expiresAt > Date.now()) return marketCache.data;
  if (marketRefreshPromise) return marketRefreshPromise;
  marketRefreshPromise = (async () => {
  try {
    const client = new KalshiClient();
    const mappings = await getStationMappings();
    const liveMarketsRaw = await getTemperatureMarkets(client);
    await logKalshiSchemaIssues(liveMarketsRaw);
    const byTicker = new Map<string, unknown>();
    for (const raw of liveMarketsRaw) {
      if (!raw || typeof raw !== "object") continue;
      const ticker = (raw as Record<string, unknown>).ticker;
      if (typeof ticker === "string") byTicker.set(ticker, raw);
    }
    const temperatureMarkets = [...byTicker.values()].filter((raw) => {
      const text = JSON.stringify(raw).toLowerCase();
      return (text.includes("climate") || text.includes("weather") || text.includes("temperature") || text.includes("temp")) &&
        (text.includes("temperature") || text.includes("temp") || text.includes(" high ") || text.includes(" low ") || text.includes("hourly"));
    });
    const normalizedMarkets = temperatureMarkets
      .map((raw) => normalizeKalshiMarket(raw as Record<string, unknown>, mappings))
      .filter((market) => market.marketType === "daily_temperature" || market.marketType === "hourly_temperature")
      .sort((a, b) => new Date(a.closeTime).getTime() - new Date(b.closeTime).getTime());
    const enrichedMarkets = await attachEventTitles(client, normalizedMarkets);
    const books = await getBulkOrderBooks(client, enrichedMarkets.map((market) => market.marketTicker));
    const markets = enrichedMarkets
      .map((market) => applyDisplayPrices(market, books.get(market.marketTicker)))
      .filter((market) => !isEffectivelyDecided(market));
    const data = { markets, mode: "live" as const, lastRefreshed: new Date().toISOString() };
    marketCache = { data, expiresAt: Date.now() + env.kalshiCacheSeconds * 1000 };
    return data;
  } catch (error) {
    const refreshError = error instanceof Error ? error : new Error("Live Kalshi refresh failed.");
    await logKalshiIngestionIssue("kalshi-market-refresh", refreshError);
    if (marketCache) {
      return {
        ...marketCache.data,
        stale: true,
        error: `${refreshError.message}; showing in-memory cached live data.`
      };
    }
    const persisted = await getPersistedMarketsFallback(refreshError);
    if (persisted) {
      marketCache = { data: persisted, expiresAt: Date.now() + Math.max(15, env.kalshiCacheSeconds / 2) * 1000 };
      return persisted;
    }
    return {
      markets: [],
      mode: "unavailable",
      lastRefreshed: new Date().toISOString(),
      error: refreshError.message
    };
  } finally {
    marketRefreshPromise = null;
  }
  })();
  return marketRefreshPromise;
}

export async function getMarket(ticker: string) {
  const all = await getMarkets();
  return { market: all.markets.find((market) => market.marketTicker === ticker) ?? null, mode: all.mode, lastRefreshed: all.lastRefreshed };
}

export async function getProbability(market: NormalizedMarket, simulationLimit = 1000): Promise<MarketProbability | null> {
  if (isDemoMode()) return fixtureProbabilities[market.marketTicker] ?? null;
  if (!market.stationLatitude || !market.stationLongitude || !market.stationId || (market.rangeLowerF == null && market.rangeUpperF == null)) return null;
  const cacheKey = `${market.marketTicker}:${simulationLimit}`;
  const cached = probabilityCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.data;
  try {
    const params = new URLSearchParams({
      latitude: String(market.stationLatitude),
      longitude: String(market.stationLongitude),
      station_id: market.stationId,
      market_type: market.marketType,
      direction: market.direction,
      lower_inclusive: String(market.lowerInclusive),
      upper_inclusive: String(market.upperInclusive)
    });
    params.set("simulation_limit", String(simulationLimit));
    if (market.rangeLowerF != null) params.set("lower_f", String(market.rangeLowerF));
    if (market.rangeUpperF != null) params.set("upper_f", String(market.rangeUpperF));
    if (market.eventDateLocal) params.set("event_date_local", market.eventDateLocal);
    if (market.eventHourLocal) params.set("event_hour_local", market.eventHourLocal);
    if (market.timezone) params.set("timezone_name", market.timezone);
    const response = await fetch(`${env.weatherServiceUrl}/forecast/market/${encodeURIComponent(market.marketTicker)}?${params}`, { cache: "no-store" });
    if (!response.ok) throw new Error("weather-service failed");
    const probability = (await response.json()) as MarketProbability;
    probabilityCache.set(cacheKey, { data: probability, expiresAt: Date.now() + env.probabilityCacheSeconds * 1000 });
    return probability;
  } catch {
    probabilityCache.set(cacheKey, { data: null, expiresAt: Date.now() + 60_000 });
    return null;
  }
}

export async function getOrderBook(market: NormalizedMarket): Promise<OrderBook | null> {
  if (isDemoMode() && fixtureOrderBooks[market.marketTicker]) return fixtureOrderBooks[market.marketTicker];
  if (!isDemoMode()) {
    try {
      const client = new KalshiClient();
      const payload = await client.getOrderbook(market.marketTicker);
      const direct = parseOrderBookFromPayload(payload);
      if (direct) return direct;
    } catch {
      return null;
    }
  }
  if (market.yesBid == null || market.noBid == null) return null;
  return { yesBids: [{ price: market.yesBid, quantity: 1 }], noBids: [{ price: market.noBid, quantity: 1 }] };
}

function orderBookFromDisplayPrices(market: NormalizedMarket): OrderBook | null {
  if (market.yesBid == null && market.noBid == null) return null;
  return {
    yesBids: market.yesBid == null ? [] : [{ price: market.yesBid, quantity: 1 }],
    noBids: market.noBid == null ? [] : [{ price: market.noBid, quantity: 1 }]
  };
}

export async function buildCandidates(markets: NormalizedMarket[], contracts = 10): Promise<CandidateOpportunity[]> {
  const feeCalc = new FeeCalculator();
  const candidateMarkets = env.edgeScanAllMarkets ? selectAllVerifiedMarketsForEdgeScan(markets) : selectMarketsForEdgeScan(markets);
  const candidates: CandidateOpportunity[] = [];
  const probabilities = new Map<string, MarketProbability>();
  const books = isDemoMode()
    ? new Map<string, OrderBook>()
    : await getBulkOrderBooks(new KalshiClient(), candidateMarkets.map((market) => market.marketTicker));

  const probabilityGroups = new Map<string, NormalizedMarket[]>();
  for (const market of candidateMarkets) {
    const key = probabilityGroupKey(market);
    probabilityGroups.set(key, [...(probabilityGroups.get(key) ?? []), market]);
  }
  const groupEntries = [...probabilityGroups.entries()];
  if (isDemoMode()) {
    for (const market of candidateMarkets) {
      const probability = fixtureProbabilities[market.marketTicker];
      if (probability) probabilities.set(market.marketTicker, probability);
    }
  } else {
    await mapWithConcurrency(groupEntries, env.edgeScanConcurrency, async ([, marketsInGroup]) => {
      const groupProbabilities = await getGroupProbabilities(marketsInGroup);
      for (const [ticker, probability] of groupProbabilities) probabilities.set(ticker, probability);
    });
  }

  for (const [groupKey, marketsInGroup] of groupEntries) {
    const representativeProbability = probabilities.get(marketsInGroup[0].marketTicker);
    if (representativeProbability) probabilities.set(groupKey, representativeProbability);
  }

  for (const market of candidateMarkets) {
    const groupKey = probabilityGroupKey(market);
    const baseProbability = probabilities.get(groupKey);
    const probability = probabilities.get(market.marketTicker) ?? (baseProbability ? probabilityForMarketFromDistribution(market, baseProbability) : null);
    const book = books.get(market.marketTicker) ?? (isDemoMode() ? await getOrderBook(market) : orderBookFromDisplayPrices(market));
    if (!probability || !book) continue;
    const marketCandidates: CandidateOpportunity[] = [];
    for (const side of ["yes", "no"] as const) {
      const fill = calculateExecutableFill(side, contracts, book);
      if (fill.filledContracts <= 0) continue;
      const fee = feeCalc.estimateTakerFee(fill.filledContracts, fill.averagePrice);
      const modelProbability = side === "yes" ? probability.yesProbability : probability.noProbability;
      const edge = calculateEdge({
        side,
        modelProbability,
        executablePrice: fill.averagePrice,
        fee,
        slippage: fill.slippageVsBestAsk,
        uncertaintyBuffer: env.uncertaintyBuffer,
        minNetEdge: env.minNetEdge
      });
      const recommendationEdge = probability.confidence === "low"
        ? {
            ...edge,
            eligible: false,
            reasons: [...edge.reasons, "Model confidence is low."]
          }
        : edge;
      marketCandidates.push({ market, probability, edge: recommendationEdge, fill, fee });
    }
    candidates.push(...marketCandidates);
  }
  return candidates;
}

export async function getCandidateData(contracts = 10): Promise<CandidateDataResult> {
  const marketData = await getMarkets();
  const key = `${marketData.lastRefreshed}:${Math.max(1, Math.floor(contracts))}`;
  if (candidateCache && candidateCache.key === key && candidateCache.expiresAt > Date.now()) return candidateCache.data;
  if (candidateRefreshPromise && candidateRefreshPromise.key === key) return candidateRefreshPromise.promise;

  candidateRefreshPromise = {
    key,
    promise: (async () => {
      try {
        const candidates = await buildCandidates(marketData.markets, contracts);
        const data: CandidateDataResult = {
          candidates,
          mode: marketData.mode,
          lastRefreshed: marketData.lastRefreshed,
          error: marketData.error,
          stale: marketData.stale
        };
        candidateCache = { key, data, expiresAt: Date.now() + env.probabilityCacheSeconds * 1000 };
        return data;
      } catch (error) {
        if (candidateCache) {
          return {
            ...candidateCache.data,
            stale: true,
            error: error instanceof Error ? error.message : "Candidate refresh failed; showing cached edge data."
          };
        }
        return {
          candidates: [],
          mode: marketData.mode,
          lastRefreshed: marketData.lastRefreshed,
          error: error instanceof Error ? error.message : "Candidate refresh failed."
        };
      } finally {
        candidateRefreshPromise = null;
      }
    })()
  };
  return candidateRefreshPromise.promise;
}
