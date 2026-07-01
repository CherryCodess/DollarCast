ALTER TABLE "KalshiMarket"
ADD COLUMN "stationName" TEXT,
ADD COLUMN "stationLatitude" DOUBLE PRECISION,
ADD COLUMN "stationLongitude" DOUBLE PRECISION;

CREATE TABLE "MarketEdgeSnapshot" (
  "id" TEXT NOT NULL,
  "scanId" TEXT NOT NULL,
  "marketTicker" TEXT NOT NULL,
  "side" TEXT NOT NULL,
  "yesProbability" DOUBLE PRECISION NOT NULL,
  "noProbability" DOUBLE PRECISION NOT NULL,
  "modelProbability" DOUBLE PRECISION NOT NULL,
  "marketImpliedProbability" DOUBLE PRECISION NOT NULL,
  "executablePrice" DOUBLE PRECISION NOT NULL,
  "netEdge" DOUBLE PRECISION NOT NULL,
  "eligible" BOOLEAN NOT NULL,
  "confidence" TEXT NOT NULL,
  "estimatedFee" DOUBLE PRECISION NOT NULL,
  "feeMode" TEXT NOT NULL,
  "slippage" DOUBLE PRECISION NOT NULL,
  "uncertaintyBuffer" DOUBLE PRECISION NOT NULL,
  "sourceGeneratedAt" TIMESTAMP(3) NOT NULL,
  "sourceLinks" JSONB NOT NULL,
  "sourceTimestamps" JSONB,
  "reasons" TEXT[],
  "warnings" TEXT[],
  "eligibilityStatus" TEXT NOT NULL,
  "ineligibilityReasons" TEXT[],
  "candidatePayload" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "MarketEdgeSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "MarketEdgeSnapshot_scanId_idx" ON "MarketEdgeSnapshot"("scanId");
CREATE INDEX "MarketEdgeSnapshot_marketTicker_idx" ON "MarketEdgeSnapshot"("marketTicker");
CREATE INDEX "MarketEdgeSnapshot_eligible_netEdge_idx" ON "MarketEdgeSnapshot"("eligible", "netEdge");
CREATE INDEX "MarketEdgeSnapshot_sourceGeneratedAt_idx" ON "MarketEdgeSnapshot"("sourceGeneratedAt");

ALTER TABLE "MarketEdgeSnapshot"
ADD CONSTRAINT "MarketEdgeSnapshot_marketTicker_fkey"
FOREIGN KEY ("marketTicker") REFERENCES "KalshiMarket"("marketTicker")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "MarketEdgeSnapshot"
ADD CONSTRAINT "MarketEdgeSnapshot_scanId_fkey"
FOREIGN KEY ("scanId") REFERENCES "DataRefreshLog"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
