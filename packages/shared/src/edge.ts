import type { EdgeResult, FeeEstimate, PositionSide } from "./types";

export function calculateEdge(input: {
  side: PositionSide;
  modelProbability: number;
  executablePrice: number;
  fee: FeeEstimate;
  slippage: number;
  uncertaintyBuffer: number;
  minNetEdge: number;
}): EdgeResult {
  const reasons: string[] = [];
  const feeEquivalent = input.fee.feeMode === "unknown" ? Number.POSITIVE_INFINITY : input.fee.feePerContractDollars;
  const grossExpectedValuePerContract =
    input.modelProbability * (1 - input.executablePrice) - (1 - input.modelProbability) * input.executablePrice - feeEquivalent;
  // executablePrice is the average executable fill price for the requested size,
  // so it already includes order-book slippage versus the best ask.
  const netEdge = input.modelProbability - input.executablePrice - feeEquivalent - input.uncertaintyBuffer;
  if (input.fee.feeMode === "unknown") reasons.push("Fee estimate unavailable.");
  if (input.executablePrice <= 0 || input.executablePrice >= 1) reasons.push("Executable price is invalid.");
  if (netEdge < input.minNetEdge) reasons.push("Net edge is below the configured threshold.");
  return {
    side: input.side,
    modelProbability: input.modelProbability,
    impliedProbability: input.executablePrice,
    executablePrice: input.executablePrice,
    feeProbabilityEquivalent: feeEquivalent,
    slippageProbabilityEquivalent: input.slippage,
    uncertaintyBuffer: input.uncertaintyBuffer,
    netEdge,
    grossExpectedValuePerContract,
    eligible: reasons.length === 0,
    reasons
  };
}
