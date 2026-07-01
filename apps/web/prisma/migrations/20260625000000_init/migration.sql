-- CreateTable
CREATE TABLE "KalshiSeries" (
    "id" TEXT NOT NULL,
    "seriesTicker" TEXT NOT NULL,
    "title" TEXT,
    "category" TEXT,
    "tags" TEXT[],
    "rawPayload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "KalshiSeries_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "KalshiEvent" (
    "id" TEXT NOT NULL,
    "eventTicker" TEXT NOT NULL,
    "seriesTicker" TEXT NOT NULL,
    "title" TEXT,
    "rawPayload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "KalshiEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "KalshiMarket" (
    "id" TEXT NOT NULL,
    "marketTicker" TEXT NOT NULL,
    "eventTicker" TEXT NOT NULL,
    "seriesTicker" TEXT NOT NULL,
    "rawTitle" TEXT NOT NULL,
    "rawSubtitle" TEXT,
    "yesSubtitle" TEXT,
    "noSubtitle" TEXT,
    "marketType" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "cityName" TEXT,
    "stateCode" TEXT,
    "eventDateLocal" TEXT,
    "eventHourLocal" TEXT,
    "timezone" TEXT,
    "rangeLowerF" DOUBLE PRECISION,
    "rangeUpperF" DOUBLE PRECISION,
    "lowerInclusive" BOOLEAN NOT NULL,
    "upperInclusive" BOOLEAN NOT NULL,
    "stationId" TEXT,
    "settlementSourceName" TEXT,
    "settlementSourceUrl" TEXT,
    "contractUrl" TEXT,
    "contractTermsUrl" TEXT,
    "closeTime" TIMESTAMP(3) NOT NULL,
    "expirationTime" TIMESTAMP(3),
    "yesBid" DOUBLE PRECISION,
    "yesAsk" DOUBLE PRECISION,
    "noBid" DOUBLE PRECISION,
    "noAsk" DOUBLE PRECISION,
    "lastPrice" DOUBLE PRECISION,
    "volume" DOUBLE PRECISION,
    "volume24h" DOUBLE PRECISION,
    "openInterest" DOUBLE PRECISION,
    "liquidityDollars" DOUBLE PRECISION,
    "fractionalTradingEnabled" BOOLEAN NOT NULL,
    "rawRulesPrimary" TEXT,
    "rawRulesSecondary" TEXT,
    "parseStatus" TEXT NOT NULL,
    "parseWarnings" TEXT[],
    "rawPayload" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "KalshiMarket_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "KalshiOrderbookSnapshot" (
    "id" TEXT NOT NULL,
    "marketTicker" TEXT NOT NULL,
    "yesBids" JSONB NOT NULL,
    "noBids" JSONB NOT NULL,
    "yesAsks" JSONB,
    "noAsks" JSONB,
    "sourceTimestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rawPayload" JSONB NOT NULL,
    CONSTRAINT "KalshiOrderbookSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WeatherStationMapping" (
    "id" TEXT NOT NULL,
    "seriesTicker" TEXT NOT NULL,
    "cityName" TEXT NOT NULL,
    "stateCode" TEXT NOT NULL,
    "stationId" TEXT NOT NULL,
    "stationName" TEXT NOT NULL,
    "icaoCode" TEXT,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "timezone" TEXT NOT NULL,
    "settlementSourceName" TEXT NOT NULL,
    "settlementSourceUrl" TEXT NOT NULL,
    "dailyObservationWindow" TEXT NOT NULL,
    "dailyReportTimezone" TEXT NOT NULL,
    "sourceConfidence" TEXT NOT NULL,
    "verifiedAt" TIMESTAMP(3) NOT NULL,
    "notes" TEXT,
    CONSTRAINT "WeatherStationMapping_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WeatherForecastRun" (
    "id" TEXT NOT NULL,
    "modelName" TEXT NOT NULL,
    "modelVersion" TEXT NOT NULL,
    "runTimeUtc" TIMESTAMP(3) NOT NULL,
    "forecastHour" INTEGER NOT NULL,
    "validTimeUtc" TIMESTAMP(3) NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "stationId" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "temperatureC" DOUBLE PRECISION NOT NULL,
    "temperatureF" DOUBLE PRECISION NOT NULL,
    "cloudCover" DOUBLE PRECISION,
    "windSpeed" DOUBLE PRECISION,
    "dewPoint" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rawPayload" JSONB,
    CONSTRAINT "WeatherForecastRun_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WeatherObservation" (
    "id" TEXT NOT NULL,
    "stationId" TEXT NOT NULL,
    "observedAt" TIMESTAMP(3) NOT NULL,
    "temperatureF" DOUBLE PRECISION NOT NULL,
    "dewPointF" DOUBLE PRECISION,
    "windSpeed" DOUBLE PRECISION,
    "cloudLayers" JSONB,
    "visibility" DOUBLE PRECISION,
    "sourceUrl" TEXT NOT NULL,
    "rawPayload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WeatherObservation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MarketProbabilitySnapshot" (
    "id" TEXT NOT NULL,
    "marketTicker" TEXT NOT NULL,
    "yesProbability" DOUBLE PRECISION NOT NULL,
    "noProbability" DOUBLE PRECISION NOT NULL,
    "meanTemperatureF" DOUBLE PRECISION NOT NULL,
    "medianTemperatureF" DOUBLE PRECISION NOT NULL,
    "p10TemperatureF" DOUBLE PRECISION NOT NULL,
    "p25TemperatureF" DOUBLE PRECISION NOT NULL,
    "p75TemperatureF" DOUBLE PRECISION NOT NULL,
    "p90TemperatureF" DOUBLE PRECISION NOT NULL,
    "confidence" TEXT NOT NULL,
    "uncertaintyF" DOUBLE PRECISION NOT NULL,
    "modelInputs" JSONB NOT NULL,
    "reasons" TEXT[],
    "warnings" TEXT[],
    "sourceLinks" JSONB NOT NULL,
    "marketPriceSnapshot" JSONB,
    "feeEstimate" JSONB,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MarketProbabilitySnapshot_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AllocationRun" (
    "id" TEXT NOT NULL,
    "totalBudget" DOUBLE PRECISION NOT NULL,
    "riskProfile" TEXT NOT NULL,
    "recommendedDeployment" DOUBLE PRECISION NOT NULL,
    "cashHeldBack" DOUBLE PRECISION NOT NULL,
    "totalEstimatedFees" DOUBLE PRECISION NOT NULL,
    "expectedProfit" DOUBLE PRECISION NOT NULL,
    "expectedRoi" DOUBLE PRECISION NOT NULL,
    "probabilityOfProfit" DOUBLE PRECISION NOT NULL,
    "maxPossibleProfit" DOUBLE PRECISION NOT NULL,
    "maxPossibleLoss" DOUBLE PRECISION NOT NULL,
    "p05ProfitLoss" DOUBLE PRECISION NOT NULL,
    "p95ProfitLoss" DOUBLE PRECISION NOT NULL,
    "cvar05" DOUBLE PRECISION NOT NULL,
    "warnings" TEXT[],
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rawPayload" JSONB NOT NULL,
    CONSTRAINT "AllocationRun_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AllocationPosition" (
    "id" TEXT NOT NULL,
    "allocationRunId" TEXT NOT NULL,
    "marketTicker" TEXT NOT NULL,
    "marketTitle" TEXT NOT NULL,
    "side" TEXT NOT NULL,
    "recommendedDollars" DOUBLE PRECISION NOT NULL,
    "contracts" DOUBLE PRECISION NOT NULL,
    "averageExecutableFillPrice" DOUBLE PRECISION NOT NULL,
    "estimatedFee" DOUBLE PRECISION NOT NULL,
    "costIncludingFee" DOUBLE PRECISION NOT NULL,
    "profitIfCorrect" DOUBLE PRECISION NOT NULL,
    "lossIfIncorrect" DOUBLE PRECISION NOT NULL,
    "estimatedExpectedProfit" DOUBLE PRECISION NOT NULL,
    "modelProbability" DOUBLE PRECISION NOT NULL,
    "marketPrice" DOUBLE PRECISION NOT NULL,
    "netEdge" DOUBLE PRECISION NOT NULL,
    "confidence" TEXT NOT NULL,
    "correlationGroup" TEXT NOT NULL,
    CONSTRAINT "AllocationPosition_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DataRefreshLog" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "message" TEXT,
    "rawPayload" JSONB,
    CONSTRAINT "DataRefreshLog_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "KalshiSeries_seriesTicker_key" ON "KalshiSeries"("seriesTicker");
CREATE UNIQUE INDEX "KalshiEvent_eventTicker_key" ON "KalshiEvent"("eventTicker");
CREATE UNIQUE INDEX "KalshiMarket_marketTicker_key" ON "KalshiMarket"("marketTicker");
CREATE INDEX "WeatherStationMapping_seriesTicker_idx" ON "WeatherStationMapping"("seriesTicker");
CREATE INDEX "WeatherStationMapping_stationId_idx" ON "WeatherStationMapping"("stationId");

ALTER TABLE "KalshiEvent" ADD CONSTRAINT "KalshiEvent_seriesTicker_fkey" FOREIGN KEY ("seriesTicker") REFERENCES "KalshiSeries"("seriesTicker") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "KalshiMarket" ADD CONSTRAINT "KalshiMarket_seriesTicker_fkey" FOREIGN KEY ("seriesTicker") REFERENCES "KalshiSeries"("seriesTicker") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "KalshiMarket" ADD CONSTRAINT "KalshiMarket_eventTicker_fkey" FOREIGN KEY ("eventTicker") REFERENCES "KalshiEvent"("eventTicker") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "KalshiOrderbookSnapshot" ADD CONSTRAINT "KalshiOrderbookSnapshot_marketTicker_fkey" FOREIGN KEY ("marketTicker") REFERENCES "KalshiMarket"("marketTicker") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MarketProbabilitySnapshot" ADD CONSTRAINT "MarketProbabilitySnapshot_marketTicker_fkey" FOREIGN KEY ("marketTicker") REFERENCES "KalshiMarket"("marketTicker") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AllocationPosition" ADD CONSTRAINT "AllocationPosition_allocationRunId_fkey" FOREIGN KEY ("allocationRunId") REFERENCES "AllocationRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
