import { getLatestEdgeSnapshot } from "@/lib/edge-snapshots";
import { getCandidateData, getMarkets } from "@/lib/market-service";
import { NextResponse } from "next/server";

export async function GET() {
  const snapshot = await getLatestEdgeSnapshot();
  const [data, candidateData] = snapshot
    ? [
        {
          markets: snapshot.markets,
          mode: snapshot.mode,
          lastRefreshed: snapshot.lastRefreshed,
          error: snapshot.error,
          stale: snapshot.stale
        },
        snapshot
      ]
    : await Promise.all([getMarkets(), getCandidateData(10)]);
  return NextResponse.json({
    ...data,
    error: data.error ?? candidateData.error,
    stale: data.stale ?? candidateData.stale,
    candidates: candidateData.candidates.map((candidate) => ({
      marketTicker: candidate.market.marketTicker,
      side: candidate.edge.side,
      yesProbability: candidate.probability.yesProbability,
      noProbability: candidate.probability.noProbability,
      modelProbability: candidate.edge.modelProbability,
      executablePrice: candidate.edge.executablePrice,
      netEdge: candidate.edge.netEdge,
      eligible: candidate.edge.eligible,
      confidence: candidate.probability.confidence,
      sourceLinks: candidate.probability.sourceLinks,
      estimatedFee: candidate.fee.totalFeeDollars,
      reasons: candidate.edge.reasons,
      warnings: candidate.probability.warnings
    })),
    scan: {
      scanId: snapshot?.scanId,
      generatedAt: snapshot?.generatedAt,
      scanDurationMs: snapshot?.scanDurationMs,
      scannedMarketCount: snapshot?.scannedMarketCount ?? data.markets.length,
      scannedCandidateCount: snapshot?.scannedCandidateCount ?? candidateData.candidates.length,
      eligibleCandidateCount: snapshot?.eligibleCandidateCount ?? candidateData.candidates.filter((candidate) => candidate.edge.eligible).length,
      candidateSource: snapshot?.candidateSource ?? (snapshot ? "scan_payload" : "live_fallback")
    }
  });
}
