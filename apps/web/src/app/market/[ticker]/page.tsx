import { getMarket, getOrderBook, getProbability } from "@/lib/market-service";
import { ForecastChart } from "@/components/forecast-chart";
import { getLatestEdgeSnapshot } from "@/lib/edge-snapshots";
import { kalshiMarketHref } from "@/lib/links";
import { Badge, Card, Stat } from "@dollarcast/ui";
import { ExternalLink } from "lucide-react";
import { notFound } from "next/navigation";

const pct = (value: number) => {
  if (value >= 0.999) return "99.9%";
  if (value <= 0.001) return "0.1%";
  return `${(value * 100).toFixed(1)}%`;
};

export default async function MarketDetailPage({ params }: { params: Promise<{ ticker: string }> }) {
  const { ticker } = await params;
  const decodedTicker = decodeURIComponent(ticker);
  const snapshot = await getLatestEdgeSnapshot();
  const snapshotMarket = snapshot?.markets.find((item) => item.marketTicker === decodedTicker) ?? null;
  const fallback = snapshotMarket ? null : await getMarket(decodedTicker);
  const market = snapshotMarket ?? fallback?.market ?? null;
  const mode = snapshot?.mode ?? fallback?.mode ?? "unavailable";
  if (!market) notFound();
  const snapshotCandidate = snapshot?.candidates.find((candidate) => candidate.market.marketTicker === market.marketTicker) ?? null;
  const probability = snapshotCandidate?.probability ?? await getProbability(market);
  const orderBook = await getOrderBook(market);
  const yesProb = probability?.yesProbability ?? 0;
  const implied = market.yesAsk ?? 0;
  const net = snapshotCandidate?.edge.netEdge ?? yesProb - implied - 0.03;
  const dist = probability?.simulation?.temperaturesF?.slice(0, 24).map((value, i) => ({ bucket: i + 1, value })) ?? [];
  const location = [market.cityName, market.stateCode].filter(Boolean).join(", ") || market.stationName || market.stationId || "Location unavailable";
  const timing = [market.eventDateLocal, market.eventHourLocal].filter(Boolean).join(" at ");
  return (
    <div className="space-y-5">
      {mode === "demo" ? <Badge tone="warning">Demo data — not live market or forecast information.</Badge> : null}
      <Card>
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div>
            <h1 className="max-w-4xl text-2xl font-semibold">{market.eventTitle ?? market.rawTitle}</h1>
            {market.eventTitle ? <p className="mt-2 text-sm text-muted">{market.rawTitle}</p> : null}
            <p className="mt-2 text-sm text-muted">
              {location}
              {timing ? ` | ${timing}` : null}
              {market.stationId ? ` | ${market.stationId}` : null}
            </p>
            <p className="mt-2 text-sm text-muted">{market.yesSubtitle} / {market.noSubtitle}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Badge tone={market.parseStatus === "verified" ? "positive" : "warning"}>{market.parseStatus}</Badge>
              <Badge>{market.marketType}</Badge>
              <Badge>{market.stationId ?? "station unverified"}</Badge>
            </div>
          </div>
          <a className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm text-source" href={kalshiMarketHref(market)} target="_blank" rel="noreferrer"><ExternalLink size={15} /> View on Kalshi</a>
        </div>
      </Card>
      <div className="grid gap-3 md:grid-cols-4">
        <Card><Stat label="Live Yes price" value={market.yesAsk == null ? "—" : `${Math.round(market.yesAsk * 100)}¢`} /></Card>
        <Card><Stat label="Live No price" value={market.noAsk == null ? "—" : `${Math.round(market.noAsk * 100)}¢`} /></Card>
        <Card><Stat label="Model-estimated Yes probability" value={probability ? pct(probability.yesProbability) : "Unavailable"} tone="positive" /></Card>
        <Card><Stat label="Model-estimated No probability" value={probability ? pct(probability.noProbability) : "Unavailable"} /></Card>
        <Card><Stat label="Estimated net edge" value={`${(net * 100).toFixed(1)} pts`} tone={net > 0 ? "positive" : "negative"} /></Card>
      </div>
      <section className="grid gap-5 xl:grid-cols-[1.2fr_0.8fr]">
        <Card>
          <h2 className="font-semibold">Overview</h2>
          <p className="mt-3 text-sm text-muted">Why $cast sees a difference: the model evaluates a full correlated temperature distribution against the exact contract interval, then subtracts estimated fees, slippage, and an uncertainty buffer.</p>
          {probability?.warnings.map((warning) => <p className="mt-2 text-sm text-warning" key={warning}>{warning}</p>)}
        </Card>
        <Card>
          <h2 className="font-semibold">Allocation</h2>
          <p className="mt-3 text-sm text-muted">Recommended maximum for this market depends on budget, risk profile, executable liquidity, fees, and city/day concentration.</p>
          <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
            <div>Estimated fee: centralized taker fee estimate</div>
            <div>Expected profit: scenario-weighted estimate</div>
            <div>Maximum profit if selected contracts resolve favorably</div>
            <div>Maximum possible loss</div>
          </div>
        </Card>
      </section>
      <section className="grid gap-5 xl:grid-cols-2">
        <Card className="h-80">
          <h2 className="mb-3 font-semibold">Forecast</h2>
          <ForecastChart data={dist} />
        </Card>
        <Card>
          <h2 className="font-semibold">Order Book</h2>
          <div className="mt-3 grid grid-cols-2 gap-4 text-sm">
            <div>
              <h3 className="text-muted">Yes bids</h3>
              {orderBook?.yesBids.map((level) => <div key={level.price} className="mt-2 flex justify-between"><span>{Math.round(level.price * 100)}¢</span><span>{level.quantity}</span></div>)}
            </div>
            <div>
              <h3 className="text-muted">No bids</h3>
              {orderBook?.noBids.map((level) => <div key={level.price} className="mt-2 flex justify-between"><span>{Math.round(level.price * 100)}¢</span><span>{level.quantity}</span></div>)}
            </div>
          </div>
        </Card>
      </section>
      <Card id="sources">
        <h2 className="font-semibold">Sources</h2>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          {probability?.sourceLinks.map((source) => (
            <a className="rounded-md border border-border p-3 text-sm hover:border-source" key={`${source.sourceType}-${source.label}-${source.url}`} href={source.url} target="_blank" rel="noreferrer">
              <div className="text-xs uppercase text-muted">{source.sourceType}</div>
              <div className="mt-1 font-medium text-source">{source.label}</div>
              <div className="mt-1 text-muted">{source.whyItMatters}</div>
              {source.observedAt ? <div className="mt-2 text-xs text-muted">{source.observedAt}</div> : null}
            </a>
          ))}
        </div>
      </Card>
      <Card>
        <h2 className="font-semibold">Rules</h2>
        <pre className="mt-3 whitespace-pre-wrap text-sm text-muted">{market.rawRulesPrimary ?? "No primary rules returned."}{"\n\n"}{market.rawRulesSecondary ?? ""}</pre>
      </Card>
    </div>
  );
}
