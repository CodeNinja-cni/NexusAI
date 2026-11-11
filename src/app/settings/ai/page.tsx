import { SettingsShell, settingsStyles } from "@/components/settings/settings-shell";
import { requirePagePrincipal } from "@/modules/auth/server/session";
import { listEnabledChatModels } from "@/modules/chat/server/model-catalog";
import { AiPreferencesForm } from "@/modules/settings/components/preferences-form";
import { getUserPreference } from "@/modules/settings/server/preferences";

export default async function AiSettingsPage() {
  const principal = await requirePagePrincipal();
  const preference = await getUserPreference(principal.user.id);
  return (
    <SettingsShell
      active="/settings/ai"
      eyebrow="AI behavior"
      title="Set defaults without surrendering control."
      description="Preferences shape supported NEXUS experiences. API keys, hidden prompts, and provider credentials are never accepted here."
    >
      <section className={settingsStyles.panel}>
        <h2>AI preferences</h2>
        <p>The model list is restricted to providers enabled by this deployment.</p>
        <AiPreferencesForm preference={preference} models={listEnabledChatModels()} />
      </section>
    </SettingsShell>
  );
}
