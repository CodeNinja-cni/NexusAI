"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, PanelLeftClose, X } from "lucide-react";

import { BrandMark } from "@/components/ui/brand-mark";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { classNames } from "@/shared/utils/class-names";

import type { NavigationItem } from "./navigation";
import styles from "./sidebar.module.css";

interface ProductShellProps {
  readonly items: readonly NavigationItem[];
  readonly children: ReactNode;
  readonly accountSlot?: ReactNode;
  readonly accountName?: string | undefined;
  readonly accountMeta?: string | undefined;
  readonly accountInitials?: string | undefined;
  readonly contextLabel?: string | undefined;
  readonly contextName?: string | undefined;
  readonly preview?: boolean | undefined;
  readonly className?: string | undefined;
}

export function ProductShell({
  items,
  children,
  accountSlot,
  accountName = "Ada Lovelace",
  accountMeta = "Owner",
  accountInitials = "AL",
  contextLabel = "Personal workspace",
  contextName = "Signal room",
  preview = false,
  className
}: ProductShellProps) {
  const [open, setOpen] = useState(false);
  const sidebarId = useId();
  const pathname = usePathname();
  const mobileTriggerRef = useRef<HTMLButtonElement>(null);

  function closeNavigation(restoreFocus = true) {
    setOpen(false);
    if (restoreFocus) window.requestAnimationFrame(() => mobileTriggerRef.current?.focus());
  }

  useEffect(() => {
    if (!open) return;
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        closeNavigation();
      }
    }
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [open]);

  return (
    <div className={classNames(styles.shell, className)} data-preview={preview || undefined}>
      <div className={styles.mobileBar}>
        <BrandMark />
        <Button
          ref={mobileTriggerRef}
          variant="ghost"
          size="small"
          aria-expanded={open}
          aria-controls={sidebarId}
          aria-label="Open workspace navigation"
          onClick={() => setOpen(true)}
        >
          <Icon icon={Menu} />
        </Button>
      </div>
      {open ? (
        <button
          className={styles.scrim}
          aria-label="Close navigation"
          onClick={() => closeNavigation()}
        />
      ) : null}
      <aside
        className={styles.sidebar}
        id={sidebarId}
        data-open={open || undefined}
        aria-label="Workspace sidebar"
      >
        <div className={styles.brandRow}>
          <BrandMark />
          <Button
            variant="ghost"
            size="small"
            aria-label="Close workspace navigation"
            onClick={() => closeNavigation()}
          >
            <Icon icon={X} />
          </Button>
        </div>
        <div className={styles.context}>
          <span>{contextLabel}</span>
          <strong>{contextName}</strong>
        </div>
        <nav className={styles.nav} aria-label="Workspace navigation">
          {items.map((item) => {
            const href =
              typeof item.href === "string" ? item.href : (item.href.pathname?.toString() ?? "");
            const current = pathname === href || pathname.startsWith(`${href}/`);
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
                href={item.href}
                key={`${item.label}:${href}`}
                aria-current={current ? "page" : undefined}
                onClick={() => closeNavigation(false)}
              >
                {item.icon ? <span aria-hidden="true">{item.icon}</span> : null}
                <span>{item.label}</span>
                {item.badge ? <small>{item.badge}</small> : null}
              </Link>
            );
          })}
        </nav>
        <div className={styles.sidebarFooter}>
          {accountSlot ?? (
            <div>
              <span className={styles.avatar} aria-hidden="true">
                {accountInitials}
              </span>
              <span>
                <strong>{accountName}</strong>
                <small>{accountMeta}</small>
              </span>
            </div>
          )}
          <Icon icon={PanelLeftClose} />
        </div>
      </aside>
      <div className={styles.content}>{children}</div>
    </div>
  );
}
