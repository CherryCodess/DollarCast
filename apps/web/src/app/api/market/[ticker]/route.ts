import { getLatestEdgeSnapshot } from "@/lib/edge-snapshots";
import { getMarket, getOrderBook, getProbability } from "@/lib/market-service";
import { NextResponse } from "next/server";

export async function GET(_: Request, { params }: { params: Promise<{ ticker: string }> }) {
  const { ticker } = await params;
  const decodedTicker = decodeURIComponent(ticker);
  const snapshot = await getLatestEdgeSnapshot();
  const snapshotMarket = snapshot?.markets.find((item) => item.marketTicker === decodedTicker) ?? null;
  const fallback = snapshotMarket ? null : await getMarket(decodedTicker);
  const market = snapshotMarket ?? fallback?.market ?? null;
  const mode = snapshot?.mode ?? fallback?.mode ?? "unavailable";
  const lastRefreshed = snapshot?.lastRefreshed ?? fallback?.lastRefreshed ?? new Date().toISOString();
  if (!market) return NextResponse.json({ error: "Market not found" }, { status: 404 });
  const probability = snapshot?.candidates.find((candidate) => candidate.market.marketTicker === market.marketTicker)?.probability ?? await getProbability(market);
  const orderBook = await getOrderBook(market);
  return NextResponse.json({ market, probability, orderBook, mode, lastRefreshed });
}
