import { describe, expect, it } from "vitest";

import {
  DeploymentConfigurationError,
  validateDeploymentEnvironment
} from "@/platform/deployment/validation";
import { hasValidBearerToken } from "@/platform/http/bearer-token";
import { sanitizeLogValue } from "@/platform/observability/logger";

describe("deployment controls", () => {
  it("accepts a secret-safe production container contract", () => {
    const result = validateDeploymentEnvironment(productionEnvironment());

    expect(result.platform).toBe("container");
    expect(result.environment.appEnvironment).toBe("production");
    expect(result.environment.storage).not.toHaveProperty("accessKeyId");
    expect(result.warnings).toEqual([]);
  });

  it("rejects public secret variables and insecure migration transport", () => {
    expect(() =>
      validateDeploymentEnvironment({
        ...productionEnvironment(),
        NEXT_PUBLIC_OPENAI_API_KEY: "must-never-be-public",
        DIRECT_URL: "postgresql://nexus:secret@database.example/nexus"
      })
    ).toThrow(DeploymentConfigurationError);

    try {
      validateDeploymentEnvironment({
        ...productionEnvironment(),
        NEXT_PUBLIC_OPENAI_API_KEY: "must-never-be-public",
        DIRECT_URL: "postgresql://nexus:secret@database.example/nexus"
      });
    } catch (error) {
      expect(String(error)).not.toContain("must-never-be-public");
      expect(String(error)).not.toContain("nexus:secret");
    }
  });

  it("redacts secret fields and compares monitoring credentials safely", () => {
    expect(
      sanitizeLogValue({
        requestId: "request-1",
        password: "correct horse battery staple",
        nested: { authorization: "Bearer secret", count: 2 }
      })
    ).toEqual({
      requestId: "request-1",
      password: "[REDACTED]",
      nested: { authorization: "[REDACTED]", count: 2 }
    });

    const request = new Request("https://nexus.example/api/v1/health/dependencies", {
      headers: { Authorization: "Bearer monitoring-token-with-at-least-32-characters" }
    });
    expect(hasValidBearerToken(request, "monitoring-token-with-at-least-32-characters")).toBe(true);
    expect(
      hasValidBearerToken(request, "different-monitoring-token-with-at-least-32-characters")
    ).toBe(false);
  });
});

function productionEnvironment() {
  return {
    NODE_ENV: "production",
    APP_ENV: "production",
    APP_BASE_URL: "https://nexus.example",
    DEPLOYMENT_PLATFORM: "container",
    RELEASE_VERSION: "release-123",
    DATABASE_URL: "postgresql://nexus:secret@pool.example/nexus?sslmode=verify-full",
    DIRECT_URL: "postgresql://nexus:secret@primary.example/nexus?sslmode=verify-full",
    BETTER_AUTH_SECRET: "production-auth-secret-with-at-least-32-characters",
    MONITORING_TOKEN: "production-monitoring-token-with-at-least-32-characters",
    SMTP_HOST: "smtp.example",
    SMTP_FROM: "NEXUS AI <noreply@nexus.example>",
    OPENAI_API_KEY: "production-openai-api-key",
    S3_REGION: "us-east-1",
    S3_BUCKET: "nexus-production-private",
    S3_FORCE_PATH_STYLE: "false",
    REDIS_URL: "rediss://redis.example:6379",
    CLAMAV_HOST: "scanner.internal",
    ERROR_REPORTING_ENDPOINT: "https://errors.example/v1/events",
    ERROR_REPORTING_TOKEN: "production-error-token-with-at-least-32-characters"
  } as const;
}
