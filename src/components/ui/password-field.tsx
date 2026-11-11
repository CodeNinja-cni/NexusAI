"use client";

import { Eye, EyeOff } from "lucide-react";
import { useState } from "react";

import { FormField, type FormFieldProps } from "./form-field";
import { Icon } from "./icon";
import styles from "./form-field.module.css";

export type PasswordFieldProps = Omit<FormFieldProps, "endAdornment" | "type">;

export function PasswordField({ disabled, ...props }: PasswordFieldProps) {
  const [visible, setVisible] = useState(false);
  const action = visible ? "Hide password" : "Show password";

  return (
    <FormField
      {...props}
      disabled={disabled}
      type={visible ? "text" : "password"}
      endAdornment={
        <button
          className={styles.passwordToggle}
          type="button"
          disabled={disabled}
          aria-label={action}
          aria-pressed={visible}
          title={action}
          onClick={() => setVisible((current) => !current)}
        >
          <Icon icon={visible ? EyeOff : Eye} />
        </button>
      }
    />
  );
}
