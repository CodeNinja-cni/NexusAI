import type { WorkspaceKind, WorkspaceRole } from "@/generated/prisma/client";

export type WorkspaceCapability =
  | "workspace:view"
  | "workspace:update"
  | "workspace:delete"
  | "workspace:restore"
  | "member:list"
  | "member:invite"
  | "member:manage"
  | "workspace:transfer";

const roleCapabilities: Record<WorkspaceRole, readonly WorkspaceCapability[]> = {
  OWNER: [
    "workspace:view",
    "workspace:update",
    "workspace:delete",
    "workspace:restore",
    "member:list",
    "member:invite",
    "member:manage",
    "workspace:transfer"
  ],
  ADMIN: ["workspace:view", "workspace:update", "member:list", "member:invite", "member:manage"],
  MEMBER: ["workspace:view", "member:list"]
};

export function capabilitiesFor(role: WorkspaceRole, kind: WorkspaceKind) {
  const capabilities = roleCapabilities[role];
  if (kind === "TEAM") return capabilities;
  return capabilities.filter(
    (capability) => capability === "workspace:view" || capability === "workspace:update"
  );
}

export function hasWorkspaceCapability(
  role: WorkspaceRole,
  kind: WorkspaceKind,
  capability: WorkspaceCapability
) {
  return capabilitiesFor(role, kind).includes(capability);
}

export function mayInviteRole(actorRole: WorkspaceRole, invitedRole: WorkspaceRole) {
  if (actorRole === "OWNER") return invitedRole === "ADMIN" || invitedRole === "MEMBER";
  return actorRole === "ADMIN" && invitedRole === "MEMBER";
}

export function mayRemoveMember(
  actorUserId: string,
  actorRole: WorkspaceRole,
  targetUserId: string,
  targetRole: WorkspaceRole
) {
  if (targetRole === "OWNER") return false;
  if (actorUserId === targetUserId) return true;
  if (actorRole === "OWNER") return true;
  return actorRole === "ADMIN" && targetRole === "MEMBER";
}
