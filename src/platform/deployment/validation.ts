import {
  parseServerEnvironment,
  type RawEnvironment,
  type ServerEnvironment
} from "@/platform/env/schema";

const SENSITIVE_PUBLIC_NAME =
  /(?:secret|password|token|credential|api[_-]?key|access[_-]?key|database|redis|smtp|openai|s3)/iu;

export interface DeploymentValidationResult {
  readonly environment: ServerEnvironment;
  readonly platform: "container" | "vercel";
  readonly warnings: readonly string[];
}

export class DeploymentConfigurationError extends Error {
  readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super(`Deployment configuration is invalid:\n- ${issues.join("\n- ")}`);
    this.name = "DeploymentConfigurationError";
    this.issues = issues;
  }
}

export function validateDeploymentEnvironment(input: RawEnvironment): DeploymentValidationResult {
  const environment = parseServerEnvironment(input);
  const issues: string[] = [];
  const warnings: string[] = [];
  const rawPlatform = input.DEPLOYMENT_PLATFORM?.trim() || "container";
  const platform = rawPlatform === "vercel" ? "vercel" : "container";

  if (rawPlatform !== "container" && rawPlatform !== "vercel") {
    issues.push("DEPLOYMENT_PLATFORM must be container or vercel.");
  }
  if (environment.appEnvironment !== "staging" && environment.appEnvironment !== "production") {
    issues.push("Deployment validation accepts only staging or production APP_ENV values.");
  }
  if (input.NODE_ENV !== "production") {
    issues.push("NODE_ENV must be production for a deployed runtime.");
  }
  for (const key of Object.keys(input)) {
    if (key.startsWith("NEXT_PUBLIC_") && SENSITIVE_PUBLIC_NAME.test(key)) {
      issues.push("A secret-like variable uses the public NEXT_PUBLIC_ prefix.");
      break;
    }
  }

  if (input.DIRECT_URL?.trim()) {
    validatePostgresTlsUrl(input.DIRECT_URL, "DIRECT_URL", issues);
  } else {
    warnings.push(
      "DIRECT_URL is not configured; confirm that DATABASE_URL accepts schema migrations and is not a transaction-pool-only endpoint."
    );
  }

  if (issues.length > 0) throw new DeploymentConfigurationError(issues);
  return Object.freeze({ environment, platform, warnings: Object.freeze(warnings) });
}

function validatePostgresTlsUrl(value: string, name: string, issues: string[]) {
  try {
    const url = new URL(value);
    if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
      issues.push(`${name} must use the postgresql protocol.`);
    }
    if (!["require", "verify-ca", "verify-full"].includes(url.searchParams.get("sslmode") ?? "")) {
      issues.push(`${name} must require TLS with sslmode=require or stricter.`);
    }
  } catch {
    issues.push(`${name} must be a valid PostgreSQL URL.`);
  }
}
