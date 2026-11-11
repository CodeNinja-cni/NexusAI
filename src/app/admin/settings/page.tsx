import { randomUUID } from "node:crypto";

import { AdminPageHeader } from "@/modules/administration/components/admin-shell";
import styles from "@/modules/administration/components/administration.module.css";
import { PlatformSettingForms } from "@/modules/administration/components/platform-setting-forms";
import { listPlatformSettings } from "@/modules/administration/server/service";
import { requireAdminPagePrincipal } from "@/modules/auth/server/session";

export default async function AdminSettingsPage() {
  const principal = await requireAdminPagePrincipal();
  const settings = await listPlatformSettings(principal.user.id, randomUUID());
  return (
    <main className={styles.page}>
      <AdminPageHeader
        eyebrow="Platform policy"
        title="Configuration with guardrails."
        description="Only allowlisted, non-secret settings live here. Every change needs fresh MFA, optimistic concurrency, validation, and an audit reason."
      />
      <p className={styles.notice}>
        Secrets and provider credentials remain deployment-managed and cannot be read or written
        through this console.
      </p>
      <PlatformSettingForms settings={settings} />
    </main>
  );
}
