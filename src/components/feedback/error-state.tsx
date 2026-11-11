import { useId, type ReactNode } from "react";
import { AlertTriangle } from "lucide-react";

import { Icon } from "@/components/ui/icon";

import styles from "./state-panel.module.css";

interface ErrorStateProps {
  readonly title: string;
  readonly description: string;
  readonly action?: ReactNode;
  readonly errorId?: string | undefined;
}

export function ErrorState({ title, description, action, errorId }: ErrorStateProps) {
  const titleId = useId();
  return (
    <section className={styles.state} data-tone="error" role="alert" aria-labelledby={titleId}>
      <span className={styles.errorIcon} aria-hidden="true">
        <Icon icon={AlertTriangle} size={22} />
      </span>
      <span className={styles.code}>ERR / RECOVERABLE</span>
      <h3 id={titleId}>{title}</h3>
      <p>{description}</p>
      {errorId ? <small>Reference {errorId}</small> : null}
      {action ? <div className={styles.action}>{action}</div> : null}
    </section>
  );
}
