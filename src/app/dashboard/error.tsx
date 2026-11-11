"use client";

import { useEffect } from "react";

import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { ErrorState } from "@/components/feedback/error-state";
import { Button } from "@/components/ui/button";

import styles from "./page.module.css";

export default function DashboardError({
  error,
  retry
}: {
  readonly error: Error & { digest?: string };
  readonly retry: () => void;
}) {
  useEffect(() => {
    console.error(`Dashboard data failed to load${error.digest ? ` (${error.digest})` : ""}.`);
  }, [error]);

  return (
    <DashboardShell
      workspaceName="Workspace unavailable"
      workspaceKind="Private"
      userName="NEXUS member"
      userRole="Member"
    >
      <div className={styles.dashboard}>
        <ErrorState
          title="The workspace pulse could not load"
          description="Your records were not changed. Retry the database read when you are ready."
          errorId={error.digest}
          action={<Button onClick={retry}>Retry dashboard</Button>}
        />
      </div>
    </DashboardShell>
  );
}
