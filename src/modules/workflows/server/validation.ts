import { z } from "zod";

export const workflowIdSchema = z.uuid();

export const createWorkflowSchema = z
  .object({
    name: z.string().trim().min(2).max(120),
    description: z.string().trim().max(500).optional()
  })
  .strict();

export const updateWorkflowSchema = z
  .object({
    name: z.string().trim().min(2).max(120).optional(),
    description: z.string().trim().max(500).nullable().optional(),
    status: z.enum(["DRAFT", "ARCHIVED"]).optional()
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, "Provide at least one field to update.");

export const createWorkflowVersionSchema = z
  .object({
    schemaVersion: z.literal("nexus.workflow.v1"),
    definition: z.unknown()
  })
  .strict();

export const executeWorkflowSchema = z
  .object({
    input: z.object({ text: z.string().trim().min(1).max(64_000) }).strict()
  })
  .strict();

export const workflowListQuerySchema = z
  .object({
    query: z.string().trim().max(200).default(""),
    status: z.enum(["DRAFT", "ACTIVE", "ARCHIVED", "ALL"]).default("ALL"),
    cursor: z.string().max(1_024).optional(),
    limit: z.coerce.number().int().min(1).max(50).default(30)
  })
  .strict();

export const executionListQuerySchema = z
  .object({
    cursor: z.string().max(1_024).optional(),
    limit: z.coerce.number().int().min(1).max(50).default(25)
  })
  .strict();

export const logListQuerySchema = z
  .object({
    after: z.coerce.bigint().nonnegative().default(0n),
    limit: z.coerce.number().int().min(1).max(200).default(100)
  })
  .strict();
