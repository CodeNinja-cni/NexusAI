import type { ReactNode } from "react";

import { PageShell } from "@/components/layout/page-shell";

import styles from "./auth-card.module.css";

interface AuthCardProps {
  readonly eyebrow: string;
  readonly title: string;
  readonly description: string;
  readonly children: ReactNode;
}

export function AuthCard({ eyebrow, title, description, children }: AuthCardProps) {
  return (
    <PageShell className={styles.page}>
      <section className={styles.card} aria-labelledby="auth-title">
        <p className={styles.eyebrow}>{eyebrow}</p>
        <h1 id="auth-title">{title}</h1>
        <p className={styles.description}>{description}</p>
        {children}
      </section>
    </PageShell>
  );
}
