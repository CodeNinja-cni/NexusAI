import Link from "next/link";

import { PageShell } from "@/components/layout/page-shell";

import styles from "./feedback.module.css";

export default function NotFound() {
  return (
    <PageShell>
      <section className={styles.feedback} aria-labelledby="not-found-title">
        <p className={styles.code}>404 · Not found</p>
        <h1 id="not-found-title">There is nothing at this address.</h1>
        <p>The route may have moved, or it may belong to a product phase not implemented yet.</p>
        <div className={styles.actions}>
          <Link href="/">Return home</Link>
        </div>
      </section>
    </PageShell>
  );
}
