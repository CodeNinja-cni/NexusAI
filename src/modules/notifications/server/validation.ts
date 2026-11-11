import { z } from "zod";

export const NOTIFICATION_TYPES = [
  "NEW_ACTIVITY",
  "DOCUMENT_PROCESSING",
  "WORKFLOW_STATUS",
  "SYSTEM_ALERT"
] as const;

export const notificationTypeSchema = z.enum(NOTIFICATION_TYPES);

export const notificationListQuerySchema = z
  .object({
    unread: z.enum(["true", "false"]).optional(),
    type: notificationTypeSchema.optional(),
    cursor: z.string().max(1_024).optional(),
    limit: z.coerce.number().int().min(1).max(50).default(30)
  })
  .strict();

export const notificationReadSchema = z.object({ read: z.boolean() }).strict();

export const notificationReceiptSchema = z
  .object({
    notificationIds: z.array(z.uuid()).min(1).max(100).optional(),
    allBefore: z.iso.datetime({ offset: true }).optional()
  })
  .strict()
  .refine((value) => Boolean(value.notificationIds) !== Boolean(value.allBefore), {
    message: "Provide notificationIds or allBefore, but not both."
  });

const safeDataValueSchema = z.union([
  z.string().max(512),
  z.number().finite(),
  z.boolean(),
  z.null()
]);

export const notificationCreateSchema = z
  .object({
    userId: z.string().min(1).max(128),
    workspaceId: z.uuid().nullable().optional(),
    type: notificationTypeSchema,
    title: z.string().trim().min(1).max(160),
    body: z.string().trim().min(1).max(500),
    actionUrl: z.string().max(512).nullable().optional(),
    data: z.record(z.string().max(80), safeDataValueSchema).default({}),
    eventKey: z.string().min(1).max(512).optional(),
    expiresAt: z.date().nullable().optional()
  })
  .strict();

export const notificationIdSchema = z.uuid();

export type NotificationType = z.infer<typeof notificationTypeSchema>;
