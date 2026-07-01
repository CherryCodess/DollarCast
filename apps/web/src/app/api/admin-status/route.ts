import { getAdminStatus } from "@/lib/admin-status";
import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json(await getAdminStatus());
}
