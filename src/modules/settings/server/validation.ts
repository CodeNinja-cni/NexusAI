import { z } from "zod";

import { passwordSchema } from "@/shared/validation/auth";

export const aiPreferencesSchema = z
  .object({
    responseStyle: z.enum(["BALANCED", "CONCISE", "DETAILED"]).default("BALANCED"),
    includeSources: z.boolean().default(true),
    explainCode: z.boolean().default(true)
  })
  .strict();

export const notificationPreferencesSchema = z
  .object({
    newActivity: z.boolean().default(true),
    documentProcessing: z.boolean().default(true),
    workflowStatus: z.boolean().default(true)
  })
  .strict();

const timeZoneSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .refine((value) => {
    try {
      new Intl.DateTimeFormat("en", { timeZone: value }).format();
      return true;
    } catch {
      return false;
    }
  }, "Choose a valid IANA time zone.");

export const preferenceUpdateSchema = z
  .object({
    theme: z.enum(["system", "light", "dark"]).optional(),
    locale: z.enum(["en"]).optional(),
    timeZone: timeZoneSchema.optional(),
    defaultWorkspaceId: z.uuid().nullable().optional(),
    defaultModelKey: z.string().trim().min(1).max(120).nullable().optional(),
    aiPreferences: aiPreferencesSchema.optional(),
    notificationPreferences: notificationPreferencesSchema.optional()
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, "Provide at least one preference field.");

export const passwordChangeSchema = z
  .object({
    currentPassword: z.string().min(1).max(128),
    newPassword: passwordSchema,
    confirmPassword: z.string().min(6).max(128)
  })
  .strict()
  .refine((value) => value.newPassword === value.confirmPassword, {
    path: ["confirmPassword"],
    message: "Passwords do not match."
  });

export const accountDeletionRequestSchema = z
  .object({ password: z.string().min(1).max(128), confirmation: z.literal("DELETE MY ACCOUNT") })
  .strict();

export const accountDeletionCancellationSchema = z
  .object({ token: z.string().min(32).max(256) })
  .strict();
