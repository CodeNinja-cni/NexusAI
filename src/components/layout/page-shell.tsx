import type { ComponentPropsWithoutRef } from "react";

import styles from "./page-shell.module.css";

type PageShellProps = ComponentPropsWithoutRef<"div">;

export function PageShell({ children, className, ...props }: PageShellProps) {
  const classes = className ? `${styles.shell} ${className}` : styles.shell;

  return (
    <div className={classes} {...props}>
      {children}
    </div>
  );
}
