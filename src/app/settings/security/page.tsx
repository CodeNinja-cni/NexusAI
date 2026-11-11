import { SettingsShell, settingsStyles } from "@/components/settings/settings-shell";
import { Button } from "@/components/ui/button";
import { requirePagePrincipal } from "@/modules/auth/server/session";
import {
  revokeOtherSessionsAction,
  revokeSessionAction
} from "@/modules/auth/server/session-actions";
import { PasswordForm } from "@/modules/settings/components/password-form";
import { TwoFactorSettings } from "@/modules/auth/components/two-factor-settings";
import { prisma } from "@/platform/database/prisma";

export default async function SecuritySettingsPage() {
  const principal = await requirePagePrincipal();
  const sessions = await prisma.session.findMany({
    where: { userId: principal.user.id, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
    select: { id: true, createdAt: true, expiresAt: true, ipAddress: true, userAgent: true }
  });
  return (
    <SettingsShell
      active="/settings/security"
      eyebrow="Security"
      title="Credentials and sessions, under your control."
      description="Password changes require the current password and a fresh session. Session tokens are never rendered or returned by product APIs."
    >
      <div className={settingsStyles.grid}>
        <section className={settingsStyles.panel}>
          <h2>Multi-factor authentication</h2>
          <p>
            Protect sensitive access with an authenticator app and single-use recovery codes.
            Platform administrators are required to keep this enabled.
          </p>
          <TwoFactorSettings
            enabled={principal.user.twoFactorEnabled}
            administrator={principal.user.platformRole === "ADMIN"}
          />
        </section>
        <section className={settingsStyles.panel}>
          <h2>Password</h2>
          <p>Changing your password revokes every other active session by default.</p>
          <PasswordForm />
        </section>
        <section className={settingsStyles.panel}>
          <h2>Active sessions</h2>
          <p>Review browsers currently authorized for this account.</p>
          <form action={revokeOtherSessionsAction}>
            <Button type="submit" variant="secondary" size="small">
              Sign out other devices
            </Button>
          </form>
          <ul className={settingsStyles.sessions}>
            {sessions.map((session) => (
              <li key={session.id}>
                <div>
                  <strong>
                    {session.id === principal.session.id ? "Current session" : "Signed-in device"}
                  </strong>
                  <span>{session.userAgent ?? "Unknown browser"}</span>
                  <small>
                    Created {session.createdAt.toLocaleString()} · expires{" "}
                    {session.expiresAt.toLocaleString()}
                  </small>
                </div>
                <form action={revokeSessionAction}>
                  <input type="hidden" name="sessionId" value={session.id} />
                  <Button type="submit" variant="danger" size="small">
                    Revoke
                  </Button>
                </form>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </SettingsShell>
  );
}
