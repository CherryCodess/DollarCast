import { describe, expect, it } from "vitest";
import { fixtureMarkets } from "./fixtures";

describe("market integration fixtures", () => {
  it("excludes unsupported markets from allocation candidates", async () => {
    process.env.DEMO_MODE = "true";
    const { buildCandidates } = await import("./market-service");
    const candidates = await buildCandidates(fixtureMarkets);
    expect(candidates.some((candidate) => candidate.market.marketType === "unsupported")).toBe(false);
  });
});
