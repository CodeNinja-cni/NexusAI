import { SettingsShell, settingsStyles } from "@/components/settings/settings-shell";
import { requirePagePrincipal } from "@/modules/auth/server/session";
import { AccountDeletionForm } from "@/modules/settings/components/account-deletion-form";
import { prisma } from "@/platform/database/prisma";

export default async function AccountSettingsPage() {
  const principal = await requirePagePrincipal();
  const ownedTeams = await prisma.workspace.findMany({
    where: { ownerUserId: principal.user.id, kind: "TEAM", status: "ACTIVE", deletedAt: null },
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true }
  });
  return (
    <SettingsShell
      active="/settings/account"
      eyebrow="Account lifecycle"
      title="Deletion is deliberate, recoverable, and complete."
      description="NEXUS schedules account deletion after a grace period. Shared workspaces must have a new owner or already be scheduled for deletion first."
    >
      <section className={settingsStyles.dangerPanel}>
        <h2>Delete account</h2>
        <p>
          This signs out every device immediately and schedules private account data for deletion
          after at least seven days. A single-use cancellation link is sent to your verified email.
        </p>
        {ownedTeams.length ? (
          <>
            <p>You must resolve ownership of these team workspaces first:</p>
            <ul className={settingsStyles.ownership}>
              {ownedTeams.map((workspace) => (
                <li key={workspace.id}>{workspace.name}</li>
              ))}
            </ul>
          </>
        ) : null}
        <AccountDeletionForm blocked={ownedTeams.length > 0} />
      </section>
    </SettingsShell>
  );
}
