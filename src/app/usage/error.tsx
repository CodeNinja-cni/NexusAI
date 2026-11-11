"use client";

import { useEffect } from "react";

import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { ErrorState } from "@/components/feedback/error-state";
import { Button } from "@/components/ui/button";

import styles from "./usage.module.css";

export default function UsageError({
  error,
  retry
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    console.error(`Usage analytics failed to load${error.digest ? ` (${error.digest})` : ""}.`);
  }, [error]);
  return (
    <DashboardShell
      workspaceName="Workspace unavailable"
      workspaceKind="Private"
      userName="NEXUS member"
      userRole="Member"
    >
      <div className={styles.page}>
        <ErrorState
          title="Usage intelligence could not load"
          description="No usage or quota records were changed. Retry the read when you are ready."
          errorId={error.digest}
          action={<Button onClick={retry}>Retry usage</Button>}
        />
      </div>
    </DashboardShell>
  );
}
