"use client";

import type { ComponentProps, ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { classNames } from "@/shared/utils/class-names";

import styles from "./navigation.module.css";

export interface NavigationItem {
  readonly href: ComponentProps<typeof Link>["href"];
  readonly label: string;
  readonly icon?: ReactNode;
  readonly badge?: string | undefined;
  readonly disabled?: boolean | undefined;
}

interface NavigationProps {
  readonly items: readonly NavigationItem[];
  readonly label?: string | undefined;
  readonly className?: string | undefined;
}

export function Navigation({ items, label = "Primary navigation", className }: NavigationProps) {
  const pathname = usePathname();

  return (
    <nav className={classNames(styles.navigation, className)} aria-label={label}>
      {items.map((item) => {
        const href =
          typeof item.href === "string" ? item.href : (item.href.pathname?.toString() ?? "");
        const current =
          href === "/" ? pathname === "/" : href.startsWith("/") && pathname.startsWith(href);
        if (item.disabled) {
          return (
            <span key={`${item.label}:${href}`} aria-disabled="true">
              {item.icon ? <span aria-hidden="true">{item.icon}</span> : null}
              <span>{item.label}</span>
              {item.badge ? <small>{item.badge}</small> : null}
            </span>
          );
        }
        return (
          <Link
            key={`${item.label}:${href}`}
            href={item.href}
            aria-current={current ? "page" : undefined}
          >
            {item.icon ? <span aria-hidden="true">{item.icon}</span> : null}
            <span>{item.label}</span>
            {item.badge ? <small>{item.badge}</small> : null}
          </Link>
        );
      })}
    </nav>
  );
}
