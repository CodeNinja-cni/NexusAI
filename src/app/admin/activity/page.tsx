import { randomUUID } from "node:crypto";

import { DataTable } from "@/components/ui/data-table";
import { StatusPill } from "@/components/ui/status-pill";
import { AdminPageHeader } from "@/modules/administration/components/admin-shell";
import styles from "@/modules/administration/components/administration.module.css";
import { listAdminActivity } from "@/modules/administration/server/service";
import { requireAdminPagePrincipal } from "@/modules/auth/server/session";

export default async function AdminActivityPage() {
  const principal = await requireAdminPagePrincipal();
  const activity = await listAdminActivity(principal.user.id, { limit: 60 }, randomUUID());
  return (
    <main className={styles.page}>
      <AdminPageHeader
        eyebrow="Operational stream"
        title="System activity, without customer content."
        description="A unified operational view of audit events, outbox delivery, document processing, and controlled workflow execution."
      />
      <DataTable caption="System activity">
        <thead>
          <tr>
            <th>Time</th>
            <th>Source</th>
            <th>Event</th>
            <th>Status</th>
            <th>Target</th>
          </tr>
        </thead>
        <tbody>
          {activity.map((item) => (
            <tr key={`${item.source}:${item.id}`}>
              <td>{new Date(item.createdAt).toLocaleString()}</td>
              <td>{item.source}</td>
              <td>{item.event}</td>
              <td>
                <StatusPill
                  tone={
                    item.status === "SUCCEEDED" ||
                    item.status === "PUBLISHED" ||
                    item.status === "READY"
                      ? "success"
                      : item.status === "FAILED" || item.status === "TIMED_OUT"
                        ? "danger"
                        : "info"
                  }
                >
                  {item.status}
                </StatusPill>
              </td>
              <td className={styles.code}>
                {item.targetType}:{item.targetId}
              </td>
            </tr>
          ))}
        </tbody>
      </DataTable>
    </main>
  );
}
