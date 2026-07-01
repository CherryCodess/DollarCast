export function seededRandom(seed = 7): () => number {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function normal(rand: () => number): number {
  const u = Math.max(rand(), 1e-12);
  const v = Math.max(rand(), 1e-12);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export function simulateTemperaturePaths(input: {
  hourlyMeanF: number[];
  paths?: number;
  sigmaDailyF?: number;
  sigmaHourlyF?: number;
  rho?: number;
  observedMaxF?: number | null;
  observedMinF?: number | null;
  seed?: number;
}): number[][] {
  const paths = input.paths ?? 25000;
  const sigmaDaily = input.sigmaDailyF ?? 1.4;
  const sigmaHourly = input.sigmaHourlyF ?? 0.9;
  const rho = input.rho ?? 0.8;
  const rand = seededRandom(input.seed ?? 11);
  const out: number[][] = [];
  for (let p = 0; p < paths; p++) {
    const dailyBias = normal(rand) * sigmaDaily;
    let residual = normal(rand) * sigmaHourly;
    const path: number[] = [];
    for (const mean of input.hourlyMeanF) {
      residual = rho * residual + Math.sqrt(1 - rho * rho) * normal(rand) * sigmaHourly;
      let value = mean + dailyBias + residual;
      if (input.observedMaxF != null) value = Math.max(value, input.observedMaxF);
      if (input.observedMinF != null) value = Math.min(value, input.observedMinF);
      path.push(value);
    }
    out.push(path);
  }
  return out;
}

export function probabilityForRange(values: number[], lower: number | null, upper: number | null, lowerInclusive = true, upperInclusive = true): number {
  const wins = values.filter((value) => {
    const lowerOk = lower == null || (lowerInclusive ? value >= lower : value > lower);
    const upperOk = upper == null || (upperInclusive ? value <= upper : value < upper);
    return lowerOk && upperOk;
  }).length;
  return values.length ? wins / values.length : 0;
}

export function percentile(values: number[], p: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor((p / 100) * sorted.length)));
  return sorted[idx];
}
