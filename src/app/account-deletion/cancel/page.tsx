import { PageShell } from "@/components/layout/page-shell";
import { DeletionCancellation } from "@/modules/settings/components/deletion-cancellation";

import styles from "./page.module.css";

export default async function CancelAccountDeletionPage({
  searchParams
}: {
  readonly searchParams: Promise<{ token?: string | string[] }>;
}) {
  const requested = await searchParams;
  const token = typeof requested.token === "string" ? requested.token : "";
  return (
    <PageShell>
      <section className={styles.panel}>
        <p>Account recovery</p>
        <h1>Keep your NEXUS AI account.</h1>
        <p>This single-use link restores normal account access only if deletion has not begun.</p>
        {token ? (
          <DeletionCancellation token={token} />
        ) : (
          <p>This cancellation link is incomplete.</p>
        )}
      </section>
    </PageShell>
  );
}
