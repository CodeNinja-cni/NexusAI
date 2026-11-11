import { describe, expect, it } from "vitest";

import { EnvironmentConfigurationError, parseServerEnvironment } from "@/platform/env/schema";

describe("parseServerEnvironment", () => {
  it("provides safe local defaults", () => {
    expect(parseServerEnvironment({})).toEqual({
      appEnvironment: "local",
      appBaseUrl: "http://localhost:3000",
      databaseUrl: "postgresql://nexus:nexus_local_password@127.0.0.1:5432/nexus_ai?schema=public",
      betterAuthSecret: "local-only-nexus-auth-secret-change-before-deploying",
      trustedOrigins: ["http://localhost:3000"],
      socialAuth: {},
      smtp: {
        host: "127.0.0.1",
        port: 1025,
        secure: false,
        from: "NEXUS AI <noreply@nexus.local>"
      },
      logLevel: "info",
      observability: {
        serviceName: "nexus-ai",
        releaseVersion: "development",
        monitoringToken: "local-only-monitoring-token-change-before-deploying",
        errorReportingTimeoutMs: 2_000
      },
      ai: {
        provider: "mock",
        openAiModel: "gpt-5-mini",
        requestTimeoutMs: 60_000,
        maxInputCharacters: 128_000,
        maxOutputTokens: 2_048,
        requestsPerMinute: 12,
        mockChunkDelayMs: 18
      },
      storage: {
        driver: "s3",
        endpoint: "http://127.0.0.1:9000",
        region: "us-east-1",
        bucket: "nexus-private",
        accessKeyId: "nexus-minio",
        secretAccessKey: "nexus-minio-local-secret",
        forcePathStyle: true,
        filesystemDirectory: "/tmp/nexus-ai-document-storage"
      },
      queue: {
        driver: "bullmq",
        redisUrl: "redis://127.0.0.1:6379",
        namespace: "nexus",
        concurrency: 2
      },
      documents: {
        maxBytes: 25 * 1024 * 1024,
        maxPages: 500,
        chunkCharacters: 1_600,
        chunkOverlapCharacters: 200,
        scanner: "structural",
        clamavHost: "127.0.0.1",
        clamavPort: 3310
      },
      workflows: {
        maxNodes: 40,
        maxSteps: 100,
        timeoutMs: 600_000,
        maxInputCharacters: 16_000,
        maxOutputCharacters: 32_000,
        concurrentPerWorkspace: 2
      }
    });
  });

  it("accepts an explicit production origin", () => {
    expect(
      parseServerEnvironment({
        APP_ENV: "production",
        APP_BASE_URL: "https://nexus.example",
        RELEASE_VERSION: "release-2026-11-08",
        DATABASE_URL: "postgresql://nexus:secret@database.example/nexus?sslmode=require",
        BETTER_AUTH_SECRET: "production-auth-secret-with-at-least-32-characters",
        MONITORING_TOKEN: "production-monitoring-token-with-at-least-32-characters",
        ERROR_REPORTING_ENDPOINT: "https://errors.example/v1/events",
        ERROR_REPORTING_TOKEN: "production-error-token-with-at-least-32-characters",
        SMTP_HOST: "smtp.example",
        SMTP_FROM: "NEXUS AI <noreply@nexus.example>",
        OPENAI_API_KEY: "production-openai-api-key",
        S3_ENDPOINT: "https://objects.example",
        S3_REGION: "us-east-1",
        S3_BUCKET: "nexus-private",
        S3_ACCESS_KEY_ID: "production-storage-key",
        S3_SECRET_ACCESS_KEY: "production-storage-secret",
        REDIS_URL: "rediss://redis.example:6379",
        CLAMAV_HOST: "scanner.internal",
        LOG_LEVEL: "warn"
      })
    ).toEqual({
      appEnvironment: "production",
      appBaseUrl: "https://nexus.example",
      databaseUrl: "postgresql://nexus:secret@database.example/nexus?sslmode=require",
      betterAuthSecret: "production-auth-secret-with-at-least-32-characters",
      trustedOrigins: ["https://nexus.example"],
      socialAuth: {},
      smtp: {
        host: "smtp.example",
        port: 1025,
        secure: false,
        from: "NEXUS AI <noreply@nexus.example>"
      },
      logLevel: "warn",
      observability: {
        serviceName: "nexus-ai",
        releaseVersion: "release-2026-11-08",
        monitoringToken: "production-monitoring-token-with-at-least-32-characters",
        errorReportingEndpoint: "https://errors.example/v1/events",
        errorReportingToken: "production-error-token-with-at-least-32-characters",
        errorReportingTimeoutMs: 2_000
      },
      ai: {
        provider: "openai",
        openAiApiKey: "production-openai-api-key",
        openAiModel: "gpt-5-mini",
        requestTimeoutMs: 60_000,
        maxInputCharacters: 128_000,
        maxOutputTokens: 2_048,
        requestsPerMinute: 12,
        mockChunkDelayMs: 18
      },
      storage: {
        driver: "s3",
        endpoint: "https://objects.example",
        region: "us-east-1",
        bucket: "nexus-private",
        accessKeyId: "production-storage-key",
        secretAccessKey: "production-storage-secret",
        forcePathStyle: true,
        filesystemDirectory: "/tmp/nexus-ai-document-storage"
      },
      queue: {
        driver: "bullmq",
        redisUrl: "rediss://redis.example:6379",
        namespace: "nexus",
        concurrency: 2
      },
      documents: {
        maxBytes: 25 * 1024 * 1024,
        maxPages: 500,
        chunkCharacters: 1_600,
        chunkOverlapCharacters: 200,
        scanner: "clamav",
        clamavHost: "scanner.internal",
        clamavPort: 3310
      },
      workflows: {
        maxNodes: 40,
        maxSteps: 100,
        timeoutMs: 600_000,
        maxInputCharacters: 16_000,
        maxOutputCharacters: 32_000,
        concurrentPerWorkspace: 2
      }
    });
  });

  it("derives a secure preview origin from Vercel", () => {
    expect(
      parseServerEnvironment({
        APP_ENV: "preview",
        VERCEL_URL: "nexus-preview.vercel.app",
        RELEASE_VERSION: "preview-123",
        DATABASE_URL: "postgresql://nexus:secret@database.example/nexus?sslmode=require",
        BETTER_AUTH_SECRET: "preview-auth-secret-with-at-least-32-characters",
        MONITORING_TOKEN: "preview-monitoring-token-with-at-least-32-characters",
        SMTP_HOST: "smtp.example",
        SMTP_FROM: "NEXUS AI <noreply@nexus.example>",
        OPENAI_API_KEY: "preview-openai-api-key",
        S3_ENDPOINT: "https://objects.example",
        S3_REGION: "us-east-1",
        S3_BUCKET: "nexus-private",
        S3_ACCESS_KEY_ID: "preview-storage-key",
        S3_SECRET_ACCESS_KEY: "preview-storage-secret",
        REDIS_URL: "rediss://redis.example:6379",
        CLAMAV_HOST: "scanner.internal"
      })
    ).toMatchObject({
      appEnvironment: "preview",
      appBaseUrl: "https://nexus-preview.vercel.app"
    });
  });

  it("rejects invalid enumerations without echoing their values", () => {
    expect(() => parseServerEnvironment({ APP_ENV: "unknown", LOG_LEVEL: "verbose" })).toThrow(
      EnvironmentConfigurationError
    );

    try {
      parseServerEnvironment({ APP_ENV: "unknown", LOG_LEVEL: "verbose" });
    } catch (error) {
      expect(error).toBeInstanceOf(EnvironmentConfigurationError);
      expect(String(error)).not.toContain("unknown");
      expect(String(error)).not.toContain("verbose");
    }
  });

  it("requires HTTPS and an explicit origin for deployed environments", () => {
    expect(() =>
      parseServerEnvironment({
        APP_ENV: "production",
        APP_BASE_URL: "http://nexus.example/path",
        DATABASE_URL: "postgresql://nexus:secret@database.example/nexus?sslmode=require",
        BETTER_AUTH_SECRET: "production-auth-secret-with-at-least-32-characters",
        SMTP_HOST: "smtp.example",
        SMTP_FROM: "NEXUS AI <noreply@nexus.example>"
      })
    ).toThrow(/without a path/);

    expect(() => parseServerEnvironment({ APP_ENV: "staging" })).toThrow(
      /required outside local\/test/
    );
  });

  it("rejects plaintext production database, object storage, and Redis endpoints", () => {
    const production = {
      APP_ENV: "production",
      APP_BASE_URL: "https://nexus.example",
      RELEASE_VERSION: "release-2026-11-08",
      DATABASE_URL: "postgresql://nexus:secret@database.example/nexus",
      BETTER_AUTH_SECRET: "production-auth-secret-with-at-least-32-characters",
      MONITORING_TOKEN: "production-monitoring-token-with-at-least-32-characters",
      ERROR_REPORTING_ENDPOINT: "http://errors.example/v1/events",
      ERROR_REPORTING_TOKEN: "production-error-token-with-at-least-32-characters",
      SMTP_HOST: "smtp.example",
      SMTP_FROM: "NEXUS AI <noreply@nexus.example>",
      OPENAI_API_KEY: "production-openai-api-key",
      S3_ENDPOINT: "http://objects.example",
      S3_REGION: "us-east-1",
      S3_BUCKET: "nexus-private",
      S3_ACCESS_KEY_ID: "production-storage-key",
      S3_SECRET_ACCESS_KEY: "production-storage-secret",
      REDIS_URL: "redis://redis.example:6379",
      CLAMAV_HOST: "scanner.internal"
    };

    expect(() => parseServerEnvironment(production)).toThrow(/DATABASE_URL must require TLS/);
    expect(() => parseServerEnvironment(production)).toThrow(/S3_ENDPOINT must use HTTPS/);
    expect(() => parseServerEnvironment(production)).toThrow(/REDIS_URL must use rediss/);
  });

  it("rejects placeholder secrets and partial SMTP credentials", () => {
    expect(() =>
      parseServerEnvironment({ BETTER_AUTH_SECRET: "replace-with-at-least-32-random-characters" })
    ).toThrow(/placeholder/);

    expect(() => parseServerEnvironment({ SMTP_USER: "mailer" })).toThrow(/configured together/);
  });

  it("never enables the mock provider in a deployed environment or falls back from OpenAI", () => {
    expect(() =>
      parseServerEnvironment({
        APP_ENV: "production",
        APP_BASE_URL: "https://nexus.example",
        DATABASE_URL: "postgresql://nexus:secret@database.example/nexus",
        BETTER_AUTH_SECRET: "production-auth-secret-with-at-least-32-characters",
        SMTP_HOST: "smtp.example",
        SMTP_FROM: "NEXUS AI <noreply@nexus.example>",
        AI_PROVIDER: "mock"
      })
    ).toThrow(/allowed only in local and test/);

    expect(() => parseServerEnvironment({ AI_PROVIDER: "openai" })).toThrow(
      /OPENAI_API_KEY is required/
    );
  });

  it("accepts complete Google and Apple provider credentials", () => {
    const environment = parseServerEnvironment({
      GOOGLE_CLIENT_ID: "google-client-id",
      GOOGLE_CLIENT_SECRET: "google-client-secret",
      APPLE_CLIENT_ID: "com.nexus.web",
      APPLE_TEAM_ID: "APPLETEAM1",
      APPLE_KEY_ID: "APPLEKEY1",
      APPLE_PRIVATE_KEY: "local-test-only-apple-signing-key"
    });

    expect(environment.socialAuth.google?.clientId).toBe("google-client-id");
    expect(environment.socialAuth.apple?.teamId).toBe("APPLETEAM1");
  });

  it("rejects partial social provider credentials without exposing values", () => {
    expect(() => parseServerEnvironment({ GOOGLE_CLIENT_ID: "partial-google-client" })).toThrow(
      /GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET/
    );
    expect(() =>
      parseServerEnvironment({
        APPLE_CLIENT_ID: "partial-apple-client",
        APPLE_TEAM_ID: "partial-apple-team",
        APPLE_KEY_ID: "partial-apple-key"
      })
    ).toThrow(/must be configured together/);
  });
});
