import { PageShell } from "@/components/layout/page-shell";
import { Skeleton } from "@/components/feedback/skeleton";

import styles from "./loading.module.css";

export default function Loading() {
  return (
    <PageShell>
      <div className={styles.loading} aria-busy="true" aria-label="Loading page">
        <Skeleton width="8rem" height="1rem" />
        <Skeleton width="min(100%, 48rem)" height="clamp(3rem, 9vw, 6rem)" />
        <Skeleton width="min(68%, 34rem)" height="clamp(3rem, 9vw, 6rem)" />
        <Skeleton width="min(100%, 38rem)" height="1rem" />
        <Skeleton width="min(42%, 20rem)" height="1rem" />
      </div>
    </PageShell>
  );
}
