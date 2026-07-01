import type { ExecutableFill, OrderBook, OrderBookLevel, PositionSide } from "./types";

const normalize = (levels: OrderBookLevel[]) =>
  levels
    .filter((level) => level.quantity > 0 && level.price > 0 && level.price < 1)
    .sort((a, b) => a.price - b.price);

export function deriveAsks(book: OrderBook, side: PositionSide): OrderBookLevel[] {
  const direct = side === "yes" ? book.yesAsks : book.noAsks;
  if (direct?.length) return normalize(direct);
  const oppositeBids = side === "yes" ? book.noBids : book.yesBids;
  return normalize(oppositeBids.map((level) => ({ price: 1 - level.price, quantity: level.quantity })));
}

export function calculateExecutableFill(side: PositionSide, requestedContracts: number, book: OrderBook): ExecutableFill {
  const asks = deriveAsks(book, side);
  const bestAsk = asks[0]?.price ?? 0;
  let remaining = Math.max(0, requestedContracts);
  let totalCost = 0;
  let filled = 0;
  const levelsUsed: OrderBookLevel[] = [];
  for (const level of asks) {
    if (remaining <= 0) break;
    const qty = Math.min(remaining, level.quantity);
    if (qty <= 0) continue;
    levelsUsed.push({ price: level.price, quantity: qty });
    totalCost += qty * level.price;
    filled += qty;
    remaining -= qty;
  }
  const averagePrice = filled > 0 ? totalCost / filled : 0;
  return {
    side,
    requestedContracts,
    filledContracts: filled,
    averagePrice,
    totalCost,
    remainingContracts: remaining,
    levelsUsed,
    slippageVsBestAsk: filled > 0 ? Math.max(0, averagePrice - bestAsk) : 0
  };
}
