import { PageShell } from "@/components/layout/page-shell";

export default function ProfileSettingsLoading() {
  return (
    <PageShell aria-busy="true" aria-live="polite">
      <p>Loading protected account settings…</p>
    </PageShell>
  );
}
