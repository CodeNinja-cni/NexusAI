import Link from "next/link";

import { BrandMark } from "@/components/ui/brand-mark";

import { PageShell } from "./page-shell";
import styles from "./site-footer.module.css";

export function SiteFooter() {
  return (
    <footer className={styles.footer} data-site-footer>
      <PageShell className={styles.content}>
        <div className={styles.brandColumn}>
          <BrandMark />
          <p>One workspace for context, evidence, and deliberate intelligence.</p>
        </div>
        <nav className={styles.links} aria-label="Footer navigation">
          <div>
            <strong>Explore</strong>
            <Link href="/#product">Product</Link>
            <Link href="/#features">Features</Link>
            <Link href="/#process">How it works</Link>
          </div>
          <div>
            <strong>Access</strong>
            <Link href="/auth/register">Create account</Link>
            <Link href="/auth/login">Sign in</Link>
            <Link href="/design-system">Interface system</Link>
          </div>
        </nav>
        <div className={styles.legal}>
          <span>Built by Code Ninja.</span>
          <span>Foundation release · 2026</span>
        </div>
      </PageShell>
    </footer>
  );
}
