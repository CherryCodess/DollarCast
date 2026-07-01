import type { FeeEstimate } from "./types";

export class FeeCalculator {
  constructor(private readonly feeMultiplier = 0.07, private readonly source = "Kalshi fee metadata or configured estimate") {}

  estimateTakerFee(contracts: number, price: number, metadata?: { feeMultiplier?: number | null; feeWaived?: boolean }): FeeEstimate {
    if (metadata?.feeWaived) {
      return { totalFeeDollars: 0, feePerContractDollars: 0, feeMode: "taker", feeSource: "Kalshi API fee waiver metadata", isEstimated: false, warnings: [] };
    }
    const multiplier = metadata?.feeMultiplier ?? this.feeMultiplier;
    if (!Number.isFinite(multiplier) || multiplier <= 0 || !Number.isFinite(price) || price <= 0 || price >= 1) {
      return { totalFeeDollars: 0, feePerContractDollars: 0, feeMode: "unknown", feeSource: "Fee estimate unavailable", isEstimated: true, warnings: ["Fee estimate unavailable"] };
    }
    const feePerContract = multiplier * price * (1 - price);
    return {
      totalFeeDollars: feePerContract * contracts,
      feePerContractDollars: feePerContract,
      feeMode: "taker",
      feeSource: metadata?.feeMultiplier ? "Kalshi series fee multiplier metadata" : this.source,
      isEstimated: !metadata?.feeMultiplier,
      warnings: metadata?.feeMultiplier ? [] : ["Using configured fee multiplier until live fee metadata is available."]
    };
  }
}
