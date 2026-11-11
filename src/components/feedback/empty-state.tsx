import { useId, type ReactNode } from "react";
import { Inbox } from "lucide-react";

import { Icon } from "@/components/ui/icon";

import styles from "./state-panel.module.css";

interface EmptyStateProps {
  readonly title: string;
  readonly description: string;
  readonly action?: ReactNode;
  readonly icon?: ReactNode;
}

export function EmptyState({ title, description, action, icon }: EmptyStateProps) {
  const titleId = useId();
  return (
    <section className={styles.state} aria-labelledby={titleId}>
      <span className={styles.emptyIcon} aria-hidden="true">
        {icon ?? <Icon icon={Inbox} size={22} />}
      </span>
      <span className={styles.code}>000 / EMPTY</span>
      <h3 id={titleId}>{title}</h3>
      <p>{description}</p>
      {action ? <div className={styles.action}>{action}</div> : null}
    </section>
  );
}
