"use client";

import { kalshiMarketHref } from "@/lib/links";
import type { AllocationRecommendation, RiskProfile } from "@dollarcast/shared";
import { Badge, Button, Card, Stat } from "@dollarcast/ui";
import { ExternalLink } from "lucide-react";
import { useState } from "react";

const riskLabels: Record<RiskProfile, string> = {
  conservative: "Conservative",
  balanced: "Balanced",
  aggressive: "Aggressive"
};

const pct = (value: number) => {
  if (value >= 0.999) return "99.9%";
  if (value <= 0.001) return "0.1%";
  return `${(value * 100).toFixed(1)}%`;
};

export function AllocationClient() {
  const [budget, setBudget] = useState(100);
  const [riskProfile, setRiskProfile] = useState<RiskProfile>("balanced");
  const [allocation, setAllocation] = useState<AllocationRecommendation | null>(null);
  const [mode, setMode] = useState<"live" | "demo" | "unavailable">("unavailable");
  const [loading, setLoading] = useState(false);

  async function run() {
    setLoading(true);
    const response = await fetch("/api/allocation", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ budget, riskProfile })
    });
    const data = await response.json();
    setAllocation(data.allocation);
    setMode(data.mode);
    setLoading(false);
  }

  const plTone = (value: number) => value < 0 ? "negative" : value > 0 ? "positive" : undefined;

  return (
    <div className="space-y-5">
      <Card>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 className="text-2xl font-semibold">Allocation</h1>
            <p className="mt-1 text-sm text-muted">Enter the exact amount to invest. If verified edge, liquidity, and risk constraints cannot support that amount, no exact allocation recommendation is shown.</p>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-sm text-muted">
              Amount to invest
              <input className="mt-1 h-10 w-32 rounded-md border border-border bg-panel2 px-3 text-white" type="number" value={budget} onChange={(e) => setBudget(Number(e.target.value))} />
            </label>
            <div className="flex gap-2">
              {[25, 50, 100, 250, 500].map((value) => <Button key={value} onClick={() => setBudget(value)}>${value}</Button>)}
            </div>
            <label className="text-sm text-muted">
              Risk profile
              <select className="mt-1 h-10 rounded-md border border-border bg-panel2 px-3 text-white" value={riskProfile} onChange={(e) => setRiskProfile(e.target.value as RiskProfile)}>
                <option value="conservative">Conservative</option>
                <option value="balanced">Balanced</option>
                <option value="aggressive">Aggressive</option>
              </select>
            </label>
            <Button onClick={run} disabled={loading}>{loading ? "Calculating" : "Calculate"}</Button>
          </div>
        </div>
      </Card>

      {mode === "demo" ? <Badge tone="warning">Demo data - not live market or forecast information.</Badge> : null}
      {mode === "unavailable" ? <Badge tone="negative">Live data unavailable</Badge> : null}

      {allocation ? (
        <>
          <div className="grid gap-3 md:grid-cols-4">
            <Card><Stat label="Recommended deployment" value={`$${allocation.recommendedDeployment.toFixed(2)}`} tone={allocation.recommendedDeployment > 0 ? "positive" : "warning"} /></Card>
            <Card><Stat label="Cash held back" value={`$${allocation.cashHeldBack.toFixed(2)}`} /></Card>
            <Card><Stat label="Estimated expected profit" value={`$${allocation.expectedProfit.toFixed(2)}`} tone="positive" /></Card>
            <Card><Stat label="Maximum possible loss" value={`$${allocation.maxPossibleLoss.toFixed(2)}`} tone="negative" /></Card>
            <Card><Stat label="Maximum upside" value={`$${allocation.maxPossibleProfit.toFixed(2)}`} tone="positive" /></Card>
            <Card><Stat label="Probability of profit" value={pct(allocation.probabilityOfProfit)} /></Card>
            <Card><Stat label="5th percentile P/L" value={`$${allocation.p05ProfitLoss.toFixed(2)}`} tone={plTone(allocation.p05ProfitLoss)} /></Card>
            <Card><Stat label="95% downside loss" value={`$${allocation.p05LossDollars.toFixed(2)}`} tone={allocation.p05LossDollars > 0 ? "negative" : undefined} /></Card>
            <Card><Stat label="Estimated fees" value={`$${allocation.totalEstimatedFees.toFixed(2)}`} /></Card>
          </div>
          {allocation.warnings.length ? <Card className="border-warning/50 text-warning">{allocation.warnings.join(" ")}</Card> : null}
          <Card className="p-0">
            <div className="border-b border-border p-4 font-semibold">{riskLabels[riskProfile]} allocation recommendation</div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1040px] text-sm">
                <thead className="bg-panel2 text-left text-xs uppercase text-muted">
                  <tr><th className="px-4 py-3">Market</th><th>Side</th><th>Model probability</th><th>Dollars</th><th>Contracts</th><th>Fill</th><th>Fee</th><th>Profit if correct</th><th>Loss if incorrect</th><th>Net edge</th><th>Correlation group</th></tr>
                </thead>
                <tbody>
                  {allocation.positions.map((position) => {
                    const kalshiHref = kalshiMarketHref({
                      contractUrl: position.contractUrl ?? null,
                      marketTicker: position.marketTicker,
                      eventTicker: position.eventTicker ?? "",
                      seriesTicker: position.seriesTicker ?? "",
                      rawTitle: position.rawTitle ?? position.marketTitle
                    });

                    return (
                      <tr className="border-t border-border" key={position.marketTicker + position.side}>
                        <td className="max-w-[420px] px-4 py-3">
                          <div className="flex items-start gap-2">
                            <div>
                              <div className="font-medium">{position.marketTitle}</div>
                              <div className="mt-1 text-xs text-muted">
                                {position.marketLocation ?? "Location unavailable"}
                                {position.marketEventTime ? ` | ${position.marketEventTime}` : null}
                              </div>
                              <div className="mt-1 text-xs text-muted">{position.marketTicker}</div>
                            </div>
                            <a className="ml-auto inline-flex shrink-0 items-center gap-1 text-source" href={kalshiHref} target="_blank" rel="noreferrer" aria-label={`View ${position.marketTicker} on Kalshi`}>
                              <ExternalLink size={14} /> Kalshi
                            </a>
                          </div>
                        </td>
                        <td>{position.side.toUpperCase()}</td>
                        <td>{position.side.toUpperCase()} {pct(position.modelProbability)}</td>
                        <td>${position.recommendedDollars.toFixed(2)}</td>
                        <td>{position.contracts.toFixed(2)}</td>
                        <td>{Math.round(position.averageExecutableFillPrice * 100)}c</td>
                        <td>${position.estimatedFee.toFixed(2)}</td>
                        <td className="text-positive">${position.profitIfCorrect.toFixed(2)}</td>
                        <td className="text-negative">${position.lossIfIncorrect.toFixed(2)}</td>
                        <td className="text-positive">{(position.netEdge * 100).toFixed(1)} pts</td>
                        <td>{position.correlationGroup}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      ) : null}
    </div>
  );
}
