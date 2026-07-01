import { getLatestEdgeSnapshot } from "./edge-snapshots";
import { getMarkets } from "./market-service";

type MappingIssue = {
  seriesTicker: string;
  eventTicker: string;
  marketTicker: string;
  title: string;
  cityName: string | null;
  stationId: string | null;
  parseStatus: string;
  warnings: string[];
};

export type SettlementMappingReport = {
  generatedAt: string;
  marketCount: number;
  issueCount: number;
  series: Array<{
    seriesTicker: string;
    marketCount: number;
    issueCount: number;
    status: "verified" | "needs_review";
    issues: MappingIssue[];
  }>;
};

function isMappingWarning(warning: string): boolean {
  const text = warning.toLowerCase();
  return text.includes("mapping") ||
    text.includes("settlement") ||
    text.includes("station") ||
    text.includes("source") ||
    text.includes("timezone");
}

export async function buildSettlementMappingReport(): Promise<SettlementMappingReport> {
  const snapshot = await getLatestEdgeSnapshot();
  const data = snapshot ? { markets: snapshot.markets } : await getMarkets();
  const supported = data.markets.filter((market) => market.marketType === "daily_temperature" || market.marketType === "hourly_temperature");
  const bySeries = new Map<string, { marketCount: number; issues: MappingIssue[] }>();

  for (const market of supported) {
    const seriesTicker = market.seriesTicker || "UNKNOWN";
    const entry = bySeries.get(seriesTicker) ?? { marketCount: 0, issues: [] };
    entry.marketCount += 1;
    const warnings = [
      ...market.parseWarnings.filter(isMappingWarning),
      ...(seriesTicker === "UNKNOWN" ? ["Series ticker could not be resolved for this active market."] : [])
    ];
    if (market.parseStatus !== "verified" || warnings.length || seriesTicker === "UNKNOWN") {
      entry.issues.push({
        seriesTicker,
        eventTicker: market.eventTicker,
        marketTicker: market.marketTicker,
        title: market.eventTitle ?? market.rawTitle,
        cityName: market.cityName,
        stationId: market.stationId,
        parseStatus: market.parseStatus,
        warnings: warnings.length ? warnings : market.parseWarnings
      });
    }
    bySeries.set(seriesTicker, entry);
  }

  const series = [...bySeries.entries()]
    .map(([seriesTicker, entry]) => ({
      seriesTicker,
      marketCount: entry.marketCount,
      issueCount: entry.issues.length,
      status: entry.issues.length ? "needs_review" as const : "verified" as const,
      issues: entry.issues
    }))
    .sort((a, b) => b.issueCount - a.issueCount || a.seriesTicker.localeCompare(b.seriesTicker));

  return {
    generatedAt: new Date().toISOString(),
    marketCount: supported.length,
    issueCount: series.reduce((sum, item) => sum + item.issueCount, 0),
    series
  };
}
