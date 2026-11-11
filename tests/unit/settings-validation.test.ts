import { describe, expect, it } from "vitest";

import {
  accountDeletionRequestSchema,
  aiPreferencesSchema,
  notificationPreferencesSchema,
  preferenceUpdateSchema
} from "@/modules/settings/server/validation";
import {
  notificationCreateSchema,
  notificationReceiptSchema
} from "@/modules/notifications/server/validation";

describe("Phase 10 validation", () => {
  it("accepts bounded AI and notification preferences", () => {
    expect(
      preferenceUpdateSchema.parse({
        defaultModelKey: "mock/nexus-dev",
        timeZone: "Africa/Lagos",
        aiPreferences: {
          responseStyle: "CONCISE",
          includeSources: true,
          explainCode: false
        },
        notificationPreferences: {
          newActivity: true,
          documentProcessing: false,
          workflowStatus: true
        }
      })
    ).toMatchObject({ timeZone: "Africa/Lagos" });
    expect(aiPreferencesSchema.safeParse({ responseStyle: "RAW" }).success).toBe(false);
    expect(notificationPreferencesSchema.safeParse({ systemAlerts: false }).success).toBe(false);
    expect(preferenceUpdateSchema.safeParse({ timeZone: "Not/AZone" }).success).toBe(false);
  });

  it("requires exactly one bounded read-receipt selector", () => {
    expect(
      notificationReceiptSchema.safeParse({ notificationIds: [crypto.randomUUID()] }).success
    ).toBe(true);
    expect(
      notificationReceiptSchema.safeParse({ allBefore: new Date().toISOString() }).success
    ).toBe(true);
    expect(notificationReceiptSchema.safeParse({}).success).toBe(false);
    expect(
      notificationReceiptSchema.safeParse({
        notificationIds: [crypto.randomUUID()],
        allBefore: new Date().toISOString()
      }).success
    ).toBe(false);
  });

  it("rejects unknown notification types and unconfirmed deletion", () => {
    expect(
      notificationCreateSchema.safeParse({
        userId: "user-1",
        type: "UNREVIEWED_EVENT",
        title: "Unsafe",
        body: "This event type is not allowlisted."
      }).success
    ).toBe(false);
    expect(
      accountDeletionRequestSchema.safeParse({
        password: "a deliberately long password",
        confirmation: "delete"
      }).success
    ).toBe(false);
  });
});
