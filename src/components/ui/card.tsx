import type { HTMLAttributes, ReactNode } from "react";

import { classNames } from "@/shared/utils/class-names";

import styles from "./card.module.css";

interface CardProps extends HTMLAttributes<HTMLElement> {
  readonly accent?: "blue" | "burgundy" | "none" | undefined;
  readonly interactive?: boolean | undefined;
}

export function Card({
  accent = "none",
  interactive = false,
  className,
  children,
  ...props
}: CardProps) {
  return (
    <article
      {...props}
      className={classNames(styles.card, interactive && styles.interactive, className)}
      data-accent={accent}
    >
      {children}
    </article>
  );
}

export function CardHeader({
  eyebrow,
  title,
  action
}: {
  readonly eyebrow?: string | undefined;
  readonly title: ReactNode;
  readonly action?: ReactNode;
}) {
  return (
    <header className={styles.header}>
      <div>
        {eyebrow ? <span className={styles.eyebrow}>{eyebrow}</span> : null}
        <h3>{title}</h3>
      </div>
      {action}
    </header>
  );
}

export function CardBody({
  children,
  className
}: {
  readonly children: ReactNode;
  readonly className?: string | undefined;
}) {
  return <div className={classNames(styles.body, className)}>{children}</div>;
}

export function CardFooter({ children }: { readonly children: ReactNode }) {
  return <footer className={styles.footer}>{children}</footer>;
}
