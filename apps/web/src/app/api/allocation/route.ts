import { getLatestEdgeSnapshot } from "@/lib/edge-snapshots";
import { recommendAllocation } from "@dollarcast/shared";
import { NextResponse } from "next/server";
import { z } from "zod";

const requestSchema = z.object({
  budget: z.number().positive().max(100000),
  riskProfile: z.enum(["conservative", "balanced", "aggressive"]).default("balanced"),
  maxTotalLoss: z.number().positive().optional(),
  maxAmountPerMarket: z.number().positive().optional()
});

export async function POST(request: Request) {
  const allocationInput = requestSchema.parse(await request.json());
  const candidateData = await getLatestEdgeSnapshot();
  if (!candidateData) {
    const allocation = recommendAllocation(allocationInput, []);
    return NextResponse.json({
      allocation: {
        ...allocation,
        warnings: [...allocation.warnings, "No allocation recommendation: cached edge snapshot is not available yet."]
      },
      mode: "unavailable",
      error: "No cached edge snapshot is available. Wait for the background edge scanner to finish.",
      stale: true
    });
  }
  const allocation = recommendAllocation(allocationInput, candidateData.candidates);
  return NextResponse.json({
    allocation,
    mode: candidateData.mode,
    error: candidateData.error,
    stale: candidateData.stale,
    scan: {
      scanId: candidateData.scanId,
      generatedAt: candidateData.generatedAt,
      candidateSource: candidateData.candidateSource,
      scannedCandidateCount: candidateData.scannedCandidateCount,
      eligibleCandidateCount: candidateData.eligibleCandidateCount
    }
  });
}
