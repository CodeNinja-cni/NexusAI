import "server-only";

import { prisma } from "@/platform/database/prisma";

import { aiPreferencesSchema, notificationPreferencesSchema } from "./validation";

export async function getUserPreference(userId: string) {
  const row = await prisma.userPreference.upsert({
    where: { userId },
    create: { userId },
    update: {}
  });
  return {
    defaultModelKey: row.defaultModelKey,
    timeZone: row.timeZone,
    aiPreferences: aiPreferencesSchema
      .catch({ responseStyle: "BALANCED", includeSources: true, explainCode: true })
      .parse(row.aiPreferences),
    notificationPreferences: notificationPreferencesSchema
      .catch({ newActivity: true, documentProcessing: true, workflowStatus: true })
      .parse(row.notificationPreferences),
    etag: `"user-preference:${userId}:${row.version}"`
  };
}
