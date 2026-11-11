import { randomUUID } from "node:crypto";

import Link from "next/link";
import type { Route } from "next";

import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/ui/data-table";
import { StatusPill } from "@/components/ui/status-pill";
import { AdminPageHeader } from "@/modules/administration/components/admin-shell";
import styles from "@/modules/administration/components/administration.module.css";
import { listAdminUsers } from "@/modules/administration/server/service";
import { adminUserListSchema } from "@/modules/administration/server/validation";
import { requireAdminPagePrincipal } from "@/modules/auth/server/session";

export default async function AdminUsersPage({
  searchParams
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const principal = await requireAdminPagePrincipal();
  const raw = await searchParams;
  const parsed = adminUserListSchema.safeParse({
    query: one(raw.query),
    status: one(raw.status),
    platformRole: one(raw.platformRole),
    limit: 30
  });
  const query = parsed.success ? parsed.data : { limit: 30 as const };
  const result = await listAdminUsers(principal.user.id, query, randomUUID());
  return (
    <main className={styles.page}>
      <AdminPageHeader
        eyebrow="Identity operations"
        title="People, posture, and platform access."
        description="Search safe account metadata, inspect enrollment, and make explicit, audited access changes."
      />
      <form className={styles.filters} method="get">
        <label>
          Search
          <input name="query" defaultValue={query.query} placeholder="Name or email" />
        </label>
        <label>
          Status
          <select name="status" defaultValue={query.status ?? ""}>
            <option value="">All</option>
            <option value="ACTIVE">Active</option>
            <option value="SUSPENDED">Suspended</option>
            <option value="PENDING_DELETION">Pending deletion</option>
          </select>
        </label>
        <label>
          Role
          <select name="platformRole" defaultValue={query.platformRole ?? ""}>
            <option value="">All</option>
            <option value="USER">User</option>
            <option value="ADMIN">Administrator</option>
          </select>
        </label>
        <Button type="submit" size="small">
          Filter users
        </Button>
      </form>
      <DataTable caption="Platform users">
        <thead>
          <tr>
            <th>User</th>
            <th>Status</th>
            <th>Role</th>
            <th>MFA</th>
            <th>Workspaces</th>
            <th>Joined</th>
          </tr>
        </thead>
        <tbody>
          {result.items.map((user) => (
            <tr key={user.id}>
              <td>
                <Link className={styles.tableLink} href={`/admin/users/${user.id}` as Route}>
                  {user.name}
                </Link>
                <div className={styles.muted}>{user.email}</div>
              </td>
              <td>
                <StatusPill tone={user.status === "ACTIVE" ? "success" : "warning"}>
                  {user.status}
                </StatusPill>
              </td>
              <td>{user.platformRole}</td>
              <td>{user.twoFactorEnabled ? "Enrolled" : "—"}</td>
              <td>{user.memberships}</td>
              <td>{new Date(user.createdAt).toLocaleDateString()}</td>
            </tr>
          ))}
        </tbody>
      </DataTable>
    </main>
  );
}

function one(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}
