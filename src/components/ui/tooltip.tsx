"use client";

import { cloneElement, useId, useState, type KeyboardEvent, type ReactElement } from "react";

import styles from "./tooltip.module.css";

interface TooltipProps {
  readonly content: string;
  readonly children: ReactElement<{ "aria-describedby"?: string | undefined }>;
  readonly placement?: "top" | "bottom" | undefined;
}

export function Tooltip({ content, children, placement = "top" }: TooltipProps) {
  const [open, setOpen] = useState(false);
  const tooltipId = useId();

  function handleKeyDown(event: KeyboardEvent<HTMLSpanElement>) {
    if (event.key === "Escape") setOpen(false);
  }

  return (
    <span
      className={styles.root}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
      onKeyDown={handleKeyDown}
    >
      {cloneElement(children, {
        "aria-describedby": open
          ? [children.props["aria-describedby"], tooltipId].filter(Boolean).join(" ")
          : children.props["aria-describedby"]
      })}
      {open ? (
        <span className={styles.tooltip} id={tooltipId} role="tooltip" data-placement={placement}>
          {content}
        </span>
      ) : null}
    </span>
  );
}
