"use client";

import { useEffect } from "react";
import Link from "next/link";

import { PageShell } from "@/components/layout/page-shell";

import styles from "./feedback.module.css";

interface ErrorBoundaryProps {
  readonly error: Error & { digest?: string };
  readonly retry: () => void;
}

export default function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  useEffect(() => {
    console.error(`A route error was contained${error.digest ? ` (${error.digest})` : ""}.`);
  }, [error]);

  return (
    <PageShell>
      <section className={styles.feedback} aria-labelledby="error-title">
        <p className={styles.code}>Unexpected error</p>
        <h1 id="error-title">This part of NEXUS AI could not load.</h1>
        <p>The failure was contained. Try the request again or return to the start.</p>
        <div className={styles.actions}>
          <button type="button" onClick={retry}>
            Try again
          </button>
          <Link href="/">Return home</Link>
        </div>
      </section>
    </PageShell>
  );
}
