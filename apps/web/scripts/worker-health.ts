import { env } from "../src/lib/env";
import { prisma } from "../src/lib/prisma";

const source = process.argv[2];
const maxAgeSeconds = Number(process.argv[3] ?? defaultMaxAgeSeconds(source));

function defaultMaxAgeSeconds(value: string | undefined) {
  if (value === "edge-scanner") return Math.max(300, env.kalshiCacheSeconds * 4);
  if (value === "retention-cleanup") return Math.max(7200, env.retentionWorkerIntervalSeconds * 3);
  return 900;
}

async function main() {
  if (!source) throw new Error("Usage: tsx scripts/worker-health.ts <source> [maxAgeSeconds]");
  const latest = await prisma.dataRefreshLog.findFirst({
    where: { source },
    orderBy: { startedAt: "desc" }
  });
  if (!latest) throw new Error(`No heartbeat found for ${source}.`);
  if (latest.status === "running") {
    const runningAgeSeconds = (Date.now() - latest.startedAt.getTime()) / 1000;
    if (runningAgeSeconds <= maxAgeSeconds) {
      console.log(`${source} healthy: running for ${Math.round(runningAgeSeconds)}s`);
      return;
    }
    throw new Error(`${source} has been running for ${Math.round(runningAgeSeconds)}s, over max ${maxAgeSeconds}s.`);
  }
  if (!["success", "degraded"].includes(latest.status) || !latest.completedAt) {
    throw new Error(`${source} latest status is ${latest.status}.`);
  }
  const ageSeconds = (Date.now() - latest.completedAt.getTime()) / 1000;
  if (ageSeconds > maxAgeSeconds) {
    throw new Error(`${source} latest completed heartbeat is ${Math.round(ageSeconds)}s old, over max ${maxAgeSeconds}s.`);
  }
  console.log(`${source} healthy: latest ${latest.status} ${Math.round(ageSeconds)}s ago`);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
