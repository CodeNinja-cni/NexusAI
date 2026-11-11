"use client";

import type { ReactNode } from "react";
import type { Route } from "next";
import {
  Activity,
  ChartNoAxesCombined,
  FileClock,
  Gauge,
  Settings,
  ShieldCheck,
  UsersRound
} from "lucide-react";

import { ProductShell } from "@/components/navigation/sidebar";
import { Icon } from "@/components/ui/icon";

import styles from "./administration.module.css";

const navigation = [
  { href: "/admin/dashboard" as Route, label: "Command center", icon: <Icon icon={Gauge} /> },
  { href: "/admin/users" as Route, label: "Users", icon: <Icon icon={UsersRound} /> },
  { href: "/admin/usage" as Route, label: "Usage", icon: <Icon icon={ChartNoAxesCombined} /> },
  { href: "/admin/activity" as Route, label: "System activity", icon: <Icon icon={Activity} /> },
  { href: "/admin/audit-logs" as Route, label: "Audit logs", icon: <Icon icon={FileClock} /> },
  { href: "/admin/settings" as Route, label: "Configuration", icon: <Icon icon={Settings} /> },
  { href: "/dashboard" as Route, label: "Return to product", icon: <Icon icon={ShieldCheck} /> }
] as const;

export function AdminShell({
  children,
  userName
}: {
  readonly children: ReactNode;
  readonly userName: string;
}) {
  const initials = userName
    .split(/\s+/u)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
  return (
    <div data-dashboard-shell data-admin-shell>
      <ProductShell
        className={styles.shell}
        items={navigation}
        contextLabel="Protected operations"
        contextName="NEXUS Control Plane"
        accountName={userName}
        accountMeta="Platform administrator"
        accountInitials={initials || "NX"}
      >
        {children}
      </ProductShell>
    </div>
  );
}

export function AdminPageHeader({
  eyebrow,
  title,
  description,
  action
}: {
  readonly eyebrow: string;
  readonly title: string;
  readonly description: string;
  readonly action?: ReactNode;
}) {
  return (
    <header className={styles.pageHeader}>
      <div>
        <span>{eyebrow}</span>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {action}
    </header>
  );
}
