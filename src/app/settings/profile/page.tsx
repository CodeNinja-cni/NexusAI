import { SettingsShell, settingsStyles } from "@/components/settings/settings-shell";
import { ProfileForm } from "@/modules/auth/components/profile-form";
import { requirePagePrincipal } from "@/modules/auth/server/session";

export default async function ProfileSettingsPage() {
  const principal = await requirePagePrincipal();
  return (
    <SettingsShell
      active="/settings/profile"
      eyebrow="Identity"
      title="Make the account unmistakably yours."
      description="Profile fields persist to your account and remain separate from workspace roles or provider credentials."
    >
      <section className={settingsStyles.panel} aria-labelledby="profile-title">
        <h2 id="profile-title">Profile</h2>
        <p>
          Your email is verified identity data. Display name and image are the editable public
          profile fields.
        </p>
        <ProfileForm
          name={principal.user.name}
          image={principal.user.image}
          initialEtag={`"user:${principal.user.id}:${principal.user.version}"`}
        />
      </section>
    </SettingsShell>
  );
}
