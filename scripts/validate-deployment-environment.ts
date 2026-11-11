import { validateDeploymentEnvironment } from "@/platform/deployment/validation";

const result = validateDeploymentEnvironment(process.env);

console.info(
  JSON.stringify({
    status: "ok",
    environment: result.environment.appEnvironment,
    platform: result.platform,
    service: result.environment.observability.serviceName,
    release: result.environment.observability.releaseVersion,
    origin: result.environment.appBaseUrl,
    databaseTls: true,
    queueTls: true,
    storage: result.environment.storage.endpoint ? "custom-https-endpoint" : "provider-default",
    storageCredentials: result.environment.storage.accessKeyId
      ? "explicit-secret-manager-credentials"
      : "workload-identity",
    errorReporting: result.environment.observability.errorReportingEndpoint
      ? "configured"
      : "disabled",
    warnings: result.warnings
  })
);
