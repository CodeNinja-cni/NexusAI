import Link from "next/link";

import { Navigation } from "@/components/navigation/navigation";
import { BrandMark } from "@/components/ui/brand-mark";
import { ButtonLink } from "@/components/ui/button";

import { PageShell } from "./page-shell";
import styles from "./site-header.module.css";

export function SiteHeader() {
  const navigation = [
    { href: "/#product", label: "Product" },
    { href: "/#features", label: "Features" },
    { href: "/#process", label: "How it works" },
    { href: "/auth/login", label: "Sign in" }
  ] as const;

  return (
    <header className={styles.header} data-site-header>
      <PageShell className={styles.content}>
        <Link className={styles.homeLink} href="/">
          <BrandMark />
        </Link>
        <div className={styles.actions}>
          <Navigation items={navigation} />
          <ButtonLink href="/auth/register" size="small">
            Create account
          </ButtonLink>
        </div>
      </PageShell>
    </header>
  );
}
