"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from "react";
import { AlertTriangle, CheckCircle2, Info, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";

import styles from "./toast.module.css";

export type ToastTone = "success" | "error" | "info";

interface ToastInput {
  readonly title: string;
  readonly message?: string | undefined;
  readonly tone?: ToastTone | undefined;
  readonly duration?: number | undefined;
}

interface ToastRecord extends Required<Pick<ToastInput, "title" | "tone" | "duration">> {
  readonly id: string;
  readonly message?: string | undefined;
}

interface ToastContextValue {
  readonly notify: (toast: ToastInput) => string;
  readonly dismiss: (id: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { readonly children: ReactNode }) {
  const [toasts, setToasts] = useState<readonly ToastRecord[]>([]);
  const idCounter = useRef(0);

  const dismiss = useCallback((id: string) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const notify = useCallback((input: ToastInput) => {
    idCounter.current += 1;
    const id = `toast-${idCounter.current}`;
    const duration = input.duration ?? 5000;
    const toast: ToastRecord = {
      id,
      title: input.title,
      message: input.message,
      tone: input.tone ?? "info",
      duration
    };
    setToasts((current) => [...current.slice(-3), toast]);
    window.setTimeout(() => {
      setToasts((current) => current.filter((candidate) => candidate.id !== id));
    }, duration);
    return id;
  }, []);

  const contextValue = useMemo(() => ({ notify, dismiss }), [dismiss, notify]);

  return (
    <ToastContext.Provider value={contextValue}>
      {children}
      <section className={styles.viewport} aria-label="Notifications" aria-live="polite">
        {toasts.map((toast) => (
          <ToastItem key={toast.id} toast={toast} onDismiss={() => dismiss(toast.id)} />
        ))}
      </section>
    </ToastContext.Provider>
  );
}

function ToastItem({
  toast,
  onDismiss
}: {
  readonly toast: ToastRecord;
  readonly onDismiss: () => void;
}) {
  const ToneIcon =
    toast.tone === "success" ? CheckCircle2 : toast.tone === "error" ? AlertTriangle : Info;
  return (
    <article
      className={styles.toast}
      data-tone={toast.tone}
      role={toast.tone === "error" ? "alert" : "status"}
    >
      <span className={styles.icon}>
        <Icon icon={ToneIcon} />
      </span>
      <div>
        <strong>{toast.title}</strong>
        {toast.message ? <p>{toast.message}</p> : null}
      </div>
      <Button
        variant="ghost"
        size="small"
        onClick={onDismiss}
        aria-label={`Dismiss ${toast.title}`}
      >
        <Icon icon={X} />
      </Button>
    </article>
  );
}

export function useToast(): ToastContextValue {
  const value = useContext(ToastContext);
  if (!value) throw new Error("useToast must be used within ToastProvider.");
  return value;
}
