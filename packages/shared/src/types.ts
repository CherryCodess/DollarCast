export type MarketType = "daily_temperature" | "hourly_temperature" | "unsupported";
export type Direction = "high" | "low" | "hourly" | "unknown";
export type ParseStatus = "verified" | "needs_review" | "unsupported";
export type Confidence = "high" | "medium" | "low";
export type PositionSide = "yes" | "no";

export type SourceLink = {
  label: string;
  url: string;
  sourceType: "kalshi" | "nbm" | "hrrr" | "nws" | "metar" | "rules" | "settlement";
  whyItMatters: string;
  observedAt?: string | null;
};

export type NormalizedMarket = {
  marketTicker: string;
  eventTicker: string;
  seriesTicker: string;
  eventTitle?: string | null;
  rawTitle: string;
  rawSubtitle: string | null;
  yesSubtitle: string | null;
  noSubtitle: string | null;
  marketType: MarketType;
  direction: Direction;
  cityName: string | null;
  stateCode: string | null;
  eventDateLocal: string | null;
  eventHourLocal: string | null;
  timezone: string | null;
  rangeLowerF: number | null;
  rangeUpperF: number | null;
  lowerInclusive: boolean;
  upperInclusive: boolean;
  stationId: string | null;
  stationName: string | null;
  stationLatitude: number | null;
  stationLongitude: number | null;
  settlementSourceName: string | null;
  settlementSourceUrl: string | null;
  contractUrl: string | null;
  contractTermsUrl: string | null;
  closeTime: string;
  expirationTime: string | null;
  yesBid: number | null;
  yesAsk: number | null;
  noBid: number | null;
  noAsk: number | null;
  lastPrice: number | null;
  volume: number | null;
  volume24h: number | null;
  openInterest: number | null;
  liquidityDollars: number | null;
  fractionalTradingEnabled: boolean;
  rawRulesPrimary: string | null;
  rawRulesSecondary: string | null;
  parseStatus: ParseStatus;
  parseWarnings: string[];
};

export type WeatherStationMapping = {
  seriesTicker: string;
  cityName: string;
  stateCode: string;
  stationId: string;
  stationName: string;
  icaoCode: string | null;
  latitude: number;
  longitude: number;
  timezone: string;
  settlementSourceName: string;
  settlementSourceUrl: string;
  dailyObservationWindow: string;
  dailyReportTimezone: string;
  sourceConfidence: "verified" | "needs_review";
  verifiedAt: string;
  notes?: string | null;
};

export type OrderBookLevel = {
  price: number;
  quantity: number;
};

export type OrderBook = {
  yesBids: OrderBookLevel[];
  noBids: OrderBookLevel[];
  yesAsks?: OrderBookLevel[];
  noAsks?: OrderBookLevel[];
};

export type ExecutableFill = {
  side: PositionSide;
  requestedContracts: number;
  filledContracts: number;
  averagePrice: number;
  totalCost: number;
  remainingContracts: number;
  levelsUsed: OrderBookLevel[];
  slippageVsBestAsk: number;
};

export type FeeEstimate = {
  totalFeeDollars: number;
  feePerContractDollars: number;
  feeMode: "taker" | "maker" | "unknown";
  feeSource: string;
  isEstimated: boolean;
  warnings: string[];
};

export type MarketProbability = {
  marketTicker: string;
  yesProbability: number;
  noProbability: number;
  meanTemperatureF: number;
  medianTemperatureF: number;
  p10TemperatureF: number;
  p25TemperatureF: number;
  p75TemperatureF: number;
  p90TemperatureF: number;
  confidence: Confidence;
  uncertaintyF: number;
  modelInputs: {
    nbmWeight: number;
    hrrrWeight: number;
    nwsWeight: number;
    observationsWeight: number;
  };
  reasons: string[];
  warnings: string[];
  sourceLinks: SourceLink[];
  simulation?: {
    profits?: number[];
    temperaturesF?: number[];
  };
};

export type EdgeResult = {
  side: PositionSide;
  modelProbability: number;
  impliedProbability: number;
  executablePrice: number;
  feeProbabilityEquivalent: number;
  slippageProbabilityEquivalent: number;
  uncertaintyBuffer: number;
  netEdge: number;
  grossExpectedValuePerContract: number;
  eligible: boolean;
  reasons: string[];
};

export type CorrelationGroup = {
  groupId: string;
  city: string;
  stationId: string;
  localDate: string;
  groupType: "same_event" | "city_day" | "overlapping_hours";
  marketTickers: string[];
};

export type RecommendedPosition = {
  marketTicker: string;
  marketTitle: string;
  marketLocation?: string;
  marketEventTime?: string;
  eventTicker?: string;
  seriesTicker?: string;
  rawTitle?: string;
  contractUrl?: string | null;
  side: PositionSide;
  recommendedDollars: number;
  contracts: number;
  currentEventPrice: number;
  averageExecutableFillPrice: number;
  estimatedFee: number;
  costIncludingFee: number;
  profitIfCorrect: number;
  lossIfIncorrect: number;
  estimatedExpectedProfit: number;
  modelProbability: number;
  marketPrice: number;
  targetPrice: number;
  netEdge: number;
  confidence: Confidence;
  correlationGroup: string;
};

export type AllocationRecommendation = {
  totalBudget: number;
  recommendedDeployment: number;
  cashHeldBack: number;
  totalEstimatedFees: number;
  expectedProfit: number;
  expectedRoi: number;
  probabilityOfProfit: number;
  maxPossibleProfit: number;
  maxPossibleLoss: number;
  p05ProfitLoss: number;
  p95ProfitLoss: number;
  p05LossDollars: number;
  cvar05: number;
  cvar05LossDollars: number;
  positions: RecommendedPosition[];
  warnings: string[];
  generatedAt: string;
};

export type RiskProfile = "conservative" | "balanced" | "aggressive";
export type AllocationMode = "risk_adjusted" | "zero_one_knapsack" | "fractional_knapsack";

export type AllocationInput = {
  budget: number;
  riskProfile: RiskProfile;
  allocationMode?: AllocationMode;
  maxTotalLoss?: number;
  maxAmountPerMarket?: number;
};

export type CandidateOpportunity = {
  market: NormalizedMarket;
  probability: MarketProbability;
  edge: EdgeResult;
  fill: ExecutableFill;
  fee: FeeEstimate;
};
