import { getAdminStatus } from "@/lib/admin-status";
import { NextResponse } from "next/server";

function metric(name: string, value: number, labels: Record<string, string> = {}) {
  const suffix = Object.keys(labels).length
    ? `{${Object.entries(labels).map(([key, item]) => `${key}="${item.replaceAll('"', '\\"')}"`).join(",")}}`
    : "";
  return `${name}${suffix} ${Number.isFinite(value) ? value : 0}`;
}

export async function GET() {
  const status = await getAdminStatus();
  const lines = [
    "# HELP dollarcast_edge_scan_duration_ms Last edge scan duration.",
    "# TYPE dollarcast_edge_scan_duration_ms gauge",
    metric("dollarcast_edge_scan_duration_ms", status.edgeScan.durationMs ?? 0),
    "# HELP dollarcast_edge_scanned_markets Latest scanned market count.",
    "# TYPE dollarcast_edge_scanned_markets gauge",
    metric("dollarcast_edge_scanned_markets", status.edgeScan.marketCount),
    metric("dollarcast_edge_scanned_candidates", status.edgeScan.scannedCandidateCount),
    metric("dollarcast_edge_eligible_candidates", status.edgeScan.eligibleCandidateCount),
    metric("dollarcast_kalshi_circuit_open", status.kalshi.circuitOpen ? 1 : 0),
    metric("dollarcast_mapping_issues", status.mappings.issueCount),
    metric("dollarcast_storage_edge_snapshots", status.storage.edgeSnapshots),
    metric("dollarcast_storage_probability_snapshots", status.storage.probabilitySnapshots),
    metric("dollarcast_storage_forecast_rows", status.storage.forecastRows),
    metric("dollarcast_storage_observation_rows", status.storage.observationRows),
    ...status.weatherSources.map((source) => metric("dollarcast_weather_source_fresh", source.status === "fresh" ? 1 : 0, { source: source.name })),
    ...status.weatherSources.map((source) => metric("dollarcast_weather_source_recent_rows", source.recentRows, { source: source.name }))
  ];

  return new NextResponse(`${lines.join("\n")}\n`, {
    headers: { "content-type": "text/plain; version=0.0.4; charset=utf-8" }
  });
}
