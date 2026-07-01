import { readdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { env } from "../src/lib/env";
import { prisma } from "../src/lib/prisma";

type CleanupResult = {
  dryRun: boolean;
  enabled: boolean;
  cutoffs: Record<string, string>;
  deleted: Record<string, number>;
  gribCache: {
    dir: string;
    retainedHours: number;
    deletedFiles: number;
    deletedBytes: number;
    errors: string[];
  };
};

function cutoffDate(days: number): Date {
  return new Date(Date.now() - Math.max(0, days) * 24 * 60 * 60 * 1000);
}

function cutoffHours(hours: number): Date {
  return new Date(Date.now() - Math.max(0, hours) * 60 * 60 * 1000);
}

async function maybeDeleteMany<T extends { count: number }>(label: string, action: () => Promise<T>, result: CleanupResult) {
  if (result.dryRun) return;
  const deleted = await action();
  result.deleted[label] = deleted.count;
}

async function countOnly(label: string, action: () => Promise<number>, result: CleanupResult) {
  if (!result.dryRun) return;
  result.deleted[label] = await action();
}

async function deleteOldGribFiles(dir: string, cutoff: Date, result: CleanupResult) {
  async function walk(currentDir: string) {
    let entries;
    try {
      entries = await readdir(currentDir, { withFileTypes: true });
    } catch (error) {
      result.gribCache.errors.push(error instanceof Error ? error.message : `Unable to read ${currentDir}`);
      return;
    }

    for (const entry of entries) {
      const filePath = path.join(currentDir, entry.name);
      try {
        const info = await stat(filePath);
        if (entry.isDirectory()) {
          await walk(filePath);
          continue;
        }
        if (info.mtime <= cutoff) {
          result.gribCache.deletedFiles += 1;
          result.gribCache.deletedBytes += info.size;
          if (!result.dryRun) await rm(filePath, { force: true });
        }
      } catch (error) {
        result.gribCache.errors.push(error instanceof Error ? error.message : `Unable to inspect ${filePath}`);
      }
    }
  }

  await walk(dir);
}

export async function runRetentionCleanup(): Promise<CleanupResult> {
  const now = new Date();
  const edgeCutoff = cutoffDate(env.edgeSnapshotRetentionDays);
  const probabilityCutoff = cutoffDate(env.probabilitySnapshotRetentionDays);
  const orderbookCutoff = cutoffDate(env.orderbookSnapshotRetentionDays);
  const forecastCutoff = cutoffDate(env.forecastRunRetentionDays);
  const observationCutoff = cutoffDate(env.observationRetentionDays);
  const refreshLogCutoff = cutoffDate(env.refreshLogRetentionDays);
  const allocationCutoff = cutoffDate(env.allocationRunRetentionDays);
  const gribCutoff = cutoffHours(env.gribCacheRetentionHours);

  const result: CleanupResult = {
    dryRun: env.retentionDryRun,
    enabled: env.retentionCleanupEnabled,
    cutoffs: {
      edgeSnapshots: edgeCutoff.toISOString(),
      probabilitySnapshots: probabilityCutoff.toISOString(),
      orderbooks: orderbookCutoff.toISOString(),
      forecasts: forecastCutoff.toISOString(),
      observations: observationCutoff.toISOString(),
      refreshLogs: refreshLogCutoff.toISOString(),
      allocations: allocationCutoff.toISOString(),
      gribCache: gribCutoff.toISOString()
    },
    deleted: {},
    gribCache: {
      dir: env.gribCacheDir,
      retainedHours: env.gribCacheRetentionHours,
      deletedFiles: 0,
      deletedBytes: 0,
      errors: []
    }
  };

  const log = await prisma.dataRefreshLog.create({
    data: {
      source: "retention-cleanup",
      status: env.retentionCleanupEnabled ? "running" : "disabled",
      startedAt: now,
      message: env.retentionCleanupEnabled ? "Retention cleanup started." : "Retention cleanup is disabled.",
      rawPayload: result
    }
  });

  if (!env.retentionCleanupEnabled) return result;

  try {
    const latestEdgeScan = await prisma.dataRefreshLog.findFirst({
      where: { source: "edge-scanner", status: { in: ["success", "degraded"] } },
      orderBy: { completedAt: "desc" },
      select: { id: true }
    });
    const oldEdgeScanIds = (await prisma.dataRefreshLog.findMany({
      where: {
        source: "edge-scanner",
        completedAt: { lt: edgeCutoff },
        id: latestEdgeScan?.id ? { not: latestEdgeScan.id } : undefined
      },
      select: { id: true }
    })).map((row) => row.id);

    await countOnly("marketEdgeSnapshots", () => prisma.marketEdgeSnapshot.count({ where: { scanId: { in: oldEdgeScanIds } } }), result);
    await maybeDeleteMany("marketEdgeSnapshots", () => prisma.marketEdgeSnapshot.deleteMany({ where: { scanId: { in: oldEdgeScanIds } } }), result);

    await countOnly("marketProbabilitySnapshots", () => prisma.marketProbabilitySnapshot.count({ where: { generatedAt: { lt: probabilityCutoff } } }), result);
    await maybeDeleteMany("marketProbabilitySnapshots", () => prisma.marketProbabilitySnapshot.deleteMany({ where: { generatedAt: { lt: probabilityCutoff } } }), result);

    await countOnly("kalshiOrderbookSnapshots", () => prisma.kalshiOrderbookSnapshot.count({ where: { sourceTimestamp: { lt: orderbookCutoff } } }), result);
    await maybeDeleteMany("kalshiOrderbookSnapshots", () => prisma.kalshiOrderbookSnapshot.deleteMany({ where: { sourceTimestamp: { lt: orderbookCutoff } } }), result);

    await countOnly("weatherForecastRuns", () => prisma.weatherForecastRun.count({ where: { createdAt: { lt: forecastCutoff } } }), result);
    await maybeDeleteMany("weatherForecastRuns", () => prisma.weatherForecastRun.deleteMany({ where: { createdAt: { lt: forecastCutoff } } }), result);

    await countOnly("weatherObservations", () => prisma.weatherObservation.count({ where: { createdAt: { lt: observationCutoff } } }), result);
    await maybeDeleteMany("weatherObservations", () => prisma.weatherObservation.deleteMany({ where: { createdAt: { lt: observationCutoff } } }), result);

    const oldAllocationRunIds = (await prisma.allocationRun.findMany({
      where: { generatedAt: { lt: allocationCutoff } },
      select: { id: true }
    })).map((row) => row.id);
    await countOnly("allocationPositions", () => prisma.allocationPosition.count({ where: { allocationRunId: { in: oldAllocationRunIds } } }), result);
    await maybeDeleteMany("allocationPositions", () => prisma.allocationPosition.deleteMany({ where: { allocationRunId: { in: oldAllocationRunIds } } }), result);
    await countOnly("allocationRuns", () => Promise.resolve(oldAllocationRunIds.length), result);
    await maybeDeleteMany("allocationRuns", () => prisma.allocationRun.deleteMany({ where: { id: { in: oldAllocationRunIds } } }), result);

    await countOnly("dataRefreshLogs", () => prisma.dataRefreshLog.count({
      where: {
        completedAt: { lt: refreshLogCutoff },
        id: {
          notIn: [log.id, latestEdgeScan?.id].filter((value): value is string => Boolean(value))
        }
      }
    }), result);
    await maybeDeleteMany("dataRefreshLogs", () => prisma.dataRefreshLog.deleteMany({
      where: {
        completedAt: { lt: refreshLogCutoff },
        id: {
          notIn: [log.id, latestEdgeScan?.id].filter((value): value is string => Boolean(value))
        }
      }
    }), result);

    await deleteOldGribFiles(env.gribCacheDir, gribCutoff, result);

    await prisma.dataRefreshLog.update({
      where: { id: log.id },
      data: {
        status: result.gribCache.errors.length ? "degraded" : "success",
        completedAt: new Date(),
        message: `Retention cleanup completed. Deleted ${Object.values(result.deleted).reduce((sum, value) => sum + value, 0)} database rows and ${result.gribCache.deletedFiles} GRIB cache files.`,
        rawPayload: result
      }
    });
    return result;
  } catch (error) {
    await prisma.dataRefreshLog.update({
      where: { id: log.id },
      data: {
        status: "error",
        completedAt: new Date(),
        message: error instanceof Error ? error.message : "Retention cleanup failed.",
        rawPayload: result
      }
    });
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runRetentionCleanup()
    .then((result) => {
      console.log(JSON.stringify(result, null, 2));
    })
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
