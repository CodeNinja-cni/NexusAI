"use client";

import type { ReactNode } from "react";
import type { Route } from "next";
import {
  ChartNoAxesCombined,
  Bell,
  BookOpen,
  FileText,
  LayoutDashboard,
  MessageSquare,
  Settings,
  UsersRound,
  Workflow
} from "lucide-react";

import { ProductShell } from "@/components/navigation/sidebar";
import { Icon } from "@/components/ui/icon";

import styles from "./dashboard-shell.module.css";

const dashboardNavigation = [
  { href: "/dashboard", label: "Overview", icon: <Icon icon={LayoutDashboard} /> },
  { href: "/workspace", label: "Workspaces", icon: <Icon icon={UsersRound} /> },
  {
    href: "/chat" as Route,
    label: "Conversations",
    icon: <Icon icon={MessageSquare} />
  },
  {
    href: "/documents" as Route,
    label: "Documents",
    icon: <Icon icon={FileText} />
  },
  {
    href: "/usage" as Route,
    label: "Usage",
    icon: <Icon icon={ChartNoAxesCombined} />
  },
  {
    href: "/notifications" as Route,
    label: "Notifications",
    icon: <Icon icon={Bell} />
  },
  {
    href: "/dashboard",
    label: "Knowledge",
    icon: <Icon icon={BookOpen} />,
    badge: "Soon",
    disabled: true
  },
  {
    href: "/workflows" as Route,
    label: "Workflows",
    icon: <Icon icon={Workflow} />
  },
  { href: "/settings/profile", label: "Settings", icon: <Icon icon={Settings} /> }
] as const;

interface DashboardShellProps {
  readonly children: ReactNode;
  readonly workspaceName: string;
  readonly workspaceKind: string;
  readonly userName: string;
  readonly userRole: string;
}

export function DashboardShell({
  children,
  workspaceName,
  workspaceKind,
  userName,
  userRole
}: DashboardShellProps) {
  const initials = userName
    .split(/\s+/u)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");

  return (
    <div data-dashboard-shell>
      <ProductShell
        className={styles.shell}
        items={dashboardNavigation}
        contextLabel={`${workspaceKind} workspace`}
        contextName={workspaceName}
        accountName={userName}
        accountMeta={userRole}
        accountInitials={initials || "NX"}
      >
        {children}
      </ProductShell>
    </div>
  );
}
