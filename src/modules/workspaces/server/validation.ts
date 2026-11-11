import { z } from "zod";

import { emailSchema } from "@/shared/validation/auth";

export const workspaceNameSchema = z
  .string()
  .trim()
  .min(2, "Workspace name must contain at least 2 characters.")
  .max(120, "Workspace name must contain at most 120 characters.");

const workspaceSlugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, "Workspace slug must contain at least 3 characters.")
  .max(120, "Workspace slug must contain at most 120 characters.")
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u, "Use lowercase letters, numbers, and single hyphens.");

export const createWorkspaceSchema = z
  .object({ name: workspaceNameSchema, slug: workspaceSlugSchema.optional() })
  .strict();

export const updateWorkspaceSchema = z
  .object({ name: workspaceNameSchema.optional(), slug: workspaceSlugSchema.nullable().optional() })
  .strict()
  .refine((value) => Object.keys(value).length > 0, "Provide at least one field to update.");

export const invitationSchema = z
  .object({ email: emailSchema, role: z.enum(["ADMIN", "MEMBER"]) })
  .strict();

export const memberRoleSchema = z.object({ role: z.enum(["ADMIN", "MEMBER"]) }).strict();

export const ownershipTransferSchema = z.object({ newOwnerUserId: z.string().min(1) }).strict();

export const acceptInvitationSchema = z.object({ token: z.string().min(32).max(512) }).strict();
