import { EdgeScanRefresh } from "@/components/edge-scan-refresh";
import { MarketTable } from "@/components/market-table";
import { getLatestEdgeSnapshot } from "@/lib/edge-snapshots";
import { getCandidateData, getMarkets } from "@/lib/market-service";
import { recommendAllocation } from "@dollarcast/shared";
import { Card, Stat } from "@dollarcast/ui";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const snapshot = await getLatestEdgeSnapshot();
  const data = snapshot
    ? {
        markets: snapshot.markets,
        mode: snapshot.mode,
        lastRefreshed: snapshot.lastRefreshed,
        error: snapshot.error,
        stale: snapshot.stale
      }
    : await getMarkets();
  const candidateData = snapshot ?? await getCandidateData(10);
  const candidates = candidateData.candidates;
  const eligible = candidates.filter((candidate) => candidate.edge.eligible);
  const allocation = recommendAllocation({ budget: 100, riskProfile: "balanced" }, candidates);
  const positionsByTicker = new Map(allocation.positions.map((position) => [position.marketTicker, position]));
  return (
    <div className="space-y-5">
      <section>
        <h1 className="text-3xl font-semibold tracking-normal">$cast</h1>
        <p className="mt-1 text-muted">Weather market intelligence.</p>
        <p className="mt-2 max-w-4xl text-sm text-muted">Compare live Kalshi Climate market prices against calibrated NOAA-based weather probabilities, then estimate a conservative allocation across positive-edge opportunities.</p>
      </section>
      <div className="grid gap-3 md:grid-cols-4">
        <Card><Stat label="Supported open markets" value={data.markets.filter((m) => m.marketType !== "unsupported").length} /></Card>
        <Card><Stat label="Positive-edge candidates" value={eligible.length} tone="positive" /></Card>
        <Card><Stat label="Default minimum net edge" value="5 pts" /></Card>
        <Card><Stat label="Mode" value={data.mode === "demo" ? "Demo" : data.mode === "live" ? "Live" : "Unavailable"} tone={data.mode === "demo" ? "warning" : data.mode === "live" ? "positive" : "negative"} /></Card>
      </div>
      <Card>
        <div className="grid gap-3 text-sm md:grid-cols-4">
          <div>
            <div className="text-muted">Edge cache</div>
            <div className={data.stale ? "font-medium text-warning" : "font-medium text-positive"}>{data.stale ? "Stale" : "Fresh"}</div>
          </div>
          <div>
            <div className="text-muted">Candidate source</div>
            <div className="font-medium">{snapshot?.candidateSource ?? "live_fallback"}</div>
          </div>
          <div>
            <div className="text-muted">Scanned sides</div>
            <div className="font-medium">{snapshot?.scannedCandidateCount ?? candidates.length}</div>
          </div>
          <div>
            <div className="text-muted">Last edge scan</div>
            <EdgeScanRefresh initialScanId={snapshot?.scanId ?? null} generatedAt={snapshot?.generatedAt ?? null} />
          </div>
        </div>
      </Card>
      {data.error ? <Card className="border-negative/50 text-sm text-negative">Live data unavailable: {data.error}</Card> : null}
      <MarketTable
        markets={data.markets}
        mode={data.mode}
        candidates={candidates.map((candidate) => ({
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
          recommendedDollars: positionsByTicker.get(candidate.market.marketTicker)?.recommendedDollars ?? 0,
          estimatedExpectedProfit: positionsByTicker.get(candidate.market.marketTicker)?.estimatedExpectedProfit ?? 0
        }))}
      />
    </div>
  );
}
