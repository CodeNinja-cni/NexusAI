"use client";

import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

import styles from "./tabs.module.css";

export interface TabItem {
  readonly id: string;
  readonly label: string;
  readonly content: ReactNode;
}

export function Tabs({
  items,
  label
}: {
  readonly items: readonly TabItem[];
  readonly label: string;
}) {
  const [activeId, setActiveId] = useState(items[0]?.id ?? "");
  const tabSetId = useId();
  const listRef = useRef<HTMLDivElement>(null);

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const tabs = [...(listRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]') ?? [])];
    const currentIndex = tabs.findIndex((tab) => tab === document.activeElement);
    let nextIndex = currentIndex;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = tabs.length - 1;
    if (event.key === "ArrowRight") nextIndex = (currentIndex + 1) % tabs.length;
    if (event.key === "ArrowLeft") nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
    tabs[nextIndex]?.focus();
    tabs[nextIndex]?.click();
  }

  const activeItem = items.find((item) => item.id === activeId) ?? items[0];
  if (!activeItem) return null;

  return (
    <div className={styles.tabs}>
      <div
        className={styles.list}
        role="tablist"
        aria-label={label}
        ref={listRef}
        onKeyDown={handleKeyDown}
      >
        {items.map((item) => {
          const selected = item.id === activeItem.id;
          return (
            <button
              type="button"
              role="tab"
              key={item.id}
              id={`${tabSetId}-${item.id}-tab`}
              aria-selected={selected}
              aria-controls={`${tabSetId}-${item.id}-panel`}
              tabIndex={selected ? 0 : -1}
              onClick={() => setActiveId(item.id)}
            >
              {item.label}
            </button>
          );
        })}
      </div>
      <div
        className={styles.panel}
        role="tabpanel"
        id={`${tabSetId}-${activeItem.id}-panel`}
        aria-labelledby={`${tabSetId}-${activeItem.id}-tab`}
        tabIndex={0}
      >
        {activeItem.content}
      </div>
    </div>
  );
}
