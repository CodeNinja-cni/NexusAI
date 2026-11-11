import type { ReactNode } from "react";

import { AdminShell } from "@/modules/administration/components/admin-shell";
import { requireAdminPagePrincipal } from "@/modules/auth/server/session";

export default async function AdminLayout({ children }: { readonly children: ReactNode }) {
  const principal = await requireAdminPagePrincipal();
  return <AdminShell userName={principal.user.name}>{children}</AdminShell>;
}
