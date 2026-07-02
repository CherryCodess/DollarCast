import { describe, expect, it } from "vitest";
import {
  FeeCalculator,
  buildCorrelationGroups,
  calculateEdge,
  calculateExecutableFill,
  normalizeKalshiMarket,
  parseTemperatureRange,
  probabilityForRange,
  recommendAllocation,
  simulateTemperaturePaths,
  type CandidateOpportunity,
  type WeatherStationMapping
} from "./index";

const mapping: WeatherStationMapping = {
  seriesTicker: "KXHIGHNY",
  cityName: "New York",
  stateCode: "NY",
  stationId: "KNYC",
  stationName: "Central Park",
  icaoCode: "KNYC",
  latitude: 40.7,
  longitude: -73.9,
  timezone: "America/New_York",
  settlementSourceName: "NWS",
  settlementSourceUrl: "https://weather.gov",
  dailyObservationWindow: "00:00-23:59",
  dailyReportTimezone: "America/New_York",
  sourceConfidence: "verified",
  verifiedAt: "2026-01-01T00:00:00Z"
};

describe("market parsing", () => {
  it("parses temperature ranges", () => {
    expect(parseTemperatureRange("between 70 and 79F")).toMatchObject({ lower: 70, upper: 79 });
    expect(parseTemperatureRange("above 75 degrees")).toMatchObject({ lower: 75, upper: null, lowerInclusive: false });
  });

  it("normalizes a daily temperature market with verified station mapping", () => {
    const market = normalizeKalshiMarket(
      {
        ticker: "KXHIGHNY-26JUN25-B75",
        event_ticker: "KXHIGHNY-26JUN25",
        series_ticker: "KXHIGHNY",
        title: "Will the high temperature in New York, NY be above 75F?",
        yes_sub_title: "Above 75F",
        no_sub_title: "75F or below",
        close_time: "2026-06-25T20:00:00Z",
        rules_primary: "Settles using National Weather Service report for Central Park KNYC official station high temperature.",
        yes_bid: 55,
        no_bid: 42
      },
      [mapping]
    );
    expect(market.marketType).toBe("daily_temperature");
    expect(market.direction).toBe("high");
    expect(market.stationId).toBe("KNYC");
    expect(market.parseStatus).toBe("verified");
  });
});

describe("pricing and fees", () => {
  it("derives executable yes asks from no bids and computes average fill", () => {
    const fill = calculateExecutableFill("yes", 15, { yesBids: [], noBids: [{ price: 0.42, quantity: 10 }, { price: 0.4, quantity: 10 }] });
    expect(fill.filledContracts).toBe(15);
    expect(fill.averagePrice).toBeCloseTo((10 * 0.58 + 5 * 0.6) / 15);
  });

  it("centralizes taker fee estimates and edge calculation", () => {
    const fee = new FeeCalculator(0.07).estimateTakerFee(10, 0.58, { feeMultiplier: 0.07 });
    const edge = calculateEdge({ side: "yes", modelProbability: 0.7, executablePrice: 0.58, fee, slippage: 0.01, uncertaintyBuffer: 0.03, minNetEdge: 0.05 });
    expect(fee.feeMode).toBe("taker");
    expect(edge.netEdge).toBeGreaterThan(0.05);
  });

  it("does not double-count slippage when executable price is an average fill price", () => {
    const fee = { totalFeeDollars: 0, feePerContractDollars: 0.01, feeMode: "taker" as const, feeSource: "test", isEstimated: false, warnings: [] };
    const edge = calculateEdge({ side: "yes", modelProbability: 0.7, executablePrice: 0.6, fee, slippage: 0.2, uncertaintyBuffer: 0.03, minNetEdge: 0.05 });
    expect(edge.netEdge).toBeCloseTo(0.06);
  });
});

describe("weather simulations", () => {
  it("simulates daily high, daily low, hourly values and normalizes probabilities", () => {
    const paths = simulateTemperaturePaths({ hourlyMeanF: [70, 72, 75, 73], paths: 1000, seed: 3 });
    const highs = paths.map((path) => Math.max(...path));
    const lows = paths.map((path) => Math.min(...path));
    expect(highs.length).toBe(1000);
    expect(lows[0]).toBeLessThanOrEqual(highs[0]);
    const p = probabilityForRange(highs, 74, null);
    expect(p).toBeGreaterThan(0);
    expect(p).toBeLessThanOrEqual(1);
  });
});

describe("allocation", () => {
  it("respects concentration constraints and builds correlation groups", () => {
    const market = normalizeKalshiMarket(
      {
        ticker: "KXHIGHNY-26JUN25-B75",
        event_ticker: "KXHIGHNY-26JUN25",
        series_ticker: "KXHIGHNY",
        title: "Will the high temperature in New York, NY be above 75F?",
        yes_sub_title: "Above 75F",
        no_sub_title: "75F or below",
        close_time: "2026-06-25T20:00:00Z",
        rules_primary: "Settles using National Weather Service report for Central Park KNYC official station high temperature.",
        yes_bid: 55,
        no_bid: 42
      },
      [mapping]
    );
    const candidate: CandidateOpportunity = {
      market,
      probability: {
        marketTicker: market.marketTicker,
        yesProbability: 0.75,
        noProbability: 0.25,
        meanTemperatureF: 78,
        medianTemperatureF: 78,
        p10TemperatureF: 75,
        p25TemperatureF: 76,
        p75TemperatureF: 80,
        p90TemperatureF: 82,
        confidence: "medium",
        uncertaintyF: 2,
        modelInputs: { nbmWeight: 0.45, hrrrWeight: 0.35, nwsWeight: 0.2, observationsWeight: 0 },
        reasons: [],
        warnings: [],
        sourceLinks: [],
        simulation: { temperaturesF: [76, 78, 80, 82] }
      },
      edge: {
        side: "yes",
        modelProbability: 0.75,
        impliedProbability: 0.58,
        executablePrice: 0.58,
        feeProbabilityEquivalent: 0.01,
        slippageProbabilityEquivalent: 0,
        uncertaintyBuffer: 0.03,
        netEdge: 0.13,
        grossExpectedValuePerContract: 0.15,
        eligible: true,
        reasons: []
      },
      fill: { side: "yes", requestedContracts: 10, filledContracts: 10, averagePrice: 0.58, totalCost: 5.8, remainingContracts: 0, levelsUsed: [{ price: 0.58, quantity: 10 }], slippageVsBestAsk: 0 },
      fee: { totalFeeDollars: 0.1, feePerContractDollars: 0.01, feeMode: "taker", feeSource: "test", isEstimated: false, warnings: [] }
    };
    expect(buildCorrelationGroups([candidate])[0].marketTickers).toContain(market.marketTicker);
    const allocation = recommendAllocation({ budget: 5.9, riskProfile: "balanced" }, [candidate]);
    expect(allocation.recommendedDeployment).toBeCloseTo(5.9, 2);
    expect(allocation.cashHeldBack).toBeCloseTo(0, 2);
    expect(allocation.positions[0].recommendedDollars).toBeCloseTo(5.9, 2);
  });

  it("uses portfolio simulations for probability and downside metrics", () => {
    const makeCandidate = (ticker: string, stationId: string, probability: number): CandidateOpportunity => {
      const market = {
        ...normalizeKalshiMarket(
          {
            ticker,
            event_ticker: ticker.replace("-B75", ""),
            series_ticker: "KXHIGHNY",
            title: "Will the high temperature in New York, NY be above 75F?",
            yes_sub_title: "Above 75F",
            no_sub_title: "75F or below",
            close_time: "2026-06-25T20:00:00Z",
            rules_primary: "Settles using National Weather Service report for Central Park KNYC official station high temperature.",
            yes_bid: 55,
            no_bid: 42
          },
          [mapping]
        ),
        stationId,
        eventDateLocal: "Jun 25, 2026"
      };
      return {
        market,
        probability: {
          marketTicker: market.marketTicker,
          yesProbability: probability,
          noProbability: 1 - probability,
          meanTemperatureF: 78,
          medianTemperatureF: 78,
          p10TemperatureF: 75,
          p25TemperatureF: 76,
          p75TemperatureF: 80,
          p90TemperatureF: 82,
          confidence: "medium",
          uncertaintyF: 2,
          modelInputs: { nbmWeight: 0.45, hrrrWeight: 0.35, nwsWeight: 0.2, observationsWeight: 0 },
          reasons: [],
          warnings: [],
          sourceLinks: []
        },
        edge: {
          side: "yes",
          modelProbability: probability,
          impliedProbability: 0.5,
          executablePrice: 0.5,
          feeProbabilityEquivalent: 0,
          slippageProbabilityEquivalent: 0,
          uncertaintyBuffer: 0.03,
          netEdge: probability - 0.53,
          grossExpectedValuePerContract: probability - 0.5,
          eligible: true,
          reasons: []
        },
        fill: { side: "yes", requestedContracts: 10, filledContracts: 10, averagePrice: 0.5, totalCost: 5, remainingContracts: 0, levelsUsed: [{ price: 0.5, quantity: 10 }], slippageVsBestAsk: 0 },
        fee: { totalFeeDollars: 0, feePerContractDollars: 0, feeMode: "taker", feeSource: "test", isEstimated: false, warnings: [] }
      };
    };

    const allocation = recommendAllocation(
      { budget: 10, riskProfile: "aggressive", maxAmountPerMarket: 5 },
      [makeCandidate("KXHIGHNY-26JUN25-B75", "KNYC", 0.65), makeCandidate("KXHIGHAUS-26JUN25-B75", "KAUS", 0.65)]
    );

    expect(allocation.positions.length).toBe(2);
    expect(allocation.probabilityOfProfit).toBeGreaterThan(0);
    expect(allocation.probabilityOfProfit).toBeLessThan(1);
    expect(allocation.p05ProfitLoss).toBeLessThanOrEqual(allocation.p95ProfitLoss);
  });

  it("supports fractional-sized allocations for small budgets", () => {
    const market = normalizeKalshiMarket(
      {
        ticker: "KXHIGHNY-26JUN25-B75",
        event_ticker: "KXHIGHNY-26JUN25",
        series_ticker: "KXHIGHNY",
        title: "Will the high temperature in New York, NY be above 75F?",
        yes_sub_title: "Above 75F",
        no_sub_title: "75F or below",
        close_time: "2026-06-25T20:00:00Z",
        rules_primary: "Settles using National Weather Service report for Central Park KNYC official station high temperature.",
        yes_bid: 55,
        no_bid: 42
      },
      [mapping]
    );
    const candidate: CandidateOpportunity = {
      market,
      probability: {
        marketTicker: market.marketTicker,
        yesProbability: 0.9,
        noProbability: 0.1,
        meanTemperatureF: 78,
        medianTemperatureF: 78,
        p10TemperatureF: 75,
        p25TemperatureF: 76,
        p75TemperatureF: 80,
        p90TemperatureF: 82,
        confidence: "medium",
        uncertaintyF: 2,
        modelInputs: { nbmWeight: 0.45, hrrrWeight: 0.35, nwsWeight: 0.2, observationsWeight: 0 },
        reasons: [],
        warnings: [],
        sourceLinks: [],
        simulation: { temperaturesF: [76, 78, 80, 82] }
      },
      edge: {
        side: "yes",
        modelProbability: 0.9,
        impliedProbability: 0.5,
        executablePrice: 0.5,
        feeProbabilityEquivalent: 0,
        slippageProbabilityEquivalent: 0,
        uncertaintyBuffer: 0.03,
        netEdge: 0.37,
        grossExpectedValuePerContract: 0.4,
        eligible: true,
        reasons: []
      },
      fill: { side: "yes", requestedContracts: 10, filledContracts: 10, averagePrice: 0.5, totalCost: 5, remainingContracts: 0, levelsUsed: [{ price: 0.5, quantity: 10 }], slippageVsBestAsk: 0 },
      fee: { totalFeeDollars: 0, feePerContractDollars: 0, feeMode: "taker", feeSource: "test", isEstimated: false, warnings: [] }
    };

    const allocation = recommendAllocation({ budget: 0.5, riskProfile: "balanced" }, [candidate]);
    expect(allocation.positions.length).toBe(1);
    expect(allocation.recommendedDeployment).toBeCloseTo(0.5, 2);
    expect(allocation.positions[0].recommendedDollars).toBeCloseTo(0.5, 2);
    expect(allocation.positions[0].contracts).toBeCloseTo(1);
    expect(allocation.positions[0].profitIfCorrect).toBeCloseTo(0.5);
    expect(allocation.positions[0].lossIfIncorrect).toBeCloseTo(0.5);
  });

  it("returns a suggested autosell target for recommended positions", () => {
    const market = normalizeKalshiMarket(
      {
        ticker: "KXHIGHNY-26JUN25-B75",
        event_ticker: "KXHIGHNY-26JUN25",
        series_ticker: "KXHIGHNY",
        title: "Will the high temperature in New York, NY be above 75F?",
        yes_sub_title: "Above 75F",
        no_sub_title: "75F or below",
        close_time: "2026-06-25T20:00:00Z",
        rules_primary: "Settles using National Weather Service report for Central Park KNYC official station high temperature.",
        yes_bid: 55,
        no_bid: 42
      },
      [mapping]
    );
    const candidate: CandidateOpportunity = {
      market,
      probability: {
        marketTicker: market.marketTicker,
        yesProbability: 0.9,
        noProbability: 0.1,
        meanTemperatureF: 78,
        medianTemperatureF: 78,
        p10TemperatureF: 75,
        p25TemperatureF: 76,
        p75TemperatureF: 80,
        p90TemperatureF: 82,
        confidence: "medium",
        uncertaintyF: 2,
        modelInputs: { nbmWeight: 0.45, hrrrWeight: 0.35, nwsWeight: 0.2, observationsWeight: 0 },
        reasons: [],
        warnings: [],
        sourceLinks: [],
        simulation: { temperaturesF: [76, 78, 80, 82] }
      },
      edge: {
        side: "yes",
        modelProbability: 0.9,
        impliedProbability: 0.5,
        executablePrice: 0.5,
        feeProbabilityEquivalent: 0,
        slippageProbabilityEquivalent: 0,
        uncertaintyBuffer: 0.03,
        netEdge: 0.37,
        grossExpectedValuePerContract: 0.4,
        eligible: true,
        reasons: []
      },
      fill: { side: "yes", requestedContracts: 10, filledContracts: 10, averagePrice: 0.5, totalCost: 5, remainingContracts: 0, levelsUsed: [{ price: 0.5, quantity: 10 }], slippageVsBestAsk: 0 },
      fee: { totalFeeDollars: 0, feePerContractDollars: 0, feeMode: "taker", feeSource: "test", isEstimated: false, warnings: [] }
    };

    const allocation = recommendAllocation({ budget: 0.5, riskProfile: "balanced" }, [candidate]);
    expect(allocation.positions).toHaveLength(1);
    expect(allocation.positions[0].targetPrice).toBeGreaterThanOrEqual(allocation.positions[0].averageExecutableFillPrice);
    expect(allocation.positions[0].targetPrice).toBeLessThanOrEqual(0.99);
    expect(allocation.positions[0].targetPrice).toBeGreaterThan(allocation.positions[0].averageExecutableFillPrice);
  });

  it("does not allocate multiple yes positions in mutually exclusive ranges for one event", () => {
    const makeCandidate = (ticker: string, lower: number, upper: number, edge: number, eventTicker = "KXHIGHNY-26JUN25"): CandidateOpportunity => {
      const market = {
        ...normalizeKalshiMarket(
          {
            ticker,
            event_ticker: eventTicker,
            series_ticker: "KXHIGHNY",
            title: `Will the high temperature in New York, NY be ${lower}-${upper}F?`,
            yes_sub_title: `${lower}-${upper}F`,
            no_sub_title: `Not ${lower}-${upper}F`,
            close_time: "2026-06-25T20:00:00Z",
            rules_primary: "Settles using National Weather Service report for Central Park KNYC official station high temperature.",
            yes_bid: 50,
            no_bid: 48
          },
          [mapping]
        ),
        rangeLowerF: lower,
        rangeUpperF: upper,
        lowerInclusive: true,
        upperInclusive: true,
        eventDateLocal: "Jun 25, 2026"
      };
      return {
        market,
        probability: {
          marketTicker: market.marketTicker,
          yesProbability: 0.7,
          noProbability: 0.3,
          meanTemperatureF: 78,
          medianTemperatureF: 78,
          p10TemperatureF: 75,
          p25TemperatureF: 76,
          p75TemperatureF: 80,
          p90TemperatureF: 82,
          confidence: "medium",
          uncertaintyF: 2,
          modelInputs: { nbmWeight: 0.45, hrrrWeight: 0.35, nwsWeight: 0.2, observationsWeight: 0 },
          reasons: [],
          warnings: [],
          sourceLinks: [],
          simulation: { temperaturesF: [76, 77, 80, 81] }
        },
        edge: {
          side: "yes",
          modelProbability: 0.7,
          impliedProbability: 0.5,
          executablePrice: 0.5,
          feeProbabilityEquivalent: 0,
          slippageProbabilityEquivalent: 0,
          uncertaintyBuffer: 0.03,
          netEdge: edge,
          grossExpectedValuePerContract: 0.2,
          eligible: true,
          reasons: []
        },
        fill: { side: "yes", requestedContracts: 100, filledContracts: 100, averagePrice: 0.5, totalCost: 50, remainingContracts: 0, levelsUsed: [{ price: 0.5, quantity: 100 }], slippageVsBestAsk: 0 },
        fee: { totalFeeDollars: 0, feePerContractDollars: 0, feeMode: "taker", feeSource: "test", isEstimated: false, warnings: [] }
      };
    };

    const allocation = recommendAllocation(
      { budget: 50, riskProfile: "aggressive", maxAmountPerMarket: 25 },
      [
        makeCandidate("KXHIGHNY-26JUN25-T76", 76, 77, 0.2),
        makeCandidate("KXHIGHNY-26JUN25-T80", 80, 81, 0.18),
        makeCandidate("KXHIGHAUS-26JUN25-T90", 90, 91, 0.16, "KXHIGHAUS-26JUN25")
      ]
    );

    expect(allocation.positions).toHaveLength(2);
    expect(allocation.warnings.join(" ")).toContain("mutually exclusive event");
  });

  it("resolves correlated positions against shared simulation trials", () => {
    const makeCandidate = (ticker: string, lower: number, upper: number, side: "yes" | "no"): CandidateOpportunity => {
      const market = {
        ...normalizeKalshiMarket(
          {
            ticker,
            event_ticker: "KXHIGHNY-26JUN25",
            series_ticker: "KXHIGHNY",
            title: `Will the high temperature in New York, NY be ${lower}-${upper}F?`,
            yes_sub_title: `${lower}-${upper}F`,
            no_sub_title: `Not ${lower}-${upper}F`,
            close_time: "2026-06-25T20:00:00Z",
            rules_primary: "Settles using National Weather Service report for Central Park KNYC official station high temperature.",
            yes_bid: 50,
            no_bid: 48
          },
          [mapping]
        ),
        rangeLowerF: lower,
        rangeUpperF: upper,
        lowerInclusive: true,
        upperInclusive: true,
        eventDateLocal: "Jun 25, 2026"
      };
      return {
        market,
        probability: {
          marketTicker: market.marketTicker,
          yesProbability: 0.5,
          noProbability: 0.5,
          meanTemperatureF: 78,
          medianTemperatureF: 78,
          p10TemperatureF: 76,
          p25TemperatureF: 76,
          p75TemperatureF: 80,
          p90TemperatureF: 80,
          confidence: "medium",
          uncertaintyF: 2,
          modelInputs: { nbmWeight: 0.45, hrrrWeight: 0.35, nwsWeight: 0.2, observationsWeight: 0 },
          reasons: [],
          warnings: [],
          sourceLinks: [],
          simulation: { temperaturesF: [76, 78, 80] }
        },
        edge: {
          side,
          modelProbability: 0.5,
          impliedProbability: 0.2,
          executablePrice: 0.2,
          feeProbabilityEquivalent: 0,
          slippageProbabilityEquivalent: 0,
          uncertaintyBuffer: 0.03,
          netEdge: side === "no" ? 0.32 : 0.3,
          grossExpectedValuePerContract: 0.3,
          eligible: true,
          reasons: []
        },
        fill: { side, requestedContracts: 100, filledContracts: 100, averagePrice: 0.2, totalCost: 20, remainingContracts: 0, levelsUsed: [{ price: 0.2, quantity: 100 }], slippageVsBestAsk: 0 },
        fee: { totalFeeDollars: 0, feePerContractDollars: 0, feeMode: "taker", feeSource: "test", isEstimated: false, warnings: [] }
      };
    };

    const allocation = recommendAllocation(
      { budget: 4, riskProfile: "aggressive", maxAmountPerMarket: 2 },
      [makeCandidate("KXHIGHNY-26JUN25-T76", 76, 76, "no"), makeCandidate("KXHIGHNY-26JUN25-T80", 80, 80, "no")]
    );

    expect(allocation.positions).toHaveLength(2);
    expect(allocation.probabilityOfProfit).toBe(1);
    expect(allocation.p05ProfitLoss).toBeGreaterThan(0);
    expect(allocation.p05LossDollars).toBe(0);
    expect(allocation.cvar05LossDollars).toBe(0);
  });
});
