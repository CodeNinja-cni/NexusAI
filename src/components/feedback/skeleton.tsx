import type { CSSProperties, HTMLAttributes } from "react";

import { classNames } from "@/shared/utils/class-names";

import styles from "./skeleton.module.css";

interface SkeletonProps extends HTMLAttributes<HTMLSpanElement> {
  readonly width?: CSSProperties["width"];
  readonly height?: CSSProperties["height"];
  readonly radius?: CSSProperties["borderRadius"];
}

export function Skeleton({
  width = "100%",
  height = "1rem",
  radius,
  className,
  style,
  ...props
}: SkeletonProps) {
  return (
    <span
      {...props}
      className={classNames(styles.skeleton, className)}
      style={{ ...style, width, height, borderRadius: radius }}
      aria-hidden="true"
    />
  );
}

export function SkeletonCard() {
  return (
    <div className={styles.card} aria-hidden="true">
      <Skeleton width="34%" height="0.7rem" />
      <Skeleton width="72%" height="1.5rem" />
      <div className={styles.lines}>
        <Skeleton />
        <Skeleton width="88%" />
        <Skeleton width="62%" />
      </div>
    </div>
  );
}
