import type { ReactNode, TableHTMLAttributes } from "react";

import { classNames } from "@/shared/utils/class-names";

import styles from "./data-table.module.css";

interface DataTableProps extends TableHTMLAttributes<HTMLTableElement> {
  readonly caption: string;
  readonly children: ReactNode;
}

export function DataTable({ caption, children, className, ...props }: DataTableProps) {
  return (
    <div
      className={styles.frame}
      tabIndex={0}
      role="region"
      aria-label={`${caption}, scrollable table`}
    >
      <table {...props} className={classNames(styles.table, className)}>
        <caption>{caption}</caption>
        {children}
      </table>
    </div>
  );
}
