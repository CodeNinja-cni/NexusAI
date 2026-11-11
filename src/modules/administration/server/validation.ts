import { z } from "zod";

const reason = z.string().trim().min(12).max(500);
const cursor = z.string().trim().min(1).max(1024).optional();
const limit = z.coerce.number().int().min(1).max(100).default(30);
const optionalDate = z.iso.datetime({ offset: true }).optional();

export const adminUserListSchema = z
  .object({
    query: z.string().trim().min(2).max(120).optional(),
    status: z.enum(["ACTIVE", "SUSPENDED", "PENDING_DELETION", "DELETED"]).optional(),
    platformRole: z.enum(["USER", "ADMIN"]).optional(),
    from: optionalDate,
    to: optionalDate,
    cursor,
    limit
  })
  .strict();

export const adminUserUpdateSchema = z
  .object({
    platformRole: z.enum(["USER", "ADMIN"]).optional(),
    status: z.enum(["ACTIVE", "SUSPENDED"]).optional(),
    version: z.number().int().positive(),
    reason
  })
  .strict()
  .refine((value) => value.platformRole !== undefined || value.status !== undefined, {
    message: "Provide a platform role or account status change."
  });

export const adminSessionRevocationSchema = z
  .object({
    sessionIds: z.array(z.string().min(1).max(255)).min(1).max(50).optional(),
    reason
  })
  .strict();

export const adminRangeSchema = z
  .object({
    from: optionalDate,
    to: optionalDate,
    groupBy: z.enum(["day", "provider", "model", "operation"]).default("day"),
    cursor,
    limit,
    provider: z.string().trim().min(1).max(80).optional(),
    model: z.string().trim().min(1).max(120).optional(),
    operation: z.string().trim().min(1).max(80).optional()
  })
  .strict();

export const adminAuditListSchema = z
  .object({
    actorUserId: z.string().min(1).max(255).optional(),
    workspaceId: z.uuid().optional(),
    action: z.string().trim().min(1).max(120).optional(),
    targetType: z.string().trim().min(1).max(80).optional(),
    targetId: z.string().trim().min(1).max(128).optional(),
    outcome: z.string().trim().min(1).max(40).optional(),
    requestId: z.string().trim().min(1).max(128).optional(),
    from: optionalDate,
    to: optionalDate,
    cursor,
    limit
  })
  .strict();

export const adminActivitySchema = z
  .object({
    cursor,
    limit,
    outcome: z.enum(["SUCCEEDED", "FAILED", "DENIED"]).optional()
  })
  .strict();

export const platformSettingUpdateSchema = z.object({ value: z.unknown(), reason }).strict();

export const platformSettingSchemas = {
  user_registration: z.object({ mode: z.enum(["OPEN", "CLOSED"]) }).strict(),
  maintenance_notice: z
    .object({ enabled: z.boolean(), message: z.string().trim().max(240) })
    .strict()
    .refine((value) => !value.enabled || value.message.length >= 8, {
      message: "An enabled maintenance notice needs a message of at least 8 characters."
    }),
  admin_operations: z
    .object({
      failedJobAlertThreshold: z.number().int().min(1).max(1000),
      defaultUsageRangeDays: z.union([z.literal(7), z.literal(30), z.literal(90)])
    })
    .strict()
} as const;

export type PlatformSettingKey = keyof typeof platformSettingSchemas;

export function isPlatformSettingKey(value: string): value is PlatformSettingKey {
  return Object.hasOwn(platformSettingSchemas, value);
}

export function parseAdminRange(input: {
  readonly from?: string | undefined;
  readonly to?: string | undefined;
}) {
  const to = input.to ? new Date(input.to) : new Date();
  const from = input.from
    ? new Date(input.from)
    : new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);
  if (from >= to || to.getTime() - from.getTime() > 366 * 24 * 60 * 60 * 1000) {
    throw new AdminRangeError();
  }
  return { from, to };
}

export class AdminRangeError extends Error {}
