import { z } from "zod";

export const supportedMimeSchema = z.enum([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain"
]);

export const createUploadIntentSchema = z
  .object({
    filename: z.string().trim().min(1).max(240),
    mimeType: supportedMimeSchema,
    sizeBytes: z.number().int().positive(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/u)
  })
  .strict();

export const completeUploadSchema = z
  .object({ sha256: z.string().regex(/^[a-f0-9]{64}$/u) })
  .strict();

export const updateDocumentSchema = z.object({ name: z.string().trim().min(1).max(240) }).strict();

export const documentListQuerySchema = z
  .object({
    query: z.string().trim().max(200).default(""),
    status: z
      .enum([
        "UPLOADING",
        "UPLOADED",
        "QUEUED",
        "PROCESSING",
        "READY",
        "FAILED",
        "QUARANTINED",
        "DELETING",
        "ALL"
      ])
      .default("ALL"),
    mimeType: supportedMimeSchema.optional(),
    createdByMe: z
      .enum(["true", "false"])
      .default("false")
      .transform((value) => value === "true"),
    cursor: z.string().max(1_024).optional(),
    limit: z.coerce.number().int().min(1).max(50).default(30)
  })
  .strict();

export const documentQuestionSchema = z
  .object({
    clientMessageId: z.uuid(),
    conversationId: z.uuid().optional(),
    question: z.string().trim().min(1).max(32_000),
    modelKey: z.string().trim().min(1).max(120).default("nexus-fast")
  })
  .strict();

export const documentIdSchema = z.uuid();

export type SupportedMimeType = z.infer<typeof supportedMimeSchema>;
