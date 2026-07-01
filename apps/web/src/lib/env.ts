export const env = {
  kalshiApiBase: process.env.KALSHI_API_BASE ?? "https://external-api.kalshi.com/trade-api/v2",
  weatherServiceUrl: process.env.WEATHER_SERVICE_URL ?? "http://localhost:8000",
  gribCacheDir: process.env.GRIB_CACHE_DIR ?? "/tmp/dollarcast-grib",
  demoMode: process.env.DEMO_MODE === "true" || process.env.NEXT_PUBLIC_DEMO_MODE === "true",
  uncertaintyBuffer: Number(process.env.DEFAULT_UNCERTAINTY_BUFFER ?? 0.03),
  minNetEdge: Number(process.env.DEFAULT_MIN_NET_EDGE ?? 0.05),
  kalshiMarketPageLimit: Number(process.env.KALSHI_MARKET_PAGE_LIMIT ?? 200),
  kalshiMarketMaxPages: Number(process.env.KALSHI_MARKET_MAX_PAGES ?? 2),
  kalshiCacheSeconds: Number(process.env.KALSHI_CACHE_SECONDS ?? 120),
  kalshiMaxRetries: Number(process.env.KALSHI_MAX_RETRIES ?? 4),
  kalshiRetryBaseMs: Number(process.env.KALSHI_RETRY_BASE_MS ?? 750),
  kalshiRetryMaxMs: Number(process.env.KALSHI_RETRY_MAX_MS ?? 8000),
  kalshiCircuitBreakerFailures: Number(process.env.KALSHI_CIRCUIT_BREAKER_FAILURES ?? 4),
  kalshiCircuitBreakerCooldownMs: Number(process.env.KALSHI_CIRCUIT_BREAKER_COOLDOWN_MS ?? 120000),
  kalshiSeriesCacheSeconds: Number(process.env.KALSHI_SERIES_CACHE_SECONDS ?? 3600),
  probabilityCacheSeconds: Number(process.env.PROBABILITY_CACHE_SECONDS ?? 900),
  forecastRefreshSeconds: Number(process.env.FORECAST_REFRESH_SECONDS ?? 900),
  observationRefreshSeconds: Number(process.env.OBSERVATION_REFRESH_SECONDS ?? 300),
  retentionCleanupEnabled: process.env.RETENTION_CLEANUP_ENABLED !== "false",
  retentionDryRun: process.env.RETENTION_DRY_RUN === "true",
  retentionWorkerIntervalSeconds: Number(process.env.RETENTION_WORKER_INTERVAL_SECONDS ?? 3600),
  edgeSnapshotRetentionDays: Number(process.env.EDGE_SNAPSHOT_RETENTION_DAYS ?? 7),
  probabilitySnapshotRetentionDays: Number(process.env.PROBABILITY_SNAPSHOT_RETENTION_DAYS ?? 7),
  orderbookSnapshotRetentionDays: Number(process.env.ORDERBOOK_SNAPSHOT_RETENTION_DAYS ?? 2),
  forecastRunRetentionDays: Number(process.env.FORECAST_RUN_RETENTION_DAYS ?? 3),
  observationRetentionDays: Number(process.env.OBSERVATION_RETENTION_DAYS ?? 7),
  refreshLogRetentionDays: Number(process.env.REFRESH_LOG_RETENTION_DAYS ?? 14),
  allocationRunRetentionDays: Number(process.env.ALLOCATION_RUN_RETENTION_DAYS ?? 30),
  gribCacheRetentionHours: Number(process.env.GRIB_CACHE_RETENTION_HOURS ?? 24),
  edgeDistributionSamples: Number(process.env.EDGE_DISTRIBUTION_SAMPLES ?? 25000),
  edgeResponseSimulationSamples: Number(process.env.EDGE_RESPONSE_SIMULATION_SAMPLES ?? 1000),
  edgeScanConcurrency: Number(process.env.EDGE_SCAN_CONCURRENCY ?? 16),
  kalshiSeriesConcurrency: Number(process.env.KALSHI_SERIES_CONCURRENCY ?? 24),
  kalshiDynamicSeriesDiscovery: process.env.KALSHI_DYNAMIC_SERIES_DISCOVERY === "true",
  excludeDecidedPrice: Number(process.env.EXCLUDE_DECIDED_PRICE ?? 0.98),
  edgeScanAllMarkets: process.env.EDGE_SCAN_ALL_MARKETS === "true",
  allocationLiquidityCheckContracts: Number(process.env.ALLOCATION_LIQUIDITY_CHECK_CONTRACTS ?? 1000),
  maxEdgeChecks: Number(process.env.MAX_EDGE_CHECKS ?? 48),
  edgePreselectMultiplier: Number(process.env.EDGE_PRESELECT_MULTIPLIER ?? 5),
  maxEdgeChecksPerEvent: Number(process.env.MAX_EDGE_CHECKS_PER_EVENT ?? 8),
  maxEdgeScanGroups: Number(process.env.MAX_EDGE_SCAN_GROUPS ?? 8),
  dailyTemperatureSeries: (process.env.KALSHI_DAILY_TEMPERATURE_SERIES ??
    "HIGHNY,HIGHCHI,HIGHAUS,HIGHMIA,KXHIGHNY,KXHIGHNYD,KXHIGHCHI,KXHIGHAUS,KXHIGHMIA,KXHIGHLAX,KXHIGHDEN,KXDENHIGH,KXHIGHHOU,KXHIGHOU,KXHIGHTATL,KXHIGHTBOS,KXHIGHTDAL,KXHIGHTDC,KXHIGHTHOU,KXHIGHTLV,KXHIGHTMIN,KXHIGHTNOLA,KXHIGHTOKC,KXHIGHPHIL,KXPHILHIGH,KXHIGHTPHX,KXHIGHTSATX,KXHIGHTSEA,KXHIGHTSFO,KXHOUHIGH,KXLOWTNYC,KXLOWTCHI,KXLOWTMIA,KXLOWTAUS,KXLOWTLAX,KXLOWTDEN,KXLOWNYC,KXLOWNY,KXLOWCHI,KXLOWMIA,KXLOWAUS,KXLOWDEN,KXLOWLAX,KXLOWPHIL,KXLOWTATL,KXLOWTBOS,KXLOWTDAL,KXLOWTDC,KXLOWTHOU,KXLOWTLV,KXLOWTMIN,KXLOWTNOLA,KXLOWTOKC,KXLOWTPHIL,KXLOWTPHX,KXLOWTSATX,KXLOWTSEA,KXLOWTSFO,KXMINNYC,MINNYC")
    .split(",")
    .map((series) => series.trim())
    .filter(Boolean),
  hourlyTemperatureSeries: (process.env.KALSHI_HOURLY_TEMPERATURE_SERIES ?? "KXTEMPNYCH,KXTEMPCHIH,KXTEMPLAXH,KXTEMPMIAH,KXTEMPDCH,KXTEMPBOSH")
    .split(",")
    .map((series) => series.trim())
    .filter(Boolean)
};
