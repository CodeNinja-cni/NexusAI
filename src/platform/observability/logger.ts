import "server-only";

import { getServerEnvironment } from "@/platform/env/server";

type LogLevel = "debug" | "info" | "warn" | "error";
type LogFields = Readonly<Record<string, unknown>>;

const LEVEL_PRIORITY: Readonly<Record<LogLevel, number>> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40
};
const SENSITIVE_FIELD =
  /(?:authorization|cookie|credential|password|secret|session|token|api[_-]?key|access[_-]?key|database[_-]?url|redis[_-]?url|dsn)/iu;
const MAX_DEPTH = 5;
const MAX_ARRAY_ITEMS = 25;
const MAX_STRING_LENGTH = 512;

export function sanitizeLogValue(value: unknown, key = "value", depth = 0): unknown {
  if (SENSITIVE_FIELD.test(key)) return "[REDACTED]";
  if (depth >= MAX_DEPTH) return "[TRUNCATED]";
  if (value === null || typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "string") {
    return value.length <= MAX_STRING_LENGTH
      ? value
      : `${value.slice(0, MAX_STRING_LENGTH)}[TRUNCATED]`;
  }
  if (value instanceof Error) {
    const digest = "digest" in value && typeof value.digest === "string" ? value.digest : undefined;
    return { name: value.name, ...(digest ? { digest } : {}) };
  }
  if (Array.isArray(value)) {
    return value.slice(0, MAX_ARRAY_ITEMS).map((item) => sanitizeLogValue(item, key, depth + 1));
  }
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .slice(0, 50)
        .map(([entryKey, entryValue]) => [
          entryKey,
          sanitizeLogValue(entryValue, entryKey, depth + 1)
        ])
    );
  }
  return String(value);
}

function write(level: LogLevel, event: string, fields: LogFields = {}) {
  const environment = getServerEnvironment();
  if (LEVEL_PRIORITY[level] < LEVEL_PRIORITY[environment.logLevel]) return;

  const payload = JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    event,
    service: environment.observability.serviceName,
    release: environment.observability.releaseVersion,
    environment: environment.appEnvironment,
    fields: sanitizeLogValue(fields, "fields")
  });

  if (level === "error") console.error(payload);
  else if (level === "warn") console.warn(payload);
  else console.info(payload);
}

export const logger = Object.freeze({
  debug: (event: string, fields?: LogFields) => write("debug", event, fields),
  info: (event: string, fields?: LogFields) => write("info", event, fields),
  warn: (event: string, fields?: LogFields) => write("warn", event, fields),
  error: (event: string, fields?: LogFields) => write("error", event, fields)
});
