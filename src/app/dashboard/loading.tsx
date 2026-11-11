import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { Skeleton, SkeletonCard } from "@/components/feedback/skeleton";

import styles from "./page.module.css";

export default function DashboardLoading() {
  return (
    <DashboardShell
      workspaceName="Loading workspace"
      workspaceKind="Private"
      userName="NEXUS member"
      userRole="Loading"
    >
      <div className={styles.dashboard} aria-busy="true" aria-live="polite">
        <span className="visually-hidden">Loading persisted workspace dashboard records</span>
        <div className={styles.loadingHeading}>
          <Skeleton width="9rem" height="0.75rem" />
          <Skeleton width="min(100%, 34rem)" height="4rem" />
          <Skeleton width="min(100%, 42rem)" height="1rem" />
        </div>
        <div className={styles.loadingGrid}>
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </div>
        <div className={styles.loadingGrid}>
          <SkeletonCard />
          <SkeletonCard />
        </div>
      </div>
    </DashboardShell>
  );
}
