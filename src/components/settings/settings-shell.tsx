import type { ReactNode } from "react";
import Link from "next/link";
import type { Route } from "next";

import { PageShell } from "@/components/layout/page-shell";
import { ButtonLink } from "@/components/ui/button";

import styles from "./settings-shell.module.css";

const sections = [
  { href: "/settings/profile", label: "Profile" },
  { href: "/settings/security", label: "Security" },
  { href: "/settings/ai", label: "AI preferences" },
  { href: "/settings/notifications", label: "Notifications" },
  { href: "/settings/account", label: "Account" }
] as const;

export function SettingsShell({
  active,
  eyebrow,
  title,
  description,
  children
}: {
  readonly active: (typeof sections)[number]["href"];
  readonly eyebrow: string;
  readonly title: string;
  readonly description: string;
  readonly children: ReactNode;
}) {
  return (
    <PageShell className={styles.page}>
      <header className={styles.hero}>
        <div>
          <p>{eyebrow}</p>
          <h1>{title}</h1>
          <span>{description}</span>
        </div>
        <ButtonLink href="/dashboard" variant="ghost" size="small">
          Back to dashboard
        </ButtonLink>
      </header>
      <nav className={styles.nav} aria-label="Settings sections">
        {sections.map((section) => (
          <Link
            key={section.href}
            href={section.href as Route}
            aria-current={active === section.href ? "page" : undefined}
          >
            {section.label}
          </Link>
        ))}
      </nav>
      <div className={styles.content}>{children}</div>
    </PageShell>
  );
}

export const settingsStyles = styles;
