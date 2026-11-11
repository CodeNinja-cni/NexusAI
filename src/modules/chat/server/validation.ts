import { z } from "zod";

const modelKeySchema = z.string().trim().min(1).max(120);
const conversationStatusSchema = z.enum(["ACTIVE", "ARCHIVED"]);

export const createConversationSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    modelKey: modelKeySchema.optional(),
    documentIds: z.array(z.uuid()).max(20).default([])
  })
  .strict();

export const createMessageSchema = z
  .object({
    clientMessageId: z.uuid(),
    content: z.string().trim().min(1).max(32_000),
    modelKey: modelKeySchema,
    documentIds: z.array(z.uuid()).max(20).default([]),
    parentMessageId: z.uuid().optional()
  })
  .strict();

export const regenerateMessageSchema = z
  .object({
    clientGenerationId: z.uuid(),
    modelKey: modelKeySchema.optional()
  })
  .strict();

export const updateConversationSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    status: conversationStatusSchema.optional(),
    modelKey: modelKeySchema.optional()
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one field must be provided."
  });

export const conversationListQuerySchema = z
  .object({
    query: z.string().trim().max(200).default(""),
    status: z.enum(["ACTIVE", "ARCHIVED", "ALL"]).default("ACTIVE"),
    createdByMe: z
      .enum(["true", "false"])
      .default("false")
      .transform((value) => value === "true"),
    cursor: z.string().max(1_024).optional(),
    limit: z.coerce.number().int().min(1).max(50).default(30)
  })
  .strict();

export const messageListQuerySchema = z
  .object({
    cursor: z.string().max(512).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50)
  })
  .strict();

export const resourceIdSchema = z.uuid();
