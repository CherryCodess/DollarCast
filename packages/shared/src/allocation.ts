import { percentile } from "./simulation";
import type { AllocationInput, AllocationRecommendation, CandidateOpportunity, CorrelationGroup, RecommendedPosition } from "./types";

function resolvesYes(candidate: CandidateOpportunity, temperatureF: number): boolean {
  const lowerOk = candidate.market.rangeLowerF == null ||
    (candidate.market.lowerInclusive ? temperatureF >= candidate.market.rangeLowerF : temperatureF > candidate.market.rangeLowerF);
  const upperOk = candidate.market.rangeUpperF == null ||
    (candidate.market.upperInclusive ? temperatureF <= candidate.market.rangeUpperF : temperatureF < candidate.market.rangeUpperF);
  return lowerOk && upperOk;
}

function selectedSideWins(candidate: CandidateOpportunity, temperatureF: number): boolean {
  const yesWins = resolvesYes(candidate, temperatureF);
  return candidate.edge.side === "yes" ? yesWins : !yesWins;
}

function compatibilityTemperatures(a: CandidateOpportunity, b: CandidateOpportunity): number[] {
  const simulated = [
    ...(a.probability.simulation?.temperaturesF ?? []),
    ...(b.probability.simulation?.temperaturesF ?? [])
  ];
  if (simulated.length) return simulated;
  const bounds = [a.market.rangeLowerF, a.market.rangeUpperF, b.market.rangeLowerF, b.market.rangeUpperF]
    .filter((value): value is number => value != null && Number.isFinite(value));
  const min = Math.floor(Math.min(...bounds, -50) - 5);
  const max = Math.ceil(Math.max(...bounds, 130) + 5);
  const values: number[] = [];
  for (let value = min; value <= max; value += 0.5) values.push(value);
  return values;
}

function canWinTogether(a: CandidateOpportunity, b: CandidateOpportunity): boolean {
  return compatibilityTemperatures(a, b).some((temperature) => selectedSideWins(a, temperature) && selectedSideWins(b, temperature));
}

function stableOffset(value: string, modulus: number): number {
  if (modulus <= 1) return 0;
  let hash = 0;
  for (let index = 0; index < value.length; index++) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash % modulus;
}

function stratifiedUnit(value: string, trial: number, trials: number): number {
  const offset = stableOffset(value, trials);
  return (((trial + offset) % trials) + 0.5) / trials;
}

function eventGroupKey(candidate: CandidateOpportunity): string {
  if (candidate.market.eventTicker) return candidate.market.eventTicker;
  return [
    candidate.market.stationId ?? "unknown",
    candidate.market.eventDateLocal ?? "unknown",
    candidate.market.eventHourLocal ?? "daily",
    candidate.market.marketType,
    candidate.market.direction
  ].join(":");
}

function suggestedAutosellTarget(candidate: CandidateOpportunity): number {
  const entryPrice = candidate.fill.averagePrice;
  const conservativeFairPrice = Math.max(entryPrice, candidate.edge.modelProbability - candidate.edge.uncertaintyBuffer);
  const midpointTarget = entryPrice + Math.max(0, conservativeFairPrice - entryPrice) * 0.5;
  return Math.min(0.99, Math.max(entryPrice, midpointTarget));
}

const profiles = {
  conservative: { singleCap: 0.25, cityDayCap: 0.45, minEdge: 0.07 },
  balanced: { singleCap: 0.35, cityDayCap: 0.6, minEdge: 0.05 },
  aggressive: { singleCap: 0.55, cityDayCap: 0.8, minEdge: 0.03 }
} as const;

export function buildCorrelationGroups(candidates: CandidateOpportunity[]): CorrelationGroup[] {
  const grouped = new Map<string, CorrelationGroup>();
  for (const candidate of candidates) {
    const city = candidate.market.cityName ?? "unknown";
    const station = candidate.market.stationId ?? "unknown";
    const date = candidate.market.eventDateLocal ?? "unknown";
    const groupId = `${station}:${date}`;
    const existing = grouped.get(groupId) ?? {
      groupId,
      city,
      stationId: station,
      localDate: date,
      groupType: "city_day" as const,
      marketTickers: []
    };
    existing.marketTickers.push(candidate.market.marketTicker);
    grouped.set(groupId, existing);
  }
  return [...grouped.values()];
}

export function recommendAllocation(input: AllocationInput, candidates: CandidateOpportunity[]): AllocationRecommendation {
  const profile = profiles[input.riskProfile];
  const warnings: string[] = [];
  const eligible = candidates
    .filter(
      (c) =>
        c.edge.eligible &&
        c.edge.netEdge >= profile.minEdge &&
        c.probability.confidence !== "low" &&
        c.market.parseStatus === "verified" &&
        c.fill.remainingContracts === 0
    )
    .sort((a, b) => {
      const riskPenaltyA = a.probability.confidence === "high" ? 0 : 0.01;
      const riskPenaltyB = b.probability.confidence === "high" ? 0 : 0.01;
      return b.edge.netEdge - riskPenaltyB - (a.edge.netEdge - riskPenaltyA);
    });
  if (!eligible.length) warnings.push("No opportunities passed the edge, confidence, liquidity, fee, and risk filters.");

  const maxDeployment = input.budget;
  const uniqueEligibleMarkets = new Set(eligible.map((candidate) => candidate.market.marketTicker)).size;
  const uniqueEligibleGroups = new Set(eligible.map((candidate) => `${candidate.market.stationId}:${candidate.market.eventDateLocal}`)).size;
  const profileSingleCap = uniqueEligibleMarkets > 1 ? input.budget * profile.singleCap : input.budget;
  const profileCityDayCap = uniqueEligibleGroups > 1 ? input.budget * profile.cityDayCap : input.budget;
  const maxSingle = Math.min(input.maxAmountPerMarket ?? profileSingleCap, input.budget);
  const maxLoss = input.maxTotalLoss ?? input.budget;
  const cityDayLimit = profileCityDayCap;
  const minimumPositionDollars = Math.max(0.01, Math.min(0.25, maxSingle));
  const usedByGroup = new Map<string, number>();
  const selectedYesEventGroups = new Set<string>();
  const selectedMarketSides = new Map<string, Set<"yes" | "no">>();
  const positions: RecommendedPosition[] = [];
  const selectedCandidates = new Map<string, CandidateOpportunity>();
  let deployed = 0;
  let totalFees = 0;

  for (const candidate of eligible) {
    if (deployed >= maxDeployment || deployed >= maxLoss) break;
    const group = `${candidate.market.stationId}:${candidate.market.eventDateLocal}`;
    const eventGroup = eventGroupKey(candidate);
    const sidesForMarket = selectedMarketSides.get(candidate.market.marketTicker) ?? new Set<"yes" | "no">();
    if (sidesForMarket.size && !sidesForMarket.has(candidate.edge.side)) {
      warnings.push(`Skipped ${candidate.market.marketTicker}: opposite sides of the same market cannot both be selected.`);
      continue;
    }
    if (candidate.edge.side === "yes" && selectedYesEventGroups.has(eventGroup)) {
      warnings.push(`Skipped ${candidate.market.marketTicker}: another YES position was already selected for the same mutually exclusive event.`);
      continue;
    }
    const conflictingSameEvent = [...selectedCandidates.values()].find((selected) => eventGroupKey(selected) === eventGroup && !canWinTogether(selected, candidate));
    if (conflictingSameEvent) {
      warnings.push(`Skipped ${candidate.market.marketTicker}: it is incompatible with selected same-event position ${conflictingSameEvent.market.marketTicker}.`);
      continue;
    }
    const groupUsed = usedByGroup.get(group) ?? 0;
    const remainingGroup = Math.max(0, cityDayLimit - groupUsed);
    const remainingBudget = Math.max(0, maxDeployment - deployed, maxLoss - deployed);
    const desired = maxSingle;
    const dollars = Math.min(desired, maxSingle, remainingGroup, remainingBudget, candidate.fill.totalCost + candidate.fee.totalFeeDollars);
    if (dollars < minimumPositionDollars) continue;
    const contracts = dollars / (candidate.fill.averagePrice + candidate.fee.feePerContractDollars);
    const fee = contracts * candidate.fee.feePerContractDollars;
    const cost = contracts * candidate.fill.averagePrice + fee;
    const profitIfCorrect = contracts * (1 - candidate.fill.averagePrice) - fee;
    const lossIfIncorrect = cost;
    positions.push({
      marketTicker: candidate.market.marketTicker,
      marketTitle: candidate.market.eventTitle ?? candidate.market.rawTitle,
      marketLocation:
        [candidate.market.cityName, candidate.market.stateCode].filter(Boolean).join(", ") ||
        candidate.market.stationName ||
        candidate.market.stationId ||
        "Location unavailable",
      marketEventTime: [candidate.market.eventDateLocal, candidate.market.eventHourLocal].filter(Boolean).join(" at "),
      eventTicker: candidate.market.eventTicker,
      seriesTicker: candidate.market.seriesTicker,
      rawTitle: candidate.market.rawTitle,
      contractUrl: candidate.market.contractUrl,
      side: candidate.edge.side,
      recommendedDollars: dollars,
      contracts,
      averageExecutableFillPrice: candidate.fill.averagePrice,
      estimatedFee: fee,
      costIncludingFee: cost,
      profitIfCorrect,
      lossIfIncorrect,
      estimatedExpectedProfit: candidate.edge.grossExpectedValuePerContract * contracts,
      modelProbability: candidate.edge.modelProbability,
      marketPrice: candidate.edge.executablePrice,
      targetPrice: suggestedAutosellTarget(candidate),
      netEdge: candidate.edge.netEdge,
      confidence: candidate.probability.confidence,
      correlationGroup: group
    });
    deployed += cost;
    totalFees += fee;
    usedByGroup.set(group, groupUsed + cost);
    sidesForMarket.add(candidate.edge.side);
    selectedMarketSides.set(candidate.market.marketTicker, sidesForMarket);
    if (candidate.edge.side === "yes") selectedYesEventGroups.add(eventGroup);
    selectedCandidates.set(candidate.market.marketTicker, candidate);
  }

  if (input.budget - deployed > 0.01 && positions.length) {
    const selectedByEdge = [...positions].sort((a, b) => b.netEdge - a.netEdge);
    for (const position of selectedByEdge) {
      if (input.budget - deployed <= 0.01) break;
      const candidate = selectedCandidates.get(position.marketTicker);
      if (!candidate) continue;
      const verifiedCapacity = candidate.fill.totalCost + candidate.fee.totalFeeDollars;
      const remainingCandidateCapacity = Math.max(0, verifiedCapacity - position.costIncludingFee);
      const topUpDollars = Math.min(remainingCandidateCapacity, input.budget - deployed, maxLoss - deployed);
      if (topUpDollars <= 0.01) continue;
      const addedContracts = topUpDollars / (candidate.fill.averagePrice + candidate.fee.feePerContractDollars);
      const addedFee = addedContracts * candidate.fee.feePerContractDollars;
      const addedCost = addedContracts * candidate.fill.averagePrice + addedFee;
      position.recommendedDollars += topUpDollars;
      position.contracts += addedContracts;
      position.estimatedFee += addedFee;
      position.costIncludingFee += addedCost;
      position.profitIfCorrect += addedContracts * (1 - candidate.fill.averagePrice) - addedFee;
      position.lossIfIncorrect += addedCost;
      position.estimatedExpectedProfit += candidate.edge.grossExpectedValuePerContract * addedContracts;
      deployed += addedCost;
      totalFees += addedFee;
      usedByGroup.set(position.correlationGroup, (usedByGroup.get(position.correlationGroup) ?? 0) + addedCost);
    }
  }

  const deploymentShortfall = input.budget - deployed;
  if (deploymentShortfall > 0.01) {
    return {
      totalBudget: input.budget,
      recommendedDeployment: 0,
      cashHeldBack: input.budget,
      totalEstimatedFees: 0,
      expectedProfit: 0,
      expectedRoi: 0,
      probabilityOfProfit: 0,
      maxPossibleProfit: 0,
      maxPossibleLoss: 0,
      p05ProfitLoss: 0,
      p95ProfitLoss: 0,
      p05LossDollars: 0,
      cvar05: 0,
      cvar05LossDollars: 0,
      positions: [],
      warnings: [
        ...warnings,
        `No exact allocation recommendation: the app could only verify $${deployed.toFixed(2)} of eligible executable capacity for the requested $${input.budget.toFixed(2)}.`
      ],
      generatedAt: new Date().toISOString()
    };
  }

  const trials = Math.max(
    1000,
    ...positions.map((p) => selectedCandidates.get(p.marketTicker)?.probability.simulation?.temperaturesF?.length ?? 0)
  );
  const fallbackGroupOffsets = new Map<string, number>();
  for (const position of positions) {
    fallbackGroupOffsets.set(position.correlationGroup, stableOffset(position.correlationGroup, trials));
  }
  const simulatedPl = Array.from({ length: trials }, (_, i) =>
    positions.reduce((sum, pos) => {
      const candidate = selectedCandidates.get(pos.marketTicker);
      const temps = candidate?.probability.simulation?.temperaturesF;
      let contractResolvesYes: boolean;
      if (candidate && temps?.length) {
        const empiricalYesProbability = temps.filter((temperature) => resolvesYes(candidate, temperature)).length / temps.length;
        const modelYesProbability = candidate.probability.yesProbability;
        const empiricalIsMissingTail =
          (empiricalYesProbability >= 1 && modelYesProbability < 1) ||
          (empiricalYesProbability <= 0 && modelYesProbability > 0);
        contractResolvesYes = empiricalIsMissingTail
          ? stratifiedUnit(candidate.market.marketTicker, i, trials) < modelYesProbability
          : resolvesYes(candidate, temps[i % temps.length]);
      } else {
        contractResolvesYes = ((i + (fallbackGroupOffsets.get(pos.correlationGroup) ?? 0)) % trials) / trials < (candidate?.probability.yesProbability ?? pos.modelProbability);
      }
      const selectedWins = pos.side === "yes" ? contractResolvesYes : !contractResolvesYes;
      return sum + (selectedWins ? pos.profitIfCorrect : -pos.lossIfIncorrect);
    }, 0)
  );
  const expectedProfit = simulatedPl.reduce((sum, value) => sum + value, 0) / simulatedPl.length;
  const p05 = percentile(simulatedPl, 5);
  const sortedPl = [...simulatedPl].sort((a, b) => a - b);
  const worst = sortedPl.slice(0, Math.max(1, Math.ceil(sortedPl.length * 0.05)));
  const cvar05 = worst.length ? worst.reduce((a, b) => a + b, 0) / worst.length : p05;

  return {
    totalBudget: input.budget,
    recommendedDeployment: deployed,
    cashHeldBack: Math.max(0, input.budget - deployed),
    totalEstimatedFees: totalFees,
    expectedProfit,
    expectedRoi: deployed > 0 ? expectedProfit / deployed : 0,
    probabilityOfProfit: simulatedPl.filter((v) => v > 0).length / simulatedPl.length,
    maxPossibleProfit: positions.reduce((sum, p) => sum + p.profitIfCorrect, 0),
    maxPossibleLoss: positions.reduce((sum, p) => sum + p.lossIfIncorrect, 0),
    p05ProfitLoss: p05,
    p95ProfitLoss: percentile(simulatedPl, 95),
    p05LossDollars: Math.max(0, -p05),
    cvar05,
    cvar05LossDollars: Math.max(0, -cvar05),
    positions,
    warnings,
    generatedAt: new Date().toISOString()
  };
}
