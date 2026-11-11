import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { Skeleton, SkeletonCard } from "@/components/feedback/skeleton";

import styles from "./usage.module.css";

export default function UsageLoading() {
  return (
    <DashboardShell
      workspaceName="Loading workspace"
      workspaceKind="Private"
      userName="NEXUS member"
      userRole="Loading"
    >
      <div className={`${styles.page} ${styles.loading}`} aria-busy="true">
        <Skeleton width="min(100%, 46rem)" height="6rem" />
        <div className={styles.metrics}>
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </div>
        <SkeletonCard />
        <SkeletonCard />
      </div>
    </DashboardShell>
  );
}
