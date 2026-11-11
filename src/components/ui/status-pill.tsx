import type { ReactNode } from "react";

import styles from "./status-pill.module.css";

interface StatusPillProps {
  readonly children: ReactNode;
  readonly tone?: "neutral" | "info" | "success" | "warning" | "danger" | undefined;
}

export function StatusPill({ children, tone = "success" }: StatusPillProps) {
  return (
    <span className={styles.pill} data-tone={tone}>
      <span className={styles.indicator} aria-hidden="true" />
      {children}
    </span>
  );
}
