"use client";

import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode
} from "react";
import { Check, ChevronDown } from "lucide-react";

import { Button, type ButtonVariant } from "./button";
import { Icon } from "./icon";
import styles from "./dropdown-menu.module.css";

export interface DropdownItem {
  readonly id: string;
  readonly label: string;
  readonly description?: string | undefined;
  readonly icon?: ReactNode;
  readonly disabled?: boolean | undefined;
  readonly selected?: boolean | undefined;
  readonly onSelect: () => void;
}

interface DropdownMenuProps {
  readonly label: string;
  readonly items: readonly DropdownItem[];
  readonly variant?: ButtonVariant | undefined;
  readonly align?: "start" | "end" | undefined;
}

export function DropdownMenu({
  label,
  items,
  variant = "secondary",
  align = "start"
}: DropdownMenuProps) {
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const pendingFocus = useRef<"first" | "last">("first");

  function focusItem(direction: "first" | "last") {
    const buttons = rootRef.current?.querySelectorAll<HTMLButtonElement>(
      '[role="menuitem"]:not(:disabled)'
    );
    const target = direction === "first" ? buttons?.[0] : buttons?.[buttons.length - 1];
    target?.focus();
  }

  useLayoutEffect(() => {
    if (!open) return;
    focusItem(pendingFocus.current);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function closeFromOutside(event: PointerEvent) {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) setOpen(false);
    }
    document.addEventListener("pointerdown", closeFromOutside);
    return () => document.removeEventListener("pointerdown", closeFromOutside);
  }, [open]);

  function triggerKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      pendingFocus.current = event.key === "ArrowDown" ? "first" : "last";
      setOpen(true);
    }
  }

  function menuKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const enabledItems = [
      ...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')
    ];
    if (enabledItems.length === 0) return;
    const currentIndex = enabledItems.findIndex((item) => item === document.activeElement);

    if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
    } else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      let nextIndex = currentIndex;
      if (event.key === "Home") nextIndex = 0;
      if (event.key === "End") nextIndex = enabledItems.length - 1;
      if (event.key === "ArrowDown") nextIndex = (currentIndex + 1) % enabledItems.length;
      if (event.key === "ArrowUp")
        nextIndex = (currentIndex - 1 + enabledItems.length) % enabledItems.length;
      enabledItems[nextIndex]?.focus();
    }
  }

  return (
    <div className={styles.root} ref={rootRef}>
      <Button
        ref={triggerRef}
        variant={variant}
        aria-haspopup="menu"
        aria-controls={menuId}
        aria-expanded={open}
        trailingIcon={<Icon icon={ChevronDown} />}
        onClick={() => {
          if (!open) pendingFocus.current = "first";
          setOpen((current) => !current);
        }}
        onKeyDown={triggerKeyDown}
      >
        {label}
      </Button>
      {open ? (
        <div
          className={styles.menu}
          id={menuId}
          role="menu"
          data-align={align}
          aria-label={label}
          onKeyDown={menuKeyDown}
        >
          {items.map((item) => (
            <button
              className={styles.item}
              type="button"
              role="menuitem"
              key={item.id}
              disabled={item.disabled}
              onClick={() => {
                item.onSelect();
                setOpen(false);
                triggerRef.current?.focus();
              }}
            >
              {item.icon ? <span className={styles.itemIcon}>{item.icon}</span> : null}
              <span>
                <strong>{item.label}</strong>
                {item.description ? <small>{item.description}</small> : null}
              </span>
              {item.selected ? <Icon icon={Check} /> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
