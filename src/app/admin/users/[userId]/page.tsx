import { randomUUID } from "node:crypto";

import { DataTable } from "@/components/ui/data-table";
import { StatusPill } from "@/components/ui/status-pill";
import { AdminPageHeader } from "@/modules/administration/components/admin-shell";
import styles from "@/modules/administration/components/administration.module.css";
import { UserControls } from "@/modules/administration/components/user-controls";
import { getAdminUser } from "@/modules/administration/server/service";
import { requireAdminPagePrincipal } from "@/modules/auth/server/session";

export default async function AdminUserPage({
  params
}: {
  readonly params: Promise<{ userId: string }>;
}) {
  const principal = await requireAdminPagePrincipal();
  const user = await getAdminUser(principal.user.id, (await params).userId, randomUUID());
  return (
    <main className={styles.page}>
      <AdminPageHeader
        eyebrow="User record"
        title={user.name}
        description="Minimum operational account metadata. Passwords, session tokens, customer content, and private storage references are never exposed."
      />
      <section className={styles.split}>
        <article className={styles.panel}>
          <h2>Account posture</h2>
          <dl className={styles.definition}>
            <div>
              <dt>Email</dt>
              <dd>{user.email}</dd>
            </div>
            <div>
              <dt>Verified</dt>
              <dd>{user.emailVerified ? "Yes" : "No"}</dd>
            </div>
            <div>
              <dt>Status</dt>
              <dd>
                <StatusPill tone={user.status === "ACTIVE" ? "success" : "warning"}>
                  {user.status}
                </StatusPill>
              </dd>
            </div>
            <div>
              <dt>Platform role</dt>
              <dd>{user.platformRole}</dd>
            </div>
            <div>
              <dt>MFA</dt>
              <dd>{user.twoFactorEnabled ? "Enrolled" : "Not enrolled"}</dd>
            </div>
            <div>
              <dt>Provisioning</dt>
              <dd>{user.provisioning?.status ?? "Not started"}</dd>
            </div>
            <div>
              <dt>Created</dt>
              <dd>{new Date(user.createdAt).toLocaleString()}</dd>
            </div>
            <div>
              <dt>Version</dt>
              <dd>{user.version}</dd>
            </div>
          </dl>
        </article>
        <article className={styles.panel}>
          <h2>Actual usage</h2>
          <dl className={styles.definition}>
            <div>
              <dt>Requests</dt>
              <dd>{user.usage.requests}</dd>
            </div>
            <div>
              <dt>Input tokens</dt>
              <dd>{Number(user.usage.inputTokens).toLocaleString()}</dd>
            </div>
            <div>
              <dt>Output tokens</dt>
              <dd>{Number(user.usage.outputTokens).toLocaleString()}</dd>
            </div>
            <div>
              <dt>Estimated cost</dt>
              <dd>
                {new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
                  Number(user.usage.estimatedCostMicros) / 1_000_000
                )}
              </dd>
            </div>
          </dl>
        </article>
      </section>
      <article className={styles.panel}>
        <h2>Administrative controls</h2>
        <UserControls
          userId={user.id}
          role={user.platformRole}
          status={user.status}
          version={user.version}
          self={user.id === principal.user.id}
        />
      </article>
      <DataTable caption="Active account sessions">
        <thead>
          <tr>
            <th>Session</th>
            <th>Created</th>
            <th>Expires</th>
            <th>MFA assurance</th>
            <th>Browser</th>
          </tr>
        </thead>
        <tbody>
          {user.sessions.map((session) => (
            <tr key={session.id}>
              <td className={styles.code}>{session.id}</td>
              <td>{new Date(session.createdAt).toLocaleString()}</td>
              <td>{new Date(session.expiresAt).toLocaleString()}</td>
              <td>
                {session.mfaVerifiedAt ? new Date(session.mfaVerifiedAt).toLocaleString() : "None"}
              </td>
              <td>{session.userAgent ?? "Unknown"}</td>
            </tr>
          ))}
        </tbody>
      </DataTable>
    </main>
  );
}
