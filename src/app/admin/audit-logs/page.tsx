import { randomUUID } from "node:crypto";

import { DataTable } from "@/components/ui/data-table";
import { AdminPageHeader } from "@/modules/administration/components/admin-shell";
import styles from "@/modules/administration/components/administration.module.css";
import { listAdminAuditLogs } from "@/modules/administration/server/service";
import { requireAdminPagePrincipal } from "@/modules/auth/server/session";

export default async function AdminAuditLogsPage() {
  const principal = await requireAdminPagePrincipal();
  const logs = await listAdminAuditLogs(principal.user.id, { limit: 60 }, randomUUID());
  return (
    <main className={styles.page}>
      <AdminPageHeader
        eyebrow="Security evidence"
        title="An accountable trail of platform change."
        description="Audit details are allowlisted and scrubbed before display. Credentials, prompts, content, signed URLs, and raw provider errors stay out."
      />
      <DataTable caption="Audit events">
        <thead>
          <tr>
            <th>Time</th>
            <th>Action</th>
            <th>Actor</th>
            <th>Outcome</th>
            <th>Target</th>
            <th>Request</th>
          </tr>
        </thead>
        <tbody>
          {logs.items.map((log) => (
            <tr key={log.id}>
              <td>{new Date(log.createdAt).toLocaleString()}</td>
              <td>{log.action}</td>
              <td>
                {log.actorKind}
                <div className={styles.code}>{log.actorUserId ?? "system"}</div>
              </td>
              <td>{log.outcome}</td>
              <td>
                {log.targetType}
                <div className={styles.code}>{log.targetId ?? "—"}</div>
              </td>
              <td className={styles.code}>{log.requestId}</td>
            </tr>
          ))}
        </tbody>
      </DataTable>
    </main>
  );
}
