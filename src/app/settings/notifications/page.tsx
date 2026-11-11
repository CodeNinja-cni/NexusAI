import { SettingsShell, settingsStyles } from "@/components/settings/settings-shell";
import { requirePagePrincipal } from "@/modules/auth/server/session";
import { NotificationPreferencesForm } from "@/modules/settings/components/preferences-form";
import { getUserPreference } from "@/modules/settings/server/preferences";

export default async function NotificationSettingsPage() {
  const principal = await requirePagePrincipal();
  const preference = await getUserPreference(principal.user.id);
  return (
    <SettingsShell
      active="/settings/notifications"
      eyebrow="Signal controls"
      title="Choose what deserves your attention."
      description="Product notifications persist to your private account history. Security alerts remain mandatory."
    >
      <section className={settingsStyles.panel}>
        <h2>Notification preferences</h2>
        <p>
          Turn optional product categories on or off. Existing notification history is not
          rewritten.
        </p>
        <NotificationPreferencesForm preference={preference} />
      </section>
    </SettingsShell>
  );
}
