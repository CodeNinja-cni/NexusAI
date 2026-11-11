import { describe, expect, it } from "vitest";

import { calculateEstimatedCostMicros } from "@/modules/usage/server/pricing";

const fixturePrice = {
  id: "00000000-0000-4000-8000-000000000001",
  version: "test-only-price-v1",
  currency: "USD",
  inputPriceMicrosPerMillion: 2_000_000n,
  cachedInputPriceMicrosPerMillion: 500_000n,
  outputPriceMicrosPerMillion: 8_000_000n
};

describe("usage pricing", () => {
  it("calculates from the immutable rate snapshot and provider token totals", () => {
    expect(
      calculateEstimatedCostMicros(
        { inputTokens: 1_000_000n, outputTokens: 250_000n },
        fixturePrice
      )
    ).toBe(4_000_000n);
  });

  it("charges cached input at the configured cached rate without double counting", () => {
    expect(
      calculateEstimatedCostMicros(
        {
          inputTokens: 1_000_000n,
          cachedInputTokens: 400_000n,
          outputTokens: 0n
        },
        fixturePrice
      )
    ).toBe(1_400_000n);
  });

  it("uses the input rate when a catalog row has no distinct cached rate", () => {
    expect(
      calculateEstimatedCostMicros(
        { inputTokens: 1_000_000n, cachedInputTokens: 900_000n, outputTokens: 0n },
        { ...fixturePrice, cachedInputPriceMicrosPerMillion: null }
      )
    ).toBe(2_000_000n);
  });

  it("rounds upward to one currency micro-unit for conservative quota settlement", () => {
    expect(
      calculateEstimatedCostMicros(
        { inputTokens: 1n, outputTokens: 0n },
        { ...fixturePrice, inputPriceMicrosPerMillion: 1n }
      )
    ).toBe(1n);
  });

  it("rejects invalid negative provider usage", () => {
    expect(() =>
      calculateEstimatedCostMicros({ inputTokens: -1n, outputTokens: 0n }, fixturePrice)
    ).toThrow(RangeError);
  });
});
