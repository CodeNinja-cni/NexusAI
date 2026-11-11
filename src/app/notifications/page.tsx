import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { requireReadyPagePrincipal } from "@/modules/auth/server/session";
import { NotificationFeed } from "@/modules/notifications/components/notification-feed";
import { getNotificationPage } from "@/modules/notifications/server/service";
import {
  notificationTypeSchema,
  type NotificationType
} from "@/modules/notifications/server/validation";
import { getActiveWorkspaceId, getWorkspace } from "@/modules/workspaces/server/workspace-service";

export const metadata: Metadata = {
  title: "Notifications",
  description: "Workspace activity, document status, workflows, and security alerts."
};

export default async function NotificationsPage({
  searchParams
}: {
  readonly searchParams: Promise<{ type?: string | string[]; unread?: string | string[] }>;
}) {
  const principal = await requireReadyPagePrincipal();
  const workspaceId = await getActiveWorkspaceId(
    principal.user.id,
    principal.provisioning?.personalWorkspaceId ?? null
  );
  if (!workspaceId) redirect("/auth/provisioning");
  const requested = await searchParams;
  const typeResult = notificationTypeSchema.safeParse(requested.type);
  const type: NotificationType | undefined = typeResult.success ? typeResult.data : undefined;
  const unreadOnly = requested.unread === "true";
  const [workspace, page] = await Promise.all([
    getWorkspace(principal.user.id, workspaceId),
    getNotificationPage(principal.user.id, {
      ...(type ? { type } : {}),
      ...(unreadOnly ? { unread: true } : {})
    })
  ]);
  return (
    <DashboardShell
      workspaceName={workspace.name}
      workspaceKind={titleCase(workspace.kind)}
      userName={principal.user.name}
      userRole={titleCase(workspace.role)}
    >
      <NotificationFeed
        key={`${type ?? "ALL"}:${unreadOnly}`}
        initialItems={page.items}
        initialUnreadCount={page.unreadCount}
        {...(type ? { activeType: type } : {})}
        unreadOnly={unreadOnly}
      />
    </DashboardShell>
  );
}

function titleCase(value: string) {
  return value.slice(0, 1) + value.slice(1).toLowerCase();
}
