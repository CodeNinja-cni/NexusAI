import "server-only";

import { z } from "zod";

import { prisma } from "@/platform/database/prisma";

export const workspaceIdSchema = z.uuid();

export async function getAuthorizedWorkspace(userId: string, workspaceId: string) {
  return prisma.workspaceMember.findUnique({
    where: {
      workspaceId_userId: { workspaceId, userId },
      workspace: {
        status: "ACTIVE",
        deletedAt: null
      }
    },
    select: {
      role: true,
      workspace: {
        select: {
          id: true,
          kind: true,
          name: true,
          status: true,
          version: true,
          createdAt: true,
          updatedAt: true
        }
      }
    }
  });
}
