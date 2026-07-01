"use client";

import { kalshiMarketHref } from "@/lib/links";
import type { NormalizedMarket } from "@dollarcast/shared";
import type { SourceLink } from "@dollarcast/shared";
import { Badge, Button, Card } from "@dollarcast/ui";
import { ExternalLink, Filter } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

type Candidate = {
  marketTicker: string;
  side: "yes" | "no";
  yesProbability?: number;
  noProbability?: number;
  modelProbability: number;
  executablePrice: number;
  netEdge: number;
  eligible: boolean;
  confidence: "high" | "medium" | "low";
  recommendedDollars: number;
  estimatedExpectedProfit: number;
  sourceLinks?: SourceLink[];
};

const price = (value: number | null) => (value == null ? "-" : `${Math.round(value * 100)}\u00A2`);
const pct = (value: number | null | undefined) => {
  if (value == null) return "-";
  if (value >= 0.999) return "99.9%";
  if (value <= 0.001) return "0.1%";
  return `${(value * 100).toFixed(1)}%`;
};
const money = (value: number | null | undefined, digits = 2) => (value == null ? "-" : `$${value.toFixed(digits)}`);
const sideLabel = (side: "yes" | "no" | undefined) => side ? side.toUpperCase() : "SIDE";
const marketLocation = (market: NormalizedMarket) =>
  [market.cityName, market.stateCode].filter(Boolean).join(", ") ||
  market.stationName ||
  market.stationId ||
  "Location unavailable";
const marketTiming = (market: NormalizedMarket) =>
  [market.eventDateLocal, market.eventHourLocal].filter(Boolean).join(" at ");
const sourceTypes = (candidate: Candidate | undefined) => {
  const labels = [...new Set((candidate?.sourceLinks ?? [])
    .map((source) => source.sourceType.toUpperCase())
    .filter((sourceType) => ["NBM", "HRRR", "NWS", "METAR"].includes(sourceType)))];
  return labels.length ? labels.join(" / ") : "Sources";
};

export function MarketTable({
  markets,
  candidates,
  mode
}: {
  markets: NormalizedMarket[];
  candidates: Candidate[];
  mode: "live" | "demo" | "unavailable";
}) {
  const [edgeOnly, setEdgeOnly] = useState(false);
  const [type, setType] = useState("all");
  const byTicker = useMemo(() => {
    const map = new Map<string, Candidate>();
    for (const candidate of candidates) {
      const existing = map.get(candidate.marketTicker);
      if (!existing || (candidate.eligible && !existing.eligible) || candidate.netEdge > existing.netEdge) {
        map.set(candidate.marketTicker, candidate);
      }
    }
    return map;
  }, [candidates]);
  const rows = markets.filter((market) => {
    if (type !== "all" && market.marketType !== type) return false;
    if (!edgeOnly) return true;
    return Boolean(byTicker.get(market.marketTicker)?.eligible);
  });

  return (
    <Card className="p-0">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-4">
        <div>
          <h2 className="text-lg font-semibold">Climate Markets</h2>
          <p className="text-sm text-muted">All live Kalshi Daily Temperature and Hourly Temperature markets found in the current scan.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <select className="h-9 rounded-md border border-border bg-panel2 px-2 text-sm" value={type} onChange={(event) => setType(event.target.value)}>
            <option value="all">Daily / Hourly</option>
            <option value="daily_temperature">Daily Temperature</option>
            <option value="hourly_temperature">Hourly Temperature</option>
          </select>
          <Button onClick={() => setEdgeOnly((value) => !value)}>
            <Filter size={15} /> {edgeOnly ? "Show all" : "Edge only"}
          </Button>
          {mode === "demo" ? <Badge tone="warning">Demo data - not live market or forecast information.</Badge> : mode === "live" ? <Badge tone="positive">Live</Badge> : <Badge tone="negative">Live unavailable</Badge>}
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1120px] text-sm">
          <thead className="bg-panel2 text-left text-xs uppercase text-muted">
            <tr>
              <th className="px-4 py-3">Market</th>
              <th className="px-4 py-3">Outcome</th>
              <th className="px-4 py-3">Yes</th>
              <th className="px-4 py-3">No</th>
              <th className="px-4 py-3">Model probabilities</th>
              <th className="px-4 py-3">Net edge</th>
              <th className="px-4 py-3">Confidence</th>
              <th className="px-4 py-3">Model source</th>
              <th className="px-4 py-3">Volume</th>
              <th className="px-4 py-3">Liquidity</th>
              <th className="px-4 py-3">Kalshi</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((market) => {
              const candidate = byTicker.get(market.marketTicker);
              const isEdge = Boolean(candidate?.eligible);
              return (
                <tr key={market.marketTicker} className={isEdge ? "border-t border-positive/40 bg-positive/5 hover:bg-positive/10" : "border-t border-border hover:bg-panel2/60"}>
                  <td className="max-w-[380px] px-4 py-3">
                    <div className="flex items-start gap-2">
                      {isEdge ? <Badge tone="positive">Edge</Badge> : null}
                      <div>
                        <Link className="font-medium hover:text-source" href={`/market/${encodeURIComponent(market.marketTicker)}`}>
                          {market.eventTitle ?? market.rawTitle}
                        </Link>
                        <div className="mt-1 text-xs text-muted">{market.eventTitle ? market.rawTitle : null}</div>
                        <div className="mt-1 text-xs text-muted">
                          {marketLocation(market)}
                          {marketTiming(market) ? ` | ${marketTiming(market)}` : null}
                          {market.stationId ? ` | ${market.stationId}` : null}
                        </div>
                        <div className="mt-1 text-xs text-muted">{market.marketTicker}</div>
                      </div>
                    </div>
                    {market.parseStatus !== "verified" ? <div className="mt-1 text-xs text-warning">No estimate available - settlement terms or station mapping could not be verified.</div> : null}
                  </td>
                  <td className="px-4 py-3">{candidate?.side === "no" ? market.noSubtitle : market.yesSubtitle}</td>
                  <td className="px-4 py-3"><span className="inline-flex min-w-14 justify-center rounded border border-border bg-panel px-2 py-1 font-medium">{price(market.yesAsk)}</span></td>
                  <td className="px-4 py-3"><span className="inline-flex min-w-14 justify-center rounded border border-border bg-panel px-2 py-1 font-medium">{price(market.noAsk)}</span></td>
                  <td className="px-4 py-3">
                    {candidate ? (
                      <div className="space-y-1">
                        <div><span className="text-muted">YES</span> {pct(candidate.yesProbability ?? (candidate.side === "yes" ? candidate.modelProbability : 1 - candidate.modelProbability))}</div>
                        <div><span className="text-muted">NO</span> {pct(candidate.noProbability ?? (candidate.side === "no" ? candidate.modelProbability : 1 - candidate.modelProbability))}</div>
                        <div className="text-xs text-muted">Edge side: {sideLabel(candidate.side)}</div>
                      </div>
                    ) : "-"}
                  </td>
                  <td className={candidate && candidate.netEdge > 0 ? "px-4 py-3 text-positive" : "px-4 py-3 text-muted"}>{candidate ? `${(candidate.netEdge * 100).toFixed(1)} pts` : "-"}</td>
                  <td className="px-4 py-3"><Badge tone={candidate?.confidence === "low" ? "warning" : candidate ? "positive" : "default"}>{candidate?.confidence ?? "n/a"}</Badge></td>
                  <td className="px-4 py-3">
                    <Link className="inline-flex items-center gap-1 text-source" href={`/market/${encodeURIComponent(market.marketTicker)}#sources`}>
                      <ExternalLink size={13} /> {sourceTypes(candidate)}
                    </Link>
                  </td>
                  <td className="px-4 py-3">{market.volume ?? "-"}</td>
                  <td className="px-4 py-3">{market.liquidityDollars == null ? "-" : money(market.liquidityDollars, 0)}</td>
                  <td className="px-4 py-3"><a className="inline-flex items-center gap-1 text-source" href={kalshiMarketHref(market)} target="_blank" rel="noreferrer"><ExternalLink size={13} /> Kalshi</a></td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!rows.length ? (
          <div className="border-t border-border p-6 text-sm text-muted">
            No live Daily or Hourly Temperature markets are available to display. If this is unexpected, check Docker network access and Kalshi API availability.
          </div>
        ) : null}
      </div>
    </Card>
  );
}
