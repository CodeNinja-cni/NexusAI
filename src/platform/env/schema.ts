const APP_ENVIRONMENTS = ["local", "test", "preview", "staging", "production"] as const;
const LOG_LEVELS = ["debug", "info", "warn", "error"] as const;
const AI_PROVIDERS = ["mock", "openai"] as const;
const OBJECT_STORAGE_DRIVERS = ["s3", "filesystem"] as const;
const QUEUE_DRIVERS = ["bullmq", "direct"] as const;
const DOCUMENT_SCANNERS = ["structural", "clamav"] as const;

export type AppEnvironment = (typeof APP_ENVIRONMENTS)[number];
export type LogLevel = (typeof LOG_LEVELS)[number];
export type AiProviderName = (typeof AI_PROVIDERS)[number];
export type ObjectStorageDriver = (typeof OBJECT_STORAGE_DRIVERS)[number];
export type QueueDriver = (typeof QUEUE_DRIVERS)[number];
export type DocumentScanner = (typeof DOCUMENT_SCANNERS)[number];

export interface ServerEnvironment {
  readonly appEnvironment: AppEnvironment;
  readonly appBaseUrl: string;
  readonly databaseUrl: string;
  readonly betterAuthSecret: string;
  readonly trustedOrigins: readonly string[];
  readonly socialAuth: {
    readonly google?: {
      readonly clientId: string;
      readonly clientSecret: string;
    };
    readonly apple?: {
      readonly clientId: string;
      readonly teamId: string;
      readonly keyId: string;
      readonly privateKey: string;
    };
  };
  readonly smtp: {
    readonly host: string;
    readonly port: number;
    readonly secure: boolean;
    readonly user?: string;
    readonly password?: string;
    readonly from: string;
  };
  readonly logLevel: LogLevel;
  readonly observability: {
    readonly serviceName: string;
    readonly releaseVersion: string;
    readonly monitoringToken: string;
    readonly errorReportingEndpoint?: string;
    readonly errorReportingToken?: string;
    readonly errorReportingTimeoutMs: number;
  };
  readonly ai: {
    readonly provider: AiProviderName;
    readonly openAiApiKey?: string;
    readonly openAiModel: string;
    readonly requestTimeoutMs: number;
    readonly maxInputCharacters: number;
    readonly maxOutputTokens: number;
    readonly requestsPerMinute: number;
    readonly mockChunkDelayMs: number;
  };
  readonly storage: {
    readonly driver: ObjectStorageDriver;
    readonly endpoint?: string;
    readonly region: string;
    readonly bucket: string;
    readonly accessKeyId?: string;
    readonly secretAccessKey?: string;
    readonly forcePathStyle: boolean;
    readonly filesystemDirectory: string;
  };
  readonly queue: {
    readonly driver: QueueDriver;
    readonly redisUrl: string;
    readonly namespace: string;
    readonly concurrency: number;
  };
  readonly documents: {
    readonly maxBytes: number;
    readonly maxPages: number;
    readonly chunkCharacters: number;
    readonly chunkOverlapCharacters: number;
    readonly scanner: DocumentScanner;
    readonly clamavHost: string;
    readonly clamavPort: number;
  };
  readonly workflows: {
    readonly maxNodes: number;
    readonly maxSteps: number;
    readonly timeoutMs: number;
    readonly maxInputCharacters: number;
    readonly maxOutputCharacters: number;
    readonly concurrentPerWorkspace: number;
  };
}

export type RawEnvironment = Readonly<Record<string, string | undefined>>;

export class EnvironmentConfigurationError extends Error {
  readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super(`Environment configuration is invalid:\n- ${issues.join("\n- ")}`);
    this.name = "EnvironmentConfigurationError";
    this.issues = issues;
  }
}

function readEnum<const Values extends readonly string[]>(
  value: string | undefined,
  name: string,
  allowedValues: Values,
  fallback: Values[number],
  issues: string[]
): Values[number] {
  if (value === undefined || value.trim() === "") {
    return fallback;
  }

  const normalizedValue = value.trim();

  if (allowedValues.includes(normalizedValue)) {
    return normalizedValue as Values[number];
  }

  issues.push(`${name} must be one of: ${allowedValues.join(", ")}.`);
  return fallback;
}

function defaultApplicationEnvironment(nodeEnvironment: string | undefined): AppEnvironment {
  return nodeEnvironment === "test" ? "test" : "local";
}

function resolveBaseUrl(
  input: RawEnvironment,
  appEnvironment: AppEnvironment,
  issues: string[]
): string {
  const explicitBaseUrl = input.APP_BASE_URL?.trim();
  const vercelHost = input.VERCEL_URL?.trim();
  const candidate =
    explicitBaseUrl || (vercelHost ? `https://${vercelHost}` : "http://localhost:3000");

  if (!explicitBaseUrl && !vercelHost && appEnvironment !== "local" && appEnvironment !== "test") {
    issues.push("APP_BASE_URL is required outside local/test unless VERCEL_URL is available.");
  }

  let parsedUrl: URL;

  try {
    parsedUrl = new URL(candidate);
  } catch {
    issues.push("APP_BASE_URL must be an absolute URL.");
    return "http://localhost:3000";
  }

  if (parsedUrl.username || parsedUrl.password) {
    issues.push("APP_BASE_URL must not contain credentials.");
  }

  if (parsedUrl.pathname !== "/" || parsedUrl.search || parsedUrl.hash) {
    issues.push("APP_BASE_URL must be an origin without a path, query, or fragment.");
  }

  if (appEnvironment !== "local" && appEnvironment !== "test" && parsedUrl.protocol !== "https:") {
    issues.push("APP_BASE_URL must use HTTPS outside local/test.");
  }

  if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
    issues.push("APP_BASE_URL must use HTTP or HTTPS.");
  }

  return parsedUrl.origin;
}

const LOCAL_DATABASE_URL =
  "postgresql://nexus:nexus_local_password@127.0.0.1:5432/nexus_ai?schema=public";
const LOCAL_AUTH_SECRET = "local-only-nexus-auth-secret-change-before-deploying";

function readRequiredSecret(
  value: string | undefined,
  name: string,
  appEnvironment: AppEnvironment,
  localFallback: string,
  issues: string[]
): string {
  const normalizedValue = value?.trim();

  if (normalizedValue) {
    if (normalizedValue.length < 32) {
      issues.push(`${name} must contain at least 32 characters.`);
    }
    if (normalizedValue.toLowerCase().includes("replace-with")) {
      issues.push(`${name} must not use the example placeholder.`);
    }

    return normalizedValue;
  }

  if (appEnvironment !== "local" && appEnvironment !== "test") {
    issues.push(`${name} is required outside local/test.`);
  }

  return localFallback;
}

function readDatabaseUrl(
  value: string | undefined,
  appEnvironment: AppEnvironment,
  issues: string[]
): string {
  const candidate = value?.trim() || LOCAL_DATABASE_URL;

  if (!value?.trim() && appEnvironment !== "local" && appEnvironment !== "test") {
    issues.push("DATABASE_URL is required outside local/test.");
  }

  let parsedUrl: URL;

  try {
    parsedUrl = new URL(candidate);
  } catch {
    issues.push("DATABASE_URL must be a valid PostgreSQL URL.");
    return LOCAL_DATABASE_URL;
  }

  if (parsedUrl.protocol !== "postgresql:" && parsedUrl.protocol !== "postgres:") {
    issues.push("DATABASE_URL must use the postgresql protocol.");
  }
  if (
    appEnvironment !== "local" &&
    appEnvironment !== "test" &&
    !["require", "verify-ca", "verify-full"].includes(parsedUrl.searchParams.get("sslmode") ?? "")
  ) {
    issues.push("DATABASE_URL must require TLS outside local/test (sslmode=require or stricter).");
  }

  return candidate;
}

function readPort(value: string | undefined, issues: string[]): number {
  const candidate = value?.trim() || "1025";
  const port = Number(candidate);

  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    issues.push("SMTP_PORT must be an integer between 1 and 65535.");
    return 1025;
  }

  return port;
}

function readInteger(
  value: string | undefined,
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
  issues: string[]
): number {
  const candidate = value?.trim() || String(fallback);
  const parsed = Number(candidate);

  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    issues.push(`${name} must be an integer between ${minimum} and ${maximum}.`);
    return fallback;
  }

  return parsed;
}

function readBoolean(value: string | undefined, name: string, issues: string[]): boolean {
  if (value === undefined || value.trim() === "") {
    return false;
  }

  if (value === "true") {
    return true;
  }

  if (value === "false") {
    return false;
  }

  issues.push(`${name} must be true or false.`);
  return false;
}

function readTrustedOrigins(value: string | undefined, appBaseUrl: string, issues: string[]) {
  const origins = new Set([appBaseUrl]);

  for (const candidate of value?.split(",") ?? []) {
    const normalizedCandidate = candidate.trim();
    if (!normalizedCandidate) continue;

    try {
      const url = new URL(normalizedCandidate);
      if (
        (url.protocol !== "http:" && url.protocol !== "https:") ||
        url.origin !== normalizedCandidate
      ) {
        issues.push("AUTH_TRUSTED_ORIGINS entries must be HTTP(S) origins without paths.");
        continue;
      }
      origins.add(url.origin);
    } catch {
      issues.push("AUTH_TRUSTED_ORIGINS entries must be valid absolute origins.");
    }
  }

  return Object.freeze([...origins]);
}

function readHttpsEndpoint(
  value: string | undefined,
  name: string,
  appEnvironment: AppEnvironment,
  issues: string[]
): string | undefined {
  const normalized = value?.trim();
  if (!normalized) return undefined;

  try {
    const url = new URL(normalized);
    if (url.username || url.password) {
      issues.push(`${name} must not contain credentials.`);
    }
    if (url.search || url.hash) {
      issues.push(`${name} must not contain a query or fragment; use the separate token variable.`);
    }
    if (url.protocol !== "https:" && appEnvironment !== "local" && appEnvironment !== "test") {
      issues.push(`${name} must use HTTPS outside local/test.`);
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      issues.push(`${name} must use HTTP or HTTPS.`);
    }
    return url.toString();
  } catch {
    issues.push(`${name} must be an absolute HTTP(S) URL.`);
    return undefined;
  }
}

export function parseServerEnvironment(input: RawEnvironment): ServerEnvironment {
  const issues: string[] = [];
  const appEnvironment = readEnum(
    input.APP_ENV,
    "APP_ENV",
    APP_ENVIRONMENTS,
    defaultApplicationEnvironment(input.NODE_ENV),
    issues
  );
  const logLevel = readEnum(input.LOG_LEVEL, "LOG_LEVEL", LOG_LEVELS, "info", issues);
  const appBaseUrl = resolveBaseUrl(input, appEnvironment, issues);
  const databaseUrl = readDatabaseUrl(input.DATABASE_URL, appEnvironment, issues);
  const betterAuthSecret = readRequiredSecret(
    input.BETTER_AUTH_SECRET,
    "BETTER_AUTH_SECRET",
    appEnvironment,
    LOCAL_AUTH_SECRET,
    issues
  );
  const trustedOrigins = readTrustedOrigins(input.AUTH_TRUSTED_ORIGINS, appBaseUrl, issues);
  const googleClientId = input.GOOGLE_CLIENT_ID?.trim();
  const googleClientSecret = input.GOOGLE_CLIENT_SECRET?.trim();
  const appleClientId = input.APPLE_CLIENT_ID?.trim();
  const appleTeamId = input.APPLE_TEAM_ID?.trim();
  const appleKeyId = input.APPLE_KEY_ID?.trim();
  const applePrivateKey = input.APPLE_PRIVATE_KEY?.trim();

  if (Boolean(googleClientId) !== Boolean(googleClientSecret)) {
    issues.push("GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be configured together.");
  }
  const hasAnyAppleCredentials =
    Boolean(appleClientId) ||
    Boolean(appleTeamId) ||
    Boolean(appleKeyId) ||
    Boolean(applePrivateKey);
  const hasAllAppleCredentials =
    Boolean(appleClientId) &&
    Boolean(appleTeamId) &&
    Boolean(appleKeyId) &&
    Boolean(applePrivateKey);
  if (hasAnyAppleCredentials && !hasAllAppleCredentials) {
    issues.push(
      "APPLE_CLIENT_ID, APPLE_TEAM_ID, APPLE_KEY_ID, and APPLE_PRIVATE_KEY must be configured together."
    );
  }
  const socialAuth = {
    ...(googleClientId && googleClientSecret
      ? { google: { clientId: googleClientId, clientSecret: googleClientSecret } }
      : {}),
    ...(hasAllAppleCredentials
      ? {
          apple: {
            clientId: appleClientId!,
            teamId: appleTeamId!,
            keyId: appleKeyId!,
            privateKey: applePrivateKey!
          }
        }
      : {})
  };

  const serviceName = input.SERVICE_NAME?.trim() || "nexus-ai";
  const releaseVersion =
    input.RELEASE_VERSION?.trim() || input.VERCEL_GIT_COMMIT_SHA?.trim() || "development";
  const monitoringToken = readRequiredSecret(
    input.MONITORING_TOKEN,
    "MONITORING_TOKEN",
    appEnvironment,
    "local-only-monitoring-token-change-before-deploying",
    issues
  );
  const errorReportingEndpoint = readHttpsEndpoint(
    input.ERROR_REPORTING_ENDPOINT,
    "ERROR_REPORTING_ENDPOINT",
    appEnvironment,
    issues
  );
  const errorReportingToken = input.ERROR_REPORTING_TOKEN?.trim();
  const errorReportingTimeoutMs = readInteger(
    input.ERROR_REPORTING_TIMEOUT_MS,
    "ERROR_REPORTING_TIMEOUT_MS",
    2_000,
    250,
    10_000,
    issues
  );
  const smtpHost = input.SMTP_HOST?.trim() || "127.0.0.1";
  const smtpPort = readPort(input.SMTP_PORT, issues);
  const smtpSecure = readBoolean(input.SMTP_SECURE, "SMTP_SECURE", issues);
  const smtpFrom = input.SMTP_FROM?.trim() || "NEXUS AI <noreply@nexus.local>";
  const smtpUser = input.SMTP_USER?.trim();
  const smtpPassword = input.SMTP_PASSWORD?.trim();
  const aiProvider = readEnum(
    input.AI_PROVIDER,
    "AI_PROVIDER",
    AI_PROVIDERS,
    appEnvironment === "local" || appEnvironment === "test" ? "mock" : "openai",
    issues
  );
  const openAiApiKey = input.OPENAI_API_KEY?.trim();
  const openAiModel = input.AI_OPENAI_MODEL?.trim() || "gpt-5-mini";
  const aiRequestTimeoutMs = readInteger(
    input.AI_REQUEST_TIMEOUT_MS,
    "AI_REQUEST_TIMEOUT_MS",
    60_000,
    5_000,
    300_000,
    issues
  );
  const aiMaxInputCharacters = readInteger(
    input.AI_MAX_INPUT_CHARACTERS,
    "AI_MAX_INPUT_CHARACTERS",
    128_000,
    4_000,
    1_000_000,
    issues
  );
  const aiMaxOutputTokens = readInteger(
    input.AI_MAX_OUTPUT_TOKENS,
    "AI_MAX_OUTPUT_TOKENS",
    2_048,
    64,
    32_768,
    issues
  );
  const aiRequestsPerMinute = readInteger(
    input.AI_REQUESTS_PER_MINUTE,
    "AI_REQUESTS_PER_MINUTE",
    12,
    1,
    1_000,
    issues
  );
  const aiMockChunkDelayMs = readInteger(
    input.AI_MOCK_CHUNK_DELAY_MS,
    "AI_MOCK_CHUNK_DELAY_MS",
    18,
    0,
    2_000,
    issues
  );
  const storageDriver = readEnum(
    input.OBJECT_STORAGE_DRIVER,
    "OBJECT_STORAGE_DRIVER",
    OBJECT_STORAGE_DRIVERS,
    appEnvironment === "test" ? "filesystem" : "s3",
    issues
  );
  const storageEndpoint =
    input.S3_ENDPOINT?.trim() ||
    (appEnvironment === "local" || appEnvironment === "test" ? "http://127.0.0.1:9000" : undefined);
  const storageRegion = input.S3_REGION?.trim() || "us-east-1";
  const storageBucket = input.S3_BUCKET?.trim() || "nexus-private";
  const storageAccessKeyId =
    input.S3_ACCESS_KEY_ID?.trim() ||
    (appEnvironment === "local" || appEnvironment === "test" ? "nexus-minio" : undefined);
  const storageSecretAccessKey =
    input.S3_SECRET_ACCESS_KEY?.trim() ||
    (appEnvironment === "local" || appEnvironment === "test"
      ? "nexus-minio-local-secret"
      : undefined);
  const storageForcePathStyle =
    input.S3_FORCE_PATH_STYLE === undefined
      ? true
      : readBoolean(input.S3_FORCE_PATH_STYLE, "S3_FORCE_PATH_STYLE", issues);
  const filesystemDirectory =
    input.DOCUMENT_STORAGE_DIR?.trim() || "/tmp/nexus-ai-document-storage";
  const queueDriver = readEnum(
    input.QUEUE_DRIVER,
    "QUEUE_DRIVER",
    QUEUE_DRIVERS,
    appEnvironment === "test" ? "direct" : "bullmq",
    issues
  );
  const redisUrl = input.REDIS_URL?.trim() || "redis://127.0.0.1:6379";
  const queueNamespace = input.QUEUE_NAMESPACE?.trim() || "nexus";
  const queueConcurrency = readInteger(
    input.DOCUMENT_WORKER_CONCURRENCY,
    "DOCUMENT_WORKER_CONCURRENCY",
    2,
    1,
    32,
    issues
  );
  const documentMaxBytes = readInteger(
    input.DOCUMENT_MAX_BYTES,
    "DOCUMENT_MAX_BYTES",
    25 * 1024 * 1024,
    1_024,
    100 * 1024 * 1024,
    issues
  );
  const documentMaxPages = readInteger(
    input.DOCUMENT_MAX_PAGES,
    "DOCUMENT_MAX_PAGES",
    500,
    1,
    2_000,
    issues
  );
  const chunkCharacters = readInteger(
    input.DOCUMENT_CHUNK_CHARACTERS,
    "DOCUMENT_CHUNK_CHARACTERS",
    1_600,
    400,
    8_000,
    issues
  );
  const chunkOverlapCharacters = readInteger(
    input.DOCUMENT_CHUNK_OVERLAP_CHARACTERS,
    "DOCUMENT_CHUNK_OVERLAP_CHARACTERS",
    200,
    0,
    2_000,
    issues
  );
  const documentScanner = readEnum(
    input.DOCUMENT_SCANNER,
    "DOCUMENT_SCANNER",
    DOCUMENT_SCANNERS,
    appEnvironment === "local" || appEnvironment === "test" ? "structural" : "clamav",
    issues
  );
  const clamavHost = input.CLAMAV_HOST?.trim() || "127.0.0.1";
  const clamavPort = readInteger(input.CLAMAV_PORT, "CLAMAV_PORT", 3310, 1, 65_535, issues);
  const workflowMaxNodes = readInteger(
    input.WORKFLOW_MAX_NODES,
    "WORKFLOW_MAX_NODES",
    40,
    2,
    100,
    issues
  );
  const workflowMaxSteps = readInteger(
    input.WORKFLOW_MAX_STEPS,
    "WORKFLOW_MAX_STEPS",
    100,
    2,
    100,
    issues
  );
  const workflowTimeoutMs = readInteger(
    input.WORKFLOW_TIMEOUT_MS,
    "WORKFLOW_TIMEOUT_MS",
    600_000,
    5_000,
    600_000,
    issues
  );
  const workflowMaxInputCharacters = readInteger(
    input.WORKFLOW_MAX_INPUT_CHARACTERS,
    "WORKFLOW_MAX_INPUT_CHARACTERS",
    16_000,
    100,
    64_000,
    issues
  );
  const workflowMaxOutputCharacters = readInteger(
    input.WORKFLOW_MAX_OUTPUT_CHARACTERS,
    "WORKFLOW_MAX_OUTPUT_CHARACTERS",
    32_000,
    100,
    1_000_000,
    issues
  );
  const workflowConcurrentPerWorkspace = readInteger(
    input.WORKFLOW_CONCURRENT_PER_WORKSPACE,
    "WORKFLOW_CONCURRENT_PER_WORKSPACE",
    2,
    1,
    20,
    issues
  );

  if (aiProvider === "openai" && !openAiApiKey) {
    issues.push("OPENAI_API_KEY is required when AI_PROVIDER=openai.");
  }

  if (!/^[a-z0-9][a-z0-9._-]{1,63}$/u.test(serviceName)) {
    issues.push("SERVICE_NAME must be a lowercase service identifier.");
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(releaseVersion)) {
    issues.push("RELEASE_VERSION must be a safe release identifier.");
  }
  if (appEnvironment !== "local" && appEnvironment !== "test" && releaseVersion === "development") {
    issues.push("RELEASE_VERSION is required outside local/test.");
  }
  if (appEnvironment === "production" && !errorReportingEndpoint) {
    issues.push("ERROR_REPORTING_ENDPOINT is required in production.");
  }
  if (Boolean(errorReportingEndpoint) !== Boolean(errorReportingToken)) {
    issues.push("ERROR_REPORTING_ENDPOINT and ERROR_REPORTING_TOKEN must be configured together.");
  }
  if (errorReportingToken && errorReportingToken.length < 32) {
    issues.push("ERROR_REPORTING_TOKEN must contain at least 32 characters.");
  }

  if (aiProvider === "mock" && appEnvironment !== "local" && appEnvironment !== "test") {
    issues.push("AI_PROVIDER=mock is allowed only in local and test environments.");
  }

  if (storageDriver === "filesystem" && appEnvironment !== "test") {
    issues.push("OBJECT_STORAGE_DRIVER=filesystem is allowed only in test environments.");
  }
  if (queueDriver === "direct" && appEnvironment !== "test") {
    issues.push("QUEUE_DRIVER=direct is allowed only in test environments.");
  }
  if (documentScanner === "structural" && appEnvironment !== "local" && appEnvironment !== "test") {
    issues.push("DOCUMENT_SCANNER=structural is allowed only in local and test environments.");
  }
  if (appEnvironment !== "local" && appEnvironment !== "test" && storageDriver === "s3") {
    for (const [name, value] of [
      ["S3_REGION", input.S3_REGION],
      ["S3_BUCKET", input.S3_BUCKET]
    ] as const) {
      if (!value?.trim()) issues.push(`${name} is required for deployed S3 storage.`);
    }
  }
  if (Boolean(storageAccessKeyId) !== Boolean(storageSecretAccessKey)) {
    issues.push(
      "S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY must be configured together, or both omitted for workload identity."
    );
  }
  if (
    appEnvironment !== "local" &&
    appEnvironment !== "test" &&
    queueDriver === "bullmq" &&
    !input.REDIS_URL?.trim()
  ) {
    issues.push("REDIS_URL is required for the deployed document queue.");
  }
  if (
    appEnvironment !== "local" &&
    appEnvironment !== "test" &&
    documentScanner === "clamav" &&
    !input.CLAMAV_HOST?.trim()
  ) {
    issues.push("CLAMAV_HOST is required for deployed document scanning.");
  }
  if (chunkOverlapCharacters >= chunkCharacters) {
    issues.push(
      "DOCUMENT_CHUNK_OVERLAP_CHARACTERS must be smaller than DOCUMENT_CHUNK_CHARACTERS."
    );
  }
  try {
    const parsedRedis = new URL(redisUrl);
    if (parsedRedis.protocol !== "redis:" && parsedRedis.protocol !== "rediss:") {
      issues.push("REDIS_URL must use redis or rediss.");
    }
    if (
      appEnvironment !== "local" &&
      appEnvironment !== "test" &&
      parsedRedis.protocol !== "rediss:"
    ) {
      issues.push("REDIS_URL must use rediss outside local/test.");
    }
  } catch {
    issues.push("REDIS_URL must be an absolute Redis URL.");
  }
  if (storageEndpoint) {
    try {
      const parsedStorage = new URL(storageEndpoint);
      if (parsedStorage.protocol !== "http:" && parsedStorage.protocol !== "https:") {
        issues.push("S3_ENDPOINT must use HTTP or HTTPS.");
      }
      if (
        appEnvironment !== "local" &&
        appEnvironment !== "test" &&
        parsedStorage.protocol !== "https:"
      ) {
        issues.push("S3_ENDPOINT must use HTTPS outside local/test.");
      }
    } catch {
      issues.push("S3_ENDPOINT must be an absolute HTTP(S) URL.");
    }
  }
  if (!storageBucket || !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/u.test(storageBucket)) {
    issues.push("S3_BUCKET must be a valid lowercase bucket name.");
  }
  if (!queueNamespace || !/^[a-z0-9][a-z0-9_-]{0,39}$/u.test(queueNamespace)) {
    issues.push(
      "QUEUE_NAMESPACE must contain only lowercase letters, numbers, underscores, or hyphens."
    );
  }

  if (!input.SMTP_HOST?.trim() && appEnvironment !== "local" && appEnvironment !== "test") {
    issues.push("SMTP_HOST is required outside local/test.");
  }

  if (!input.SMTP_FROM?.trim() && appEnvironment !== "local" && appEnvironment !== "test") {
    issues.push("SMTP_FROM is required outside local/test.");
  }

  if (Boolean(smtpUser) !== Boolean(smtpPassword)) {
    issues.push("SMTP_USER and SMTP_PASSWORD must be configured together.");
  }

  if (issues.length > 0) {
    throw new EnvironmentConfigurationError(issues);
  }

  return Object.freeze({
    appEnvironment,
    appBaseUrl,
    databaseUrl,
    betterAuthSecret,
    trustedOrigins,
    socialAuth,
    smtp: {
      host: smtpHost,
      port: smtpPort,
      secure: smtpSecure,
      ...(smtpUser ? { user: smtpUser } : {}),
      ...(smtpPassword ? { password: smtpPassword } : {}),
      from: smtpFrom
    },
    logLevel,
    observability: {
      serviceName,
      releaseVersion,
      monitoringToken,
      ...(errorReportingEndpoint ? { errorReportingEndpoint } : {}),
      ...(errorReportingToken ? { errorReportingToken } : {}),
      errorReportingTimeoutMs
    },
    ai: {
      provider: aiProvider,
      ...(openAiApiKey ? { openAiApiKey } : {}),
      openAiModel,
      requestTimeoutMs: aiRequestTimeoutMs,
      maxInputCharacters: aiMaxInputCharacters,
      maxOutputTokens: aiMaxOutputTokens,
      requestsPerMinute: aiRequestsPerMinute,
      mockChunkDelayMs: aiMockChunkDelayMs
    },
    storage: {
      driver: storageDriver,
      ...(storageEndpoint ? { endpoint: storageEndpoint } : {}),
      region: storageRegion,
      bucket: storageBucket,
      ...(storageAccessKeyId ? { accessKeyId: storageAccessKeyId } : {}),
      ...(storageSecretAccessKey ? { secretAccessKey: storageSecretAccessKey } : {}),
      forcePathStyle: storageForcePathStyle,
      filesystemDirectory
    },
    queue: {
      driver: queueDriver,
      redisUrl,
      namespace: queueNamespace,
      concurrency: queueConcurrency
    },
    documents: {
      maxBytes: documentMaxBytes,
      maxPages: documentMaxPages,
      chunkCharacters,
      chunkOverlapCharacters,
      scanner: documentScanner,
      clamavHost,
      clamavPort
    },
    workflows: {
      maxNodes: workflowMaxNodes,
      maxSteps: workflowMaxSteps,
      timeoutMs: workflowTimeoutMs,
      maxInputCharacters: workflowMaxInputCharacters,
      maxOutputCharacters: workflowMaxOutputCharacters,
      concurrentPerWorkspace: workflowConcurrentPerWorkspace
    }
  });
}
