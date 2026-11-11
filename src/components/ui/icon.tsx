import type { LucideIcon, LucideProps } from "lucide-react";

interface IconProps extends Omit<LucideProps, "ref"> {
  readonly icon: LucideIcon;
  readonly label?: string | undefined;
}

export function Icon({
  icon: IconComponent,
  label,
  size = 18,
  strokeWidth = 1.8,
  ...props
}: IconProps) {
  return (
    <IconComponent
      {...props}
      size={size}
      strokeWidth={strokeWidth}
      focusable="false"
      {...(label ? { role: "img", "aria-label": label } : { "aria-hidden": true })}
    />
  );
}
