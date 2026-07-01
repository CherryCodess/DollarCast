import { env } from "../src/lib/env";
import { refreshEdgeSnapshot } from "../src/lib/edge-snapshots";
import { prisma } from "../src/lib/prisma";

const intervalSeconds = Math.max(15, Number(process.env.EDGE_SCANNER_INTERVAL_SECONDS ?? env.kalshiCacheSeconds));
let stopping = false;

async function runOnce() {
  const snapshot = await refreshEdgeSnapshot(env.allocationLiquidityCheckContracts);
  const eligible = snapshot.candidates.filter((candidate) => candidate.edge.eligible).length;
  console.log(
    `[edge-scanner] ${snapshot.generatedAt} scanned=${snapshot.markets.length} candidates=${snapshot.candidates.length} eligible=${eligible} liquidityContracts=${env.allocationLiquidityCheckContracts} durationMs=${snapshot.scanDurationMs}`
  );
}

async function loop() {
  while (!stopping) {
    try {
      await runOnce();
    } catch (error) {
      console.error("[edge-scanner] refresh failed", error);
    }
    await new Promise((resolve) => setTimeout(resolve, intervalSeconds * 1000));
  }
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    stopping = true;
  });
}

loop()
  .catch((error) => {
    console.error("[edge-scanner] fatal error", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
