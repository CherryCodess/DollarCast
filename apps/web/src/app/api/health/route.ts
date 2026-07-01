import { env } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

async function checkWeatherService() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2500);
  try {
    const response = await fetch(`${env.weatherServiceUrl}/health`, {
      cache: "no-store",
      signal: controller.signal
    });
    if (!response.ok) return { ok: false, status: `http_${response.status}` };
    const body = await response.json() as { status?: string };
    return { ok: body.status === "ok", status: body.status ?? "unknown" };
  } catch (error) {
    return { ok: false, status: error instanceof Error ? error.message : "request_failed" };
  } finally {
    clearTimeout(timeout);
  }
}

export async function GET() {
  const startedAt = Date.now();
  let database = { ok: false, status: "unavailable" };
  try {
    await prisma.$queryRaw`SELECT 1`;
    database = { ok: true, status: "ok" };
  } catch (error) {
    database = { ok: false, status: error instanceof Error ? error.message : "query_failed" };
  }

  const weatherService = await checkWeatherService();
  const ok = database.ok && weatherService.ok;

  return NextResponse.json(
    {
      status: ok ? "ok" : "degraded",
      service: "web",
      checks: {
        database,
        weatherService
      },
      latencyMs: Date.now() - startedAt,
      generatedAt: new Date().toISOString()
    },
    { status: ok ? 200 : 503 }
  );
}
