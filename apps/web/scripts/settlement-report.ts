import { buildSettlementMappingReport } from "../src/lib/settlement-report";
import { prisma } from "../src/lib/prisma";

async function main() {
  const report = await buildSettlementMappingReport();
  console.log(JSON.stringify(report, null, 2));
  if (report.issueCount > 0) {
    process.exitCode = 1;
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
