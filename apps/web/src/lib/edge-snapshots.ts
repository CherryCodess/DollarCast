import type { CandidateOpportunity, NormalizedMarket } from "@dollarcast/shared";
import { Prisma } from "@prisma/client";
import { env } from "./env";
import { buildCandidates, getMarkets } from "./market-service";
import { prisma } from "./prisma";

export type EdgeSnapshotCandidate = {
  marketTicker: string;
  side: "yes" | "no";
  yesProbability: number;
  noProbability: number;
  modelProbability: number;
  executablePrice: number;
  netEdge: number;
  eligible: boolean;
  confidence: "high" | "medium" | "low";
  estimatedFee: number;
  reasons: string[];
  warnings?: string[];
  sourceGeneratedAt?: string;
  eligibilityStatus?: "eligible" | "ineligible";
  ineligibilityReasons?: string[];
  recommendedDollars?: number;
  estimatedExpectedProfit?: number;
};

export type EdgeSnapshot = {
  markets: NormalizedMarket[];
  candidates: CandidateOpportunity[];
  candidateSummary: EdgeSnapshotCandidate[];
  mode: "live" | "demo" | "unavailable";
  lastRefreshed: string;
  generatedAt: string;
  scanDurationMs: number;
  scanId?: string;
  scannedMarketCount?: number;
  scannedCandidateCount?: number;
  eligibleCandidateCount?: number;
  candidateSource?: "edge_snapshots" | "scan_payload" | "live_fallback";
  stale?: boolean;
  error?: string;
};

function marketToPrisma(market: NormalizedMarket) {
  return {
    eventTicker: market.eventTicker,
    seriesTicker: market.seriesTicker,
    rawTitle: market.rawTitle,
    rawSubtitle: market.rawSubtitle,
    yesSubtitle: market.yesSubtitle,
    noSubtitle: market.noSubtitle,
    marketType: market.marketType,
    direction: market.direction,
    cityName: market.cityName,
    stateCode: market.stateCode,
    eventDateLocal: market.eventDateLocal,
    eventHourLocal: market.eventHourLocal,
    timezone: market.timezone,
    rangeLowerF: market.rangeLowerF,
    rangeUpperF: market.rangeUpperF,
    lowerInclusive: market.lowerInclusive,
    upperInclusive: market.upperInclusive,
    stationId: market.stationId,
    stationName: market.stationName,
    stationLatitude: market.stationLatitude,
    stationLongitude: market.stationLongitude,
    settlementSourceName: market.settlementSourceName,
    settlementSourceUrl: market.settlementSourceUrl,
    contractUrl: market.contractUrl,
    contractTermsUrl: market.contractTermsUrl,
    closeTime: new Date(market.closeTime),
    expirationTime: market.expirationTime ? new Date(market.expirationTime) : null,
    yesBid: market.yesBid,
    yesAsk: market.yesAsk,
    noBid: market.noBid,
    noAsk: market.noAsk,
    lastPrice: market.lastPrice,
    volume: market.volume,
    volume24h: market.volume24h,
    openInterest: market.openInterest,
    liquidityDollars: market.liquidityDollars,
    fractionalTradingEnabled: market.fractionalTradingEnabled,
    rawRulesPrimary: market.rawRulesPrimary,
    rawRulesSecondary: market.rawRulesSecondary,
    parseStatus: market.parseStatus,
    parseWarnings: market.parseWarnings,
    rawPayload: market as unknown as Prisma.InputJsonValue
  };
}

function summarizeCandidate(candidate: CandidateOpportunity): EdgeSnapshotCandidate {
  return {
    marketTicker: candidate.market.marketTicker,
    side: candidate.edge.side,
    yesProbability: candidate.probability.yesProbability,
    noProbability: candidate.probability.noProbability,
    modelProbability: candidate.edge.modelProbability,
    executablePrice: candidate.edge.executablePrice,
    netEdge: candidate.edge.netEdge,
    eligible: candidate.edge.eligible,
    confidence: candidate.probability.confidence,
    estimatedFee: candidate.fee.totalFeeDollars,
    reasons: candidate.edge.reasons,
    warnings: candidate.probability.warnings,
    eligibilityStatus: candidate.edge.eligible ? "eligible" : "ineligible",
    ineligibilityReasons: candidate.edge.eligible ? [] : candidate.edge.reasons
  };
}

async function persistMarkets(markets: NormalizedMarket[]) {
  for (const market of markets) {
    await prisma.kalshiSeries.upsert({
      where: { seriesTicker: market.seriesTicker },
      create: {
        seriesTicker: market.seriesTicker,
        title: market.seriesTicker,
        category: "Climate",
        tags: [market.marketType],
        rawPayload: { seriesTicker: market.seriesTicker, source: "edge-scanner" }
      },
      update: {
        tags: [market.marketType],
        rawPayload: { seriesTicker: market.seriesTicker, source: "edge-scanner" }
      }
    });

    await prisma.kalshiEvent.upsert({
      where: { eventTicker: market.eventTicker },
      create: {
        eventTicker: market.eventTicker,
        seriesTicker: market.seriesTicker,
        title: market.eventTitle ?? market.rawTitle,
        rawPayload: { eventTicker: market.eventTicker, source: "edge-scanner" }
      },
      update: {
        seriesTicker: market.seriesTicker,
        title: market.eventTitle ?? market.rawTitle,
        rawPayload: { eventTicker: market.eventTicker, source: "edge-scanner" }
      }
    });

    await prisma.kalshiMarket.upsert({
      where: { marketTicker: market.marketTicker },
      create: {
        marketTicker: market.marketTicker,
        ...marketToPrisma(market)
      },
      update: marketToPrisma(market)
    });
  }
}

async function persistProbabilitySnapshots(candidates: CandidateOpportunity[]) {
  const latestByMarket = new Map<string, CandidateOpportunity>();
  for (const candidate of candidates) {
    const existing = latestByMarket.get(candidate.market.marketTicker);
    if (!existing || candidate.edge.netEdge > existing.edge.netEdge) {
      latestByMarket.set(candidate.market.marketTicker, candidate);
    }
  }

  for (const candidate of latestByMarket.values()) {
    await prisma.marketProbabilitySnapshot.create({
      data: {
        marketTicker: candidate.market.marketTicker,
        yesProbability: candidate.probability.yesProbability,
        noProbability: candidate.probability.noProbability,
        meanTemperatureF: candidate.probability.meanTemperatureF,
        medianTemperatureF: candidate.probability.medianTemperatureF,
        p10TemperatureF: candidate.probability.p10TemperatureF,
        p25TemperatureF: candidate.probability.p25TemperatureF,
        p75TemperatureF: candidate.probability.p75TemperatureF,
        p90TemperatureF: candidate.probability.p90TemperatureF,
        confidence: candidate.probability.confidence,
        uncertaintyF: candidate.probability.uncertaintyF,
        modelInputs: candidate.probability.modelInputs,
        reasons: candidate.probability.reasons,
        warnings: candidate.probability.warnings,
        sourceLinks: candidate.probability.sourceLinks as unknown as Prisma.InputJsonValue,
        marketPriceSnapshot: {
          yesBid: candidate.market.yesBid,
          yesAsk: candidate.market.yesAsk,
          noBid: candidate.market.noBid,
          noAsk: candidate.market.noAsk,
          side: candidate.edge.side,
          executablePrice: candidate.edge.executablePrice,
          netEdge: candidate.edge.netEdge,
          eligible: candidate.edge.eligible,
          fill: candidate.fill
        } as unknown as Prisma.InputJsonValue,
        feeEstimate: candidate.fee as unknown as Prisma.InputJsonValue
      }
    });
  }
}

async function persistEdgeSnapshots(scanId: string, candidates: CandidateOpportunity[], sourceGeneratedAt: Date) {
  for (const candidate of candidates) {
    await prisma.marketEdgeSnapshot.create({
      data: {
        scanId,
        marketTicker: candidate.market.marketTicker,
        side: candidate.edge.side,
        yesProbability: candidate.probability.yesProbability,
        noProbability: candidate.probability.noProbability,
        modelProbability: candidate.edge.modelProbability,
        marketImpliedProbability: candidate.edge.impliedProbability,
        executablePrice: candidate.edge.executablePrice,
        netEdge: candidate.edge.netEdge,
        eligible: candidate.edge.eligible,
        confidence: candidate.probability.confidence,
        estimatedFee: candidate.fee.totalFeeDollars,
        feeMode: candidate.fee.feeMode,
        slippage: candidate.fill.slippageVsBestAsk,
        uncertaintyBuffer: candidate.edge.uncertaintyBuffer,
        sourceGeneratedAt,
        sourceLinks: candidate.probability.sourceLinks as unknown as Prisma.InputJsonValue,
        sourceTimestamps: {
          generatedAt: sourceGeneratedAt.toISOString(),
          marketLastRefreshed: sourceGeneratedAt.toISOString()
        },
        reasons: candidate.edge.reasons,
        warnings: candidate.probability.warnings,
        eligibilityStatus: candidate.edge.eligible ? "eligible" : "ineligible",
        ineligibilityReasons: candidate.edge.eligible ? [] : candidate.edge.reasons,
        candidatePayload: candidate as unknown as Prisma.InputJsonValue
      }
    });
  }
}

function candidateFromEdgeRow(row: {
  candidatePayload: Prisma.JsonValue;
}): CandidateOpportunity | null {
  const payload = row.candidatePayload as unknown;
  if (!payload || typeof payload !== "object") return null;
  return payload as CandidateOpportunity;
}

function summarizeEdgeRow(row: {
  marketTicker: string;
  side: string;
  yesProbability: number;
  noProbability: number;
  modelProbability: number;
  executablePrice: number;
  netEdge: number;
  eligible: boolean;
  confidence: string;
  estimatedFee: number;
  reasons: string[];
  warnings: string[];
  sourceGeneratedAt: Date;
  eligibilityStatus: string;
  ineligibilityReasons: string[];
}): EdgeSnapshotCandidate {
  return {
    marketTicker: row.marketTicker,
    side: row.side === "no" ? "no" : "yes",
    yesProbability: row.yesProbability,
    noProbability: row.noProbability,
    modelProbability: row.modelProbability,
    executablePrice: row.executablePrice,
    netEdge: row.netEdge,
    eligible: row.eligible,
    confidence: row.confidence === "high" || row.confidence === "medium" ? row.confidence : "low",
    estimatedFee: row.estimatedFee,
    reasons: row.reasons,
    warnings: row.warnings,
    sourceGeneratedAt: row.sourceGeneratedAt.toISOString(),
    eligibilityStatus: row.eligibilityStatus === "eligible" ? "eligible" : "ineligible",
    ineligibilityReasons: row.ineligibilityReasons
  };
}

export async function refreshEdgeSnapshot(contracts = 10): Promise<EdgeSnapshot> {
  const startedAt = new Date();
  const log = await prisma.dataRefreshLog.create({
    data: {
      source: "edge-scanner",
      status: "running",
      startedAt
    }
  });

  try {
    const marketData = await getMarkets();
    const candidates = await buildCandidates(marketData.markets, contracts);
    await persistMarkets(marketData.markets);
    await persistProbabilitySnapshots(candidates);

    const completedAt = new Date();
    await persistEdgeSnapshots(log.id, candidates, completedAt);
    const snapshot: EdgeSnapshot = {
      markets: marketData.markets,
      candidates,
      candidateSummary: candidates.map(summarizeCandidate),
      mode: marketData.mode,
      lastRefreshed: marketData.lastRefreshed,
      generatedAt: completedAt.toISOString(),
      scanDurationMs: completedAt.getTime() - startedAt.getTime(),
      scanId: log.id,
      scannedMarketCount: marketData.markets.length,
      scannedCandidateCount: candidates.length,
      eligibleCandidateCount: candidates.filter((candidate) => candidate.edge.eligible).length,
      candidateSource: "edge_snapshots",
      stale: marketData.stale,
      error: marketData.error
    };

    await prisma.dataRefreshLog.update({
      where: { id: log.id },
      data: {
        status: marketData.error ? "degraded" : "success",
        completedAt,
        message: marketData.error ?? `Scanned ${marketData.markets.length} markets and ${candidates.length} candidate sides.`,
        rawPayload: snapshot as unknown as Prisma.InputJsonValue
      }
    });
    return snapshot;
  } catch (error) {
    await prisma.dataRefreshLog.update({
      where: { id: log.id },
      data: {
        status: "error",
        completedAt: new Date(),
        message: error instanceof Error ? error.message : "Edge scanner failed."
      }
    });
    throw error;
  }
}

export async function getLatestEdgeSnapshot(maxAgeSeconds = env.probabilityCacheSeconds): Promise<EdgeSnapshot | null> {
  const row = await prisma.dataRefreshLog.findFirst({
    where: {
      source: "edge-scanner",
      status: { in: ["success", "degraded"] },
      rawPayload: { not: Prisma.DbNull }
    },
    orderBy: { completedAt: "desc" }
  });
  if (!row?.rawPayload || !row.completedAt) return null;
  const storedSnapshot = row.rawPayload as unknown as EdgeSnapshot;
  const edgeRows = await prisma.marketEdgeSnapshot.findMany({
    where: { scanId: row.id },
    orderBy: [{ eligible: "desc" }, { netEdge: "desc" }]
  });
  const rowCandidates = edgeRows
    .map(candidateFromEdgeRow)
    .filter((candidate): candidate is CandidateOpportunity => Boolean(candidate));
  const snapshot: EdgeSnapshot = {
    ...storedSnapshot,
    scanId: row.id,
    candidates: rowCandidates.length ? rowCandidates : storedSnapshot.candidates,
    candidateSummary: edgeRows.length ? edgeRows.map(summarizeEdgeRow) : storedSnapshot.candidateSummary,
    scannedMarketCount: storedSnapshot.scannedMarketCount ?? storedSnapshot.markets.length,
    scannedCandidateCount: edgeRows.length ? edgeRows.length : storedSnapshot.scannedCandidateCount ?? storedSnapshot.candidates.length,
    eligibleCandidateCount:
      edgeRows.length
        ? edgeRows.filter((edgeRow) => edgeRow.eligible).length
        : storedSnapshot.eligibleCandidateCount ?? storedSnapshot.candidates.filter((candidate) => candidate.edge.eligible).length,
    candidateSource: edgeRows.length ? "edge_snapshots" : "scan_payload"
  };
  const ageMs = Date.now() - row.completedAt.getTime();
  return {
    ...snapshot,
    stale: snapshot.stale || ageMs > maxAgeSeconds * 1000,
    error: ageMs > maxAgeSeconds * 1000 ? "Cached edge snapshot is stale; background scanner has not refreshed recently." : snapshot.error
  };
}
