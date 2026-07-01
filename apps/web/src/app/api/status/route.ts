import { getLatestEdgeSnapshot } from "@/lib/edge-snapshots";
import { getKalshiCircuitState } from "@/lib/kalshi-client";
import { NextResponse } from "next/server";

export async function GET() {
  const snapshot = await getLatestEdgeSnapshot();
  if (!snapshot) {
    return NextResponse.json({
      status: "unavailable",
      message: "No edge scanner snapshot has been stored yet.",
      kalshi: getKalshiCircuitState()
    });
  }

  return NextResponse.json({
    status: snapshot.stale ? "stale" : "fresh",
    mode: snapshot.mode,
    scanId: snapshot.scanId,
    generatedAt: snapshot.generatedAt,
    lastRefreshed: snapshot.lastRefreshed,
    scanDurationMs: snapshot.scanDurationMs,
    scannedMarketCount: snapshot.scannedMarketCount ?? snapshot.markets.length,
    scannedCandidateCount: snapshot.scannedCandidateCount ?? snapshot.candidates.length,
    eligibleCandidateCount: snapshot.eligibleCandidateCount ?? snapshot.candidates.filter((candidate) => candidate.edge.eligible).length,
    candidateSource: snapshot.candidateSource,
    kalshi: getKalshiCircuitState(),
    error: snapshot.error
  });
}
