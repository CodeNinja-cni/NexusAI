import { z } from "zod";

const decimalString = z
  .string()
  .regex(/^\d{1,19}$/u, "Use a non-negative decimal string with at most 19 digits.")
  .transform((value) => BigInt(value))
  .refine((value) => value <= 9_223_372_036_854_775_807n, "Value exceeds BIGINT range.");

const optionalLimit = z.union([decimalString, z.null()]);

export const updateUsageQuotaSchema = z
  .object({
    requestLimit: optionalLimit,
    inputTokenLimit: optionalLimit,
    outputTokenLimit: optionalLimit,
    costLimitMicros: optionalLimit
  })
  .strict();

export const usageSummaryQuerySchema = z
  .object({
    workspaceId: z.uuid(),
    from: z.string().max(64).optional(),
    to: z.string().max(64).optional(),
    groupBy: z.enum(["day", "model", "operation"]).default("day")
  })
  .strict();

export const usageRecordsQuerySchema = z
  .object({
    workspaceId: z.uuid(),
    from: z.string().max(64).optional(),
    to: z.string().max(64).optional(),
    provider: z.string().trim().min(1).max(80).optional(),
    model: z.string().trim().min(1).max(120).optional(),
    cursor: z.string().max(1_024).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(30)
  })
  .strict();

export const usageQuotaQuerySchema = z.object({ workspaceId: z.uuid() }).strict();

export function parseUsageRange(fromInput?: string, toInput?: string) {
  const to = toInput ? parseDate(toInput, "to") : new Date();
  const from = fromInput ? parseDate(fromInput, "from") : new Date(to.getTime() - 30 * 86_400_000);
  if (from >= to) throw new UsageRangeError("The from timestamp must be earlier than to.");
  if (to.getTime() - from.getTime() > 366 * 86_400_000) {
    throw new UsageRangeError("Usage ranges cannot exceed 366 days.");
  }
  if (to.getTime() > Date.now() + 5 * 60_000) {
    throw new UsageRangeError("The to timestamp cannot be in the future.");
  }
  return { from, to };
}

function parseDate(value: string, field: string) {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || !/^\d{4}-\d{2}-\d{2}T/u.test(value)) {
    throw new UsageRangeError(`${field} must be an ISO 8601 timestamp.`);
  }
  return parsed;
}

export class UsageRangeError extends Error {}
