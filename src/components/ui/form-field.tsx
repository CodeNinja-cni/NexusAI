import {
  forwardRef,
  useId,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes
} from "react";
import { ChevronDown } from "lucide-react";

import { classNames } from "@/shared/utils/class-names";

import { Icon } from "./icon";
import styles from "./form-field.module.css";

interface FieldFrameProps {
  readonly children: ReactNode;
  readonly label: string;
  readonly fieldId: string;
  readonly descriptionId: string;
  readonly error?: string | undefined;
  readonly hint?: string | undefined;
  readonly optional?: boolean | undefined;
  readonly className?: string | undefined;
}

function FieldFrame({
  children,
  label,
  fieldId,
  descriptionId,
  error,
  hint,
  optional,
  className
}: FieldFrameProps) {
  return (
    <div className={classNames(styles.field, className)}>
      <label htmlFor={fieldId}>
        <span>{label}</span>
        {optional ? <small>Optional</small> : null}
      </label>
      {children}
      {error ? (
        <p className={styles.error} id={descriptionId} role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className={styles.hint} id={descriptionId}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...props }, ref) {
    return <input {...props} ref={ref} className={classNames(styles.control, className)} />;
  }
);

export const TextArea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement>
>(function TextArea({ className, rows = 4, ...props }, ref) {
  return (
    <textarea {...props} ref={ref} rows={rows} className={classNames(styles.control, className)} />
  );
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  function Select({ className, children, ...props }, ref) {
    return (
      <span className={styles.selectWrap}>
        <select {...props} ref={ref} className={classNames(styles.control, className)}>
          {children}
        </select>
        <Icon icon={ChevronDown} />
      </span>
    );
  }
);

interface SharedFieldProps {
  readonly label: string;
  readonly error?: string | undefined;
  readonly hint?: string | undefined;
  readonly optional?: boolean | undefined;
  readonly className?: string | undefined;
}

export interface FormFieldProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "className">, SharedFieldProps {
  readonly endAdornment?: ReactNode;
}

export function FormField({
  label,
  error,
  hint,
  optional,
  className,
  id,
  endAdornment,
  ...inputProps
}: FormFieldProps) {
  const generatedId = useId();
  const fieldId = id ?? inputProps.name ?? generatedId;
  const descriptionId = `${fieldId}-description`;

  const control = (
    <Input
      {...inputProps}
      id={fieldId}
      className={endAdornment ? styles.controlWithAdornment : undefined}
      aria-invalid={error ? true : undefined}
      aria-describedby={error || hint ? descriptionId : undefined}
    />
  );

  return (
    <FieldFrame {...{ label, fieldId, descriptionId, error, hint, optional, className }}>
      {endAdornment ? (
        <span className={styles.controlWrap}>
          {control}
          {endAdornment}
        </span>
      ) : (
        control
      )}
    </FieldFrame>
  );
}

export interface TextAreaFieldProps
  extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "className">, SharedFieldProps {}

export function TextAreaField({
  label,
  error,
  hint,
  optional,
  className,
  id,
  ...textareaProps
}: TextAreaFieldProps) {
  const generatedId = useId();
  const fieldId = id ?? textareaProps.name ?? generatedId;
  const descriptionId = `${fieldId}-description`;

  return (
    <FieldFrame {...{ label, fieldId, descriptionId, error, hint, optional, className }}>
      <TextArea
        {...textareaProps}
        id={fieldId}
        aria-invalid={error ? true : undefined}
        aria-describedby={error || hint ? descriptionId : undefined}
      />
    </FieldFrame>
  );
}

export interface SelectFieldProps
  extends Omit<SelectHTMLAttributes<HTMLSelectElement>, "className">, SharedFieldProps {}

export function SelectField({
  label,
  error,
  hint,
  optional,
  className,
  id,
  children,
  ...selectProps
}: SelectFieldProps) {
  const generatedId = useId();
  const fieldId = id ?? selectProps.name ?? generatedId;
  const descriptionId = `${fieldId}-description`;

  return (
    <FieldFrame {...{ label, fieldId, descriptionId, error, hint, optional, className }}>
      <Select
        {...selectProps}
        id={fieldId}
        aria-invalid={error ? true : undefined}
        aria-describedby={error || hint ? descriptionId : undefined}
      >
        {children}
      </Select>
    </FieldFrame>
  );
}
