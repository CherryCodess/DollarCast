import { z } from "zod";
import { env } from "./env";

const paginatedSchema = z.object({
  cursor: z.string().nullable().optional()
}).passthrough();

type CircuitState = {
  failures: number;
  openedUntil: number;
  lastError?: string;
};

const circuitState: CircuitState = {
  failures: 0,
  openedUntil: 0
};

export class KalshiApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly path: string,
    readonly retryAfterSeconds?: number
  ) {
    super(message);
    this.name = "KalshiApiError";
  }
}

export class KalshiRateLimitError extends KalshiApiError {
  constructor(path: string, retryAfterSeconds?: number) {
    super(`Kalshi API 429 for ${path}`, 429, path, retryAfterSeconds);
    this.name = "KalshiRateLimitError";
  }
}

export class KalshiCircuitOpenError extends Error {
  constructor(readonly openedUntil: number, readonly lastError?: string) {
    super(`Kalshi circuit breaker is open until ${new Date(openedUntil).toISOString()}`);
    this.name = "KalshiCircuitOpenError";
  }
}

function circuitIsOpen(): boolean {
  return Date.now() < circuitState.openedUntil;
}

function recordSuccess() {
  circuitState.failures = 0;
  circuitState.openedUntil = 0;
  circuitState.lastError = undefined;
}

function recordFailure(error: Error) {
  circuitState.failures += 1;
  circuitState.lastError = error.message;
  if (circuitState.failures >= env.kalshiCircuitBreakerFailures) {
    circuitState.openedUntil = Date.now() + env.kalshiCircuitBreakerCooldownMs;
  }
}

function retryDelayMs(response: Response, attempt: number): number {
  const retryAfter = Number(response.headers.get("retry-after"));
  if (Number.isFinite(retryAfter) && retryAfter > 0) {
    return Math.min(env.kalshiRetryMaxMs, retryAfter * 1000);
  }
  const exponential = env.kalshiRetryBaseMs * 2 ** attempt;
  const jitter = Math.floor(Math.random() * env.kalshiRetryBaseMs);
  return Math.min(env.kalshiRetryMaxMs, exponential + jitter);
}

function shouldRetry(status: number): boolean {
  return status === 429 || status === 408 || status === 500 || status === 502 || status === 503 || status === 504;
}

export function getKalshiCircuitState() {
  return { ...circuitState, isOpen: circuitIsOpen() };
}

export class KalshiClient {
  constructor(private readonly baseUrl = env.kalshiApiBase) {}

  private async sleep(ms: number) {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  private async get<T>(path: string, params: Record<string, string | number | string[] | undefined> = {}): Promise<T> {
    if (circuitIsOpen()) {
      throw new KalshiCircuitOpenError(circuitState.openedUntil, circuitState.lastError);
    }
    const url = new URL(`${this.baseUrl}${path}`);
    Object.entries(params).forEach(([key, value]) => {
      if (Array.isArray(value)) {
        value.forEach((item) => url.searchParams.append(key, item));
      } else if (value !== undefined) {
        url.searchParams.set(key, String(value));
      }
    });
    let lastError: Error | null = null;
    for (let attempt = 0; attempt <= env.kalshiMaxRetries; attempt++) {
      try {
        const response = await fetch(url, { headers: { accept: "application/json" }, cache: "no-store" });
        if (response.ok) {
          recordSuccess();
          return response.json() as Promise<T>;
        }
        if (response.status === 429) {
          lastError = new KalshiRateLimitError(path, Number(response.headers.get("retry-after")) || undefined);
        } else {
          lastError = new KalshiApiError(`Kalshi API ${response.status} for ${path}`, response.status, path);
        }
        if (attempt < env.kalshiMaxRetries && shouldRetry(response.status)) {
          await this.sleep(retryDelayMs(response, attempt));
          continue;
        }
        recordFailure(lastError);
        throw lastError;
      } catch (error) {
        if (error instanceof KalshiApiError) throw error;
        lastError = error instanceof Error ? error : new Error("Kalshi API request failed.");
        if (attempt < env.kalshiMaxRetries) {
          await this.sleep(Math.min(env.kalshiRetryMaxMs, env.kalshiRetryBaseMs * 2 ** attempt));
          continue;
        }
        recordFailure(lastError);
        throw lastError;
      }
    }
    const error = lastError ?? new Error(`Kalshi API request failed for ${path}`);
    recordFailure(error);
    throw error;
  }

  async getSeries(cursor?: string) {
    return this.get<Record<string, unknown>>("/series", { cursor });
  }

  async getSeriesByTicker(seriesTicker: string) {
    return this.get<Record<string, unknown>>(`/series/${encodeURIComponent(seriesTicker)}`);
  }

  async getMarkets(params: Record<string, string | number | undefined> = {}) {
    return this.get<Record<string, unknown>>("/markets", params);
  }

  async getMarket(ticker: string) {
    return this.get<Record<string, unknown>>(`/markets/${encodeURIComponent(ticker)}`);
  }

  async getOrderbooks(tickers: string[]) {
    return this.get<Record<string, unknown>>("/markets/orderbooks", { tickers });
  }

  async getOrderbook(ticker: string) {
    return this.get<Record<string, unknown>>(`/markets/${encodeURIComponent(ticker)}/orderbook`);
  }

  async getEventMetadata(eventTicker: string) {
    return this.get<Record<string, unknown>>(`/events/${encodeURIComponent(eventTicker)}/metadata`);
  }

  async getEvent(eventTicker: string) {
    return this.get<Record<string, unknown>>(`/events/${encodeURIComponent(eventTicker)}`);
  }

  async getSeriesFeeChanges(seriesTicker?: string) {
    return this.get<Record<string, unknown>>("/series/fee_changes", { series_ticker: seriesTicker });
  }

  async getEventFeeChanges(eventTicker?: string) {
    return this.get<Record<string, unknown>>("/events/fee_changes", { event_ticker: eventTicker });
  }

  async paginate(path: "/series" | "/markets", params: Record<string, string | number | string[] | undefined> = {}) {
    const records: unknown[] = [];
    let cursor: string | undefined;
    do {
      const page = await this.get<Record<string, unknown>>(path, { ...params, cursor });
      const parsed = paginatedSchema.parse(page);
      const list = (page.series ?? page.markets ?? []) as unknown[];
      records.push(...list);
      cursor = parsed.cursor ?? undefined;
    } while (cursor);
    return records;
  }
}
