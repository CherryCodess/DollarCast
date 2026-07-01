import { buildSettlementMappingReport } from "@/lib/settlement-report";
import { getKalshiCircuitState } from "./kalshi-client";
import { env } from "./env";
import { getLatestEdgeSnapshot } from "./edge-snapshots";
import { prisma } from "./prisma";

type Freshness = "fresh" | "stale" | "unavailable";

export type StatusSourceFreshness = {
  name: string;
  status: Freshness;
  latestCreatedAt: string | null;
  latestSourceTime: string | null;
  recentRows: number;
  totalRows: number;
  maxAgeSeconds: number;
};

export type AdminStatus = {
  generatedAt: string;
  overallStatus: Freshness;
  edgeScan: {
    status: Freshness;
    scanId: string | null;
    generatedAt: string | null;
    lastRefreshed: string | null;
    durationMs: number | null;
    marketCount: number;
    scannedCandidateCount: number;
    eligibleCandidateCount: number;
    candidateSource: string | null;
    error: string | null;
  };
  kalshi: {
    status: Freshness;
    failures: number;
    circuitOpen: boolean;
    openedUntil: number;
  };
  weatherWorker: {
    status: Freshness;
    serviceStatus: Freshness;
    workerStatus: string | null;
    startedAt: string | null;
    completedAt: string | null;
    message: string | null;
    error: string | null;
  };
  weatherSources: StatusSourceFreshness[];
  mappings: {
    status: Freshness;
    marketCount: number;
    issueCount: number;
    checkedAt: string | null;
  };
  storage: {
    kalshiMarkets: number;
    edgeSnapshots: number;
    probabilitySnapshots: number;
    forecastRows: number;
    observationRows: number;
    refreshLogs: number;
    latestRetentionCleanup: {
      status: string | null;
      startedAt: string | null;
      completedAt: string | null;
      message: string | null;
    };
    retentionPolicy: {
      enabled: boolean;
      dryRun: boolean;
      intervalSeconds: number;
      edgeSnapshotDays: number;
      probabilitySnapshotDays: number;
      orderbookSnapshotDays: number;
      forecastRunDays: number;
      observationDays: number;
      refreshLogDays: number;
      allocationRunDays: number;
      gribCacheHours: number;
      gribCacheDir: string;
    };
  };
};

type SourceRow = {
  name: string;
  latestCreatedAt: Date | null;
  latestSourceTime: Date | null;
  recentRows: bigint | number;
  totalRows: bigint | number;
};

function iso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function ageStatus(value: Date | null | undefined, maxAgeSeconds: number): Freshness {
  if (!value) return "unavailable";
  return Date.now() - value.getTime() <= maxAgeSeconds * 1000 ? "fresh" : "stale";
}

function worstStatus(statuses: Freshness[]): Freshness {
  if (statuses.includes("unavailable")) return "unavailable";
  if (statuses.includes("stale")) return "stale";
  return "fresh";
}

async function weatherServiceStatus(): Promise<{ status: Freshness; error: string | null }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3000);
  try {
    const response = await fetch(`${env.weatherServiceUrl}/health`, {
      cache: "no-store",
      signal: controller.signal
    });
    if (!response.ok) return { status: "stale", error: `weather-service returned HTTP ${response.status}` };
    const body = await response.json() as { status?: string };
    return { status: body.status === "ok" ? "fresh" : "stale", error: body.status === "ok" ? null : "weather-service health check did not return ok" };
  } catch (error) {
    return { status: "unavailable", error: error instanceof Error ? error.message : "weather-service health check failed" };
  } finally {
    clearTimeout(timeout);
  }
}

export async function getAdminStatus(): Promise<AdminStatus> {
  const [snapshot, latestWeatherLog, latestRetentionLog, sourceRows, counts, mappingReport, service] = await Promise.all([
    getLatestEdgeSnapshot(),
    prisma.dataRefreshLog.findFirst({
      where: { source: "weather-worker" },
      orderBy: { startedAt: "desc" }
    }),
    prisma.dataRefreshLog.findFirst({
      where: { source: "retention-cleanup" },
      orderBy: { startedAt: "desc" }
    }),
    prisma.$queryRaw<SourceRow[]>`
      WITH forecast_recent AS (
        SELECT
          "modelName" AS name,
          MAX("createdAt") AS "latestCreatedAt",
          MAX("runTimeUtc") AS "latestSourceTime",
          COUNT(*) FILTER (WHERE "createdAt" >= NOW() - make_interval(secs => ${env.forecastRefreshSeconds * 2})) AS "recentRows",
          COUNT(*) AS "totalRows"
        FROM "WeatherForecastRun"
        GROUP BY "modelName"
      ),
      observation_recent AS (
        SELECT
          'METAR' AS name,
          MAX("createdAt") AS "latestCreatedAt",
          MAX("observedAt") AS "latestSourceTime",
          COUNT(*) FILTER (WHERE "createdAt" >= NOW() - make_interval(secs => ${env.observationRefreshSeconds * 2})) AS "recentRows",
          COUNT(*) AS "totalRows"
        FROM "WeatherObservation"
      )
      SELECT * FROM forecast_recent
      UNION ALL
      SELECT * FROM observation_recent
      ORDER BY name
    `,
    Promise.all([
      prisma.kalshiMarket.count(),
      prisma.marketEdgeSnapshot.count(),
      prisma.marketProbabilitySnapshot.count(),
      prisma.weatherForecastRun.count(),
      prisma.weatherObservation.count(),
      prisma.dataRefreshLog.count()
    ]),
    buildSettlementMappingReport(),
    weatherServiceStatus()
  ]);

  const kalshiCircuit = getKalshiCircuitState();
  const edgeStatus = snapshot ? (snapshot.stale ? "stale" : "fresh") : "unavailable";
  const weatherLogCompletedAt = latestWeatherLog?.completedAt ?? null;
  const weatherWorkerStatus = latestWeatherLog?.status ?? null;
  const weatherWorkerFreshness = latestWeatherLog
    ? weatherWorkerStatus === "running"
      ? "fresh"
      : weatherWorkerStatus === "success"
        ? ageStatus(weatherLogCompletedAt, env.forecastRefreshSeconds * 2)
        : "stale"
    : "unavailable";

  const rowsByName = new Map(sourceRows.map((row) => [row.name, row]));
  const weatherSources = ["NBM", "HRRR", "NWS", "METAR"].map((name) => {
    const row = rowsByName.get(name);
    const isObservation = name === "METAR";
    const maxAgeSeconds = (isObservation ? env.observationRefreshSeconds : env.forecastRefreshSeconds) * 2;
    return {
      name,
      status: ageStatus(row?.latestCreatedAt, maxAgeSeconds),
      latestCreatedAt: iso(row?.latestCreatedAt),
      latestSourceTime: iso(row?.latestSourceTime),
      recentRows: Number(row?.recentRows ?? 0),
      totalRows: Number(row?.totalRows ?? 0),
      maxAgeSeconds
    };
  });

  const mappingStatus = mappingReport.issueCount === 0 ? "fresh" : "stale";
  const kalshiStatus = kalshiCircuit.isOpen ? "stale" : "fresh";
  const overallStatus = worstStatus([
    edgeStatus,
    kalshiStatus,
    weatherWorkerFreshness,
    service.status,
    mappingStatus,
    ...weatherSources.map((source) => source.status)
  ]);

  return {
    generatedAt: new Date().toISOString(),
    overallStatus,
    edgeScan: {
      status: edgeStatus,
      scanId: snapshot?.scanId ?? null,
      generatedAt: snapshot?.generatedAt ?? null,
      lastRefreshed: snapshot?.lastRefreshed ?? null,
      durationMs: snapshot?.scanDurationMs ?? null,
      marketCount: snapshot?.scannedMarketCount ?? snapshot?.markets.length ?? 0,
      scannedCandidateCount: snapshot?.scannedCandidateCount ?? snapshot?.candidates.length ?? 0,
      eligibleCandidateCount: snapshot?.eligibleCandidateCount ?? snapshot?.candidates.filter((candidate) => candidate.edge.eligible).length ?? 0,
      candidateSource: snapshot?.candidateSource ?? null,
      error: snapshot?.error ?? null
    },
    kalshi: {
      status: kalshiStatus,
      failures: kalshiCircuit.failures,
      circuitOpen: kalshiCircuit.isOpen,
      openedUntil: kalshiCircuit.openedUntil
    },
    weatherWorker: {
      status: weatherWorkerFreshness,
      serviceStatus: service.status,
      workerStatus: weatherWorkerStatus,
      startedAt: iso(latestWeatherLog?.startedAt),
      completedAt: iso(latestWeatherLog?.completedAt),
      message: latestWeatherLog?.message ?? null,
      error: service.error
    },
    weatherSources,
    mappings: {
      status: mappingStatus,
      marketCount: mappingReport.marketCount,
      issueCount: mappingReport.issueCount,
      checkedAt: mappingReport.generatedAt
    },
    storage: {
      kalshiMarkets: counts[0],
      edgeSnapshots: counts[1],
      probabilitySnapshots: counts[2],
      forecastRows: counts[3],
      observationRows: counts[4],
      refreshLogs: counts[5],
      latestRetentionCleanup: {
        status: latestRetentionLog?.status ?? null,
        startedAt: iso(latestRetentionLog?.startedAt),
        completedAt: iso(latestRetentionLog?.completedAt),
        message: latestRetentionLog?.message ?? null
      },
      retentionPolicy: {
        enabled: env.retentionCleanupEnabled,
        dryRun: env.retentionDryRun,
        intervalSeconds: env.retentionWorkerIntervalSeconds,
        edgeSnapshotDays: env.edgeSnapshotRetentionDays,
        probabilitySnapshotDays: env.probabilitySnapshotRetentionDays,
        orderbookSnapshotDays: env.orderbookSnapshotRetentionDays,
        forecastRunDays: env.forecastRunRetentionDays,
        observationDays: env.observationRetentionDays,
        refreshLogDays: env.refreshLogRetentionDays,
        allocationRunDays: env.allocationRunRetentionDays,
        gribCacheHours: env.gribCacheRetentionHours,
        gribCacheDir: env.gribCacheDir
      }
    }
  };
}
