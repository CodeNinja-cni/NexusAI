import "server-only";

import type { Prisma } from "@/generated/prisma/client";

export const PRICE_DENOMINATOR = 1_000_000n;

export interface TokenUsageAmounts {
  readonly inputTokens: bigint;
  readonly outputTokens: bigint;
  readonly cachedInputTokens?: bigint | null | undefined;
  readonly reasoningTokens?: bigint | null | undefined;
}

export interface ModelPriceSnapshot {
  readonly id: string;
  readonly version: string;
  readonly currency: string;
  readonly inputPriceMicrosPerMillion: bigint;
  readonly cachedInputPriceMicrosPerMillion: bigint | null;
  readonly outputPriceMicrosPerMillion: bigint;
}

export async function findEffectiveModelPrice(
  transaction: Prisma.TransactionClient,
  provider: string,
  model: string,
  at: Date
): Promise<ModelPriceSnapshot | null> {
  return transaction.aiModelPrice.findFirst({
    where: {
      provider,
      model,
      effectiveFrom: { lte: at },
      OR: [{ effectiveTo: null }, { effectiveTo: { gt: at } }]
    },
    orderBy: [{ effectiveFrom: "desc" }, { id: "desc" }],
    select: {
      id: true,
      version: true,
      currency: true,
      inputPriceMicrosPerMillion: true,
      cachedInputPriceMicrosPerMillion: true,
      outputPriceMicrosPerMillion: true
    }
  });
}

export function calculateEstimatedCostMicros(
  usage: TokenUsageAmounts,
  price: ModelPriceSnapshot
): bigint {
  assertNonnegativeUsage(usage);
  const cachedInputTokens = minimum(usage.cachedInputTokens ?? 0n, usage.inputTokens);
  const uncachedInputTokens = usage.inputTokens - cachedInputTokens;
  const cachedInputRate =
    price.cachedInputPriceMicrosPerMillion ?? price.inputPriceMicrosPerMillion;
  const numerator =
    uncachedInputTokens * price.inputPriceMicrosPerMillion +
    cachedInputTokens * cachedInputRate +
    usage.outputTokens * price.outputPriceMicrosPerMillion;

  return divideRoundUp(numerator, PRICE_DENOMINATOR);
}

function assertNonnegativeUsage(usage: TokenUsageAmounts) {
  if (
    usage.inputTokens < 0n ||
    usage.outputTokens < 0n ||
    (usage.cachedInputTokens !== undefined &&
      usage.cachedInputTokens !== null &&
      usage.cachedInputTokens < 0n) ||
    (usage.reasoningTokens !== undefined &&
      usage.reasoningTokens !== null &&
      usage.reasoningTokens < 0n)
  ) {
    throw new RangeError("Token usage cannot be negative.");
  }
}

function divideRoundUp(numerator: bigint, denominator: bigint) {
  if (numerator === 0n) return 0n;
  return (numerator + denominator - 1n) / denominator;
}

function minimum(left: bigint, right: bigint) {
  return left < right ? left : right;
}
