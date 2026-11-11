import type { Metadata } from "next";

import { PageShell } from "@/components/layout/page-shell";
import { DesignSystemShowcase } from "@/components/system/design-system-showcase";

import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "Design system",
  description: "The NEXUS AI interface protocol, component states, and interaction patterns."
};

export default function DesignSystemPage() {
  return (
    <PageShell className={styles.page}>
      <DesignSystemShowcase />
    </PageShell>
  );
}
