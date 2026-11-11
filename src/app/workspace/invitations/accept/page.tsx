import type { Metadata } from "next";

import { AcceptInvitation } from "@/modules/workspaces/components/accept-invitation";

export const metadata: Metadata = {
  title: "Workspace invitation",
  robots: { index: false, follow: false }
};

export default function AcceptInvitationPage() {
  return <AcceptInvitation />;
}
