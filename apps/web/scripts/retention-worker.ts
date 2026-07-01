import { env } from "../src/lib/env";
import { prisma } from "../src/lib/prisma";
import { runRetentionCleanup } from "./retention-cleanup";

const intervalMs = Math.max(60, env.retentionWorkerIntervalSeconds) * 1000;

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  console.log(`Starting retention-worker interval=${env.retentionWorkerIntervalSeconds}s enabled=${env.retentionCleanupEnabled} dryRun=${env.retentionDryRun}`);
  while (true) {
    const startedAt = Date.now();
    try {
      const result = await runRetentionCleanup();
      console.log(JSON.stringify({
        message: "retention cleanup completed",
        durationMs: Date.now() - startedAt,
        deleted: result.deleted,
        gribCache: result.gribCache
      }));
    } catch (error) {
      console.error("retention cleanup failed", error);
    }
    await sleep(intervalMs);
  }
}

main().finally(async () => {
  await prisma.$disconnect();
});
