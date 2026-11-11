import { forwardRef, type ButtonHTMLAttributes, type ComponentProps, type ReactNode } from "react";
import Link from "next/link";
import { LoaderCircle } from "lucide-react";

import { classNames } from "@/shared/utils/class-names";

import { Icon } from "./icon";
import styles from "./button.module.css";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "small" | "medium" | "large";

interface ButtonVisualProps {
  readonly variant?: ButtonVariant | undefined;
  readonly size?: ButtonSize | undefined;
  readonly fullWidth?: boolean | undefined;
  readonly leadingIcon?: ReactNode;
  readonly trailingIcon?: ReactNode;
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>, ButtonVisualProps {
  readonly loading?: boolean | undefined;
  readonly loadingLabel?: string | undefined;
}

function buttonClassName(
  variant: ButtonVariant,
  size: ButtonSize,
  fullWidth: boolean,
  className?: string
) {
  return classNames(
    styles.button,
    styles[variant],
    styles[size],
    fullWidth && styles.fullWidth,
    className
  );
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    children,
    className,
    variant = "primary",
    size = "medium",
    fullWidth = false,
    leadingIcon,
    trailingIcon,
    loading = false,
    loadingLabel = "Working",
    disabled,
    type = "button",
    ...props
  },
  ref
) {
  return (
    <button
      {...props}
      ref={ref}
      type={type}
      className={buttonClassName(variant, size, fullWidth, className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
    >
      {loading ? (
        <span className={styles.spinner} aria-hidden="true">
          <Icon icon={LoaderCircle} />
        </span>
      ) : (
        leadingIcon
      )}
      <span>{loading ? loadingLabel : children}</span>
      {!loading ? trailingIcon : null}
    </button>
  );
});

export interface ButtonLinkProps extends ComponentProps<typeof Link>, ButtonVisualProps {}

export function ButtonLink({
  children,
  className,
  variant = "primary",
  size = "medium",
  fullWidth = false,
  leadingIcon,
  trailingIcon,
  ...props
}: ButtonLinkProps) {
  return (
    <Link {...props} className={buttonClassName(variant, size, fullWidth, className)}>
      {leadingIcon}
      <span>{children}</span>
      {trailingIcon}
    </Link>
  );
}
