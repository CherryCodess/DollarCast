import { getAdminStatus, type AdminStatus } from "@/lib/admin-status";
import { Badge, Card, Stat } from "@dollarcast/ui";
import { Activity, AlertTriangle, CheckCircle2, Clock, Database, RadioTower } from "lucide-react";
import type { ReactNode } from "react";

export const dynamic = "force-dynamic";

function badgeTone(status: "fresh" | "stale" | "unavailable") {
  if (status === "fresh") return "positive" as const;
  if (status === "stale") return "warning" as const;
  return "negative" as const;
}

function statusLabel(status: "fresh" | "stale" | "unavailable") {
  if (status === "fresh") return "Fresh";
  if (status === "stale") return "Stale";
  return "Unavailable";
}

function formatDate(value: string | null) {
  if (!value) return "Unavailable";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    timeZoneName: "short"
  }).format(new Date(value));
}

function formatDuration(ms: number | null) {
  if (ms == null) return "Unavailable";
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(1)} sec`;
}

function StatusBadge({ status }: { status: "fresh" | "stale" | "unavailable" }) {
  return <Badge tone={badgeTone(status)}>{statusLabel(status)}</Badge>;
}

function DetailRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 border-t border-border py-3 first:border-t-0">
      <div className="text-muted">{label}</div>
      <div className="max-w-[70%] text-right font-medium">{value}</div>
    </div>
  );
}

function SourceFreshnessTable({ status }: { status: AdminStatus }) {
  return (
    <Card className="p-0">
      <div className="flex items-center justify-between border-b border-border p-4">
        <div className="flex items-center gap-2 font-semibold"><RadioTower size={17} /> Weather Source Freshness</div>
        <Badge tone="source">NBM / HRRR / NWS / METAR</Badge>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-sm">
          <thead className="bg-panel2 text-left text-xs uppercase text-muted">
            <tr>
              <th className="px-4 py-3">Source</th>
              <th>Status</th>
              <th>Latest cached row</th>
              <th>Latest source time</th>
              <th>Recent rows</th>
              <th>Total rows</th>
              <th>Freshness window</th>
            </tr>
          </thead>
          <tbody>
            {status.weatherSources.map((source) => (
              <tr className="border-t border-border" key={source.name}>
                <td className="px-4 py-3 font-medium">{source.name}</td>
                <td><StatusBadge status={source.status} /></td>
                <td>{formatDate(source.latestCreatedAt)}</td>
                <td>{formatDate(source.latestSourceTime)}</td>
                <td>{source.recentRows.toLocaleString()}</td>
                <td>{source.totalRows.toLocaleString()}</td>
                <td>{Math.round(source.maxAgeSeconds / 60)} min</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

export default async function StatusPage() {
  const status = await getAdminStatus();

  return (
    <div className="space-y-5">
      <section className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">System Status</h1>
          <p className="mt-1 text-sm text-muted">Operational health for edge scans, market ingestion, weather inputs, mappings, and cached data.</p>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge status={status.overallStatus} />
          <span className="text-sm text-muted">Updated {formatDate(status.generatedAt)}</span>
        </div>
      </section>

      <div className="grid gap-3 md:grid-cols-4">
        <Card><Stat label="Edge scan" value={statusLabel(status.edgeScan.status)} tone={badgeTone(status.edgeScan.status)} /></Card>
        <Card><Stat label="Kalshi API" value={status.kalshi.circuitOpen ? "Circuit open" : "Available"} tone={status.kalshi.circuitOpen ? "warning" : "positive"} /></Card>
        <Card><Stat label="Weather worker" value={statusLabel(status.weatherWorker.status)} tone={badgeTone(status.weatherWorker.status)} /></Card>
        <Card><Stat label="Mapping issues" value={status.mappings.issueCount.toString()} tone={status.mappings.issueCount ? "warning" : "positive"} /></Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <div className="mb-2 flex items-center justify-between">
            <div className="flex items-center gap-2 font-semibold"><Activity size={17} /> Edge Scanner</div>
            <StatusBadge status={status.edgeScan.status} />
          </div>
          <DetailRow label="Last edge scan" value={formatDate(status.edgeScan.generatedAt)} />
          <DetailRow label="Market data refreshed" value={formatDate(status.edgeScan.lastRefreshed)} />
          <DetailRow label="Scan duration" value={formatDuration(status.edgeScan.durationMs)} />
          <DetailRow label="Cache source" value={status.edgeScan.candidateSource ?? "Unavailable"} />
          <DetailRow label="Supported markets scanned" value={status.edgeScan.marketCount.toLocaleString()} />
          <DetailRow label="Candidate sides scanned" value={status.edgeScan.scannedCandidateCount.toLocaleString()} />
          <DetailRow label="Eligible candidates" value={status.edgeScan.eligibleCandidateCount.toLocaleString()} />
          {status.edgeScan.error ? <DetailRow label="Latest warning" value={<span className="text-warning">{status.edgeScan.error}</span>} /> : null}
        </Card>

        <Card>
          <div className="mb-2 flex items-center justify-between">
            <div className="flex items-center gap-2 font-semibold"><CheckCircle2 size={17} /> Kalshi Ingestion</div>
            <StatusBadge status={status.kalshi.status} />
          </div>
          <DetailRow label="Circuit breaker" value={status.kalshi.circuitOpen ? "Open" : "Closed"} />
          <DetailRow label="Consecutive failures" value={status.kalshi.failures.toString()} />
          <DetailRow label="Circuit reopens until" value={status.kalshi.openedUntil ? formatDate(new Date(status.kalshi.openedUntil).toISOString()) : "Not active"} />
          <DetailRow label="Schema/mapping report" value={`${status.mappings.issueCount} issues across ${status.mappings.marketCount} supported markets`} />
          <DetailRow label="Mapping checked" value={formatDate(status.mappings.checkedAt)} />
        </Card>

        <Card>
          <div className="mb-2 flex items-center justify-between">
            <div className="flex items-center gap-2 font-semibold"><Clock size={17} /> Weather Worker</div>
            <StatusBadge status={status.weatherWorker.status} />
          </div>
          <DetailRow label="Weather service" value={<StatusBadge status={status.weatherWorker.serviceStatus} />} />
          <DetailRow label="Worker status" value={status.weatherWorker.workerStatus ?? "Unavailable"} />
          <DetailRow label="Started" value={formatDate(status.weatherWorker.startedAt)} />
          <DetailRow label="Completed" value={formatDate(status.weatherWorker.completedAt)} />
          <DetailRow label="Message" value={status.weatherWorker.message ?? "No worker message"} />
          {status.weatherWorker.error ? <DetailRow label="Service warning" value={<span className="text-warning">{status.weatherWorker.error}</span>} /> : null}
        </Card>

        <Card>
          <div className="mb-2 flex items-center justify-between">
            <div className="flex items-center gap-2 font-semibold"><Database size={17} /> Cached Data</div>
            <Badge tone="source">Postgres</Badge>
          </div>
          <DetailRow label="Kalshi markets" value={status.storage.kalshiMarkets.toLocaleString()} />
          <DetailRow label="Edge snapshots" value={status.storage.edgeSnapshots.toLocaleString()} />
          <DetailRow label="Probability snapshots" value={status.storage.probabilitySnapshots.toLocaleString()} />
          <DetailRow label="Weather forecast rows" value={status.storage.forecastRows.toLocaleString()} />
          <DetailRow label="METAR observation rows" value={status.storage.observationRows.toLocaleString()} />
          <DetailRow label="Refresh logs" value={status.storage.refreshLogs.toLocaleString()} />
          <DetailRow label="Retention cleanup" value={status.storage.retentionPolicy.enabled ? "Enabled" : "Disabled"} />
          <DetailRow label="Retention mode" value={status.storage.retentionPolicy.dryRun ? "Dry run" : "Deleting old data"} />
          <DetailRow label="Latest cleanup" value={formatDate(status.storage.latestRetentionCleanup.completedAt ?? status.storage.latestRetentionCleanup.startedAt)} />
          <DetailRow label="Cleanup message" value={status.storage.latestRetentionCleanup.message ?? "No cleanup has run yet"} />
        </Card>
      </div>

      <SourceFreshnessTable status={status} />

      <Card>
        <div className="mb-2 flex items-center justify-between">
          <div className="flex items-center gap-2 font-semibold"><Database size={17} /> Retention Policy</div>
          <Badge tone={status.storage.retentionPolicy.enabled ? "positive" : "warning"}>
            Every {Math.round(status.storage.retentionPolicy.intervalSeconds / 60)} min
          </Badge>
        </div>
        <div className="grid gap-x-8 text-sm md:grid-cols-2">
          <DetailRow label="Edge snapshots" value={`${status.storage.retentionPolicy.edgeSnapshotDays} days`} />
          <DetailRow label="Probability snapshots" value={`${status.storage.retentionPolicy.probabilitySnapshotDays} days`} />
          <DetailRow label="Order books" value={`${status.storage.retentionPolicy.orderbookSnapshotDays} days`} />
          <DetailRow label="Forecast rows" value={`${status.storage.retentionPolicy.forecastRunDays} days`} />
          <DetailRow label="METAR observations" value={`${status.storage.retentionPolicy.observationDays} days`} />
          <DetailRow label="Refresh logs" value={`${status.storage.retentionPolicy.refreshLogDays} days`} />
          <DetailRow label="Allocation runs" value={`${status.storage.retentionPolicy.allocationRunDays} days`} />
          <DetailRow label="GRIB cache" value={`${status.storage.retentionPolicy.gribCacheHours} hours at ${status.storage.retentionPolicy.gribCacheDir}`} />
        </div>
      </Card>

      {status.mappings.issueCount ? (
        <Card className="border-warning/50">
          <div className="flex items-center gap-2 font-semibold text-warning"><AlertTriangle size={17} /> Mapping Issues Detected</div>
          <p className="mt-2 text-sm text-muted">
            Some active supported markets have ambiguous settlement mappings. Those markets should remain excluded from allocation until verified.
          </p>
        </Card>
      ) : null}
    </div>
  );
}
