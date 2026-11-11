import { describe, expect, it } from "vitest";

import {
  adminUserUpdateSchema,
  parseAdminRange,
  platformSettingSchemas
} from "@/modules/administration/server/validation";

describe("Phase 12 administration validation", () => {
  it("requires a bounded audit reason and optimistic version for access changes", () => {
    expect(
      adminUserUpdateSchema.safeParse({
        platformRole: "ADMIN",
        version: 2,
        reason: "Approved for the on-call platform operations rotation."
      }).success
    ).toBe(true);
    expect(
      adminUserUpdateSchema.safeParse({
        platformRole: "ADMIN",
        version: 2,
        reason: "because"
      }).success
    ).toBe(false);
    expect(
      adminUserUpdateSchema.safeParse({
        platformRole: "OWNER",
        version: 2,
        reason: "Attempt to inject a workspace role into platform authority."
      }).success
    ).toBe(false);
  });

  it("accepts only allowlisted, non-secret platform setting shapes", () => {
    expect(platformSettingSchemas.user_registration.safeParse({ mode: "CLOSED" }).success).toBe(
      true
    );
    expect(
      platformSettingSchemas.maintenance_notice.safeParse({ enabled: true, message: "short" })
        .success
    ).toBe(false);
    expect(
      platformSettingSchemas.admin_operations.safeParse({
        failedJobAlertThreshold: 5,
        defaultUsageRangeDays: 30,
        providerSecret: "never"
      }).success
    ).toBe(false);
  });

  it("rejects inverted and overlong analytics ranges", () => {
    expect(() =>
      parseAdminRange({
        from: "2026-11-08T00:00:00.000Z",
        to: "2026-11-01T00:00:00.000Z"
      })
    ).toThrow();
    expect(() =>
      parseAdminRange({
        from: "2024-01-01T00:00:00.000Z",
        to: "2026-11-01T00:00:00.000Z"
      })
    ).toThrow();
  });
});
