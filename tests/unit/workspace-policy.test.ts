import { describe, expect, it } from "vitest";

import {
  capabilitiesFor,
  mayInviteRole,
  mayRemoveMember
} from "@/modules/workspaces/server/policy";
import {
  createWorkspaceSchema,
  invitationSchema,
  updateWorkspaceSchema
} from "@/modules/workspaces/server/validation";

describe("workspace role policy", () => {
  it("uses the approved fixed role matrix", () => {
    expect(capabilitiesFor("OWNER", "TEAM")).toContain("workspace:delete");
    expect(capabilitiesFor("ADMIN", "TEAM")).toContain("workspace:update");
    expect(capabilitiesFor("ADMIN", "TEAM")).not.toContain("workspace:delete");
    expect(capabilitiesFor("MEMBER", "TEAM")).toEqual(["workspace:view", "member:list"]);
    expect(capabilitiesFor("OWNER", "PERSONAL")).toEqual(["workspace:view", "workspace:update"]);
  });

  it("prevents Admins from creating or managing Admin authority", () => {
    expect(mayInviteRole("OWNER", "ADMIN")).toBe(true);
    expect(mayInviteRole("ADMIN", "MEMBER")).toBe(true);
    expect(mayInviteRole("ADMIN", "ADMIN")).toBe(false);
    expect(mayInviteRole("MEMBER", "MEMBER")).toBe(false);
    expect(mayRemoveMember("admin", "ADMIN", "member", "MEMBER")).toBe(true);
    expect(mayRemoveMember("admin", "ADMIN", "other-admin", "ADMIN")).toBe(false);
    expect(mayRemoveMember("admin", "ADMIN", "owner", "OWNER")).toBe(false);
  });
});

describe("workspace request validation", () => {
  it("normalizes safe slugs and rejects unknown input", () => {
    expect(createWorkspaceSchema.parse({ name: " Signal Room ", slug: "signal-room" })).toEqual({
      name: "Signal Room",
      slug: "signal-room"
    });
    expect(createWorkspaceSchema.safeParse({ name: "Team", isOwner: true }).success).toBe(false);
    expect(updateWorkspaceSchema.safeParse({}).success).toBe(false);
    expect(updateWorkspaceSchema.safeParse({ slug: "Bad Slug" }).success).toBe(false);
  });

  it("never permits Owner invitations", () => {
    expect(
      invitationSchema.safeParse({ email: "member@example.test", role: "MEMBER" }).success
    ).toBe(true);
    expect(invitationSchema.safeParse({ email: "owner@example.test", role: "OWNER" }).success).toBe(
      false
    );
  });
});
