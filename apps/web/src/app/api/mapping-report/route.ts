import { buildSettlementMappingReport } from "@/lib/settlement-report";
import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json(await buildSettlementMappingReport());
}
