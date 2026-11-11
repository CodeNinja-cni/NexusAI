import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

describe("local S3-compatible infrastructure", () => {
  it("pins Garage while retaining the legacy MinIO volume", async () => {
    const compose = await read("compose.yaml");

    expect(compose).toContain("image: dxflrs/garage:v2.5.0");
    expect(compose).toContain('["/garage", "server", "--single-node", "--default-bucket"]');
    expect(compose).toContain("GARAGE_DEFAULT_BUCKET: nexus-private");
    expect(compose).toContain('- "9000:3900"');
    expect(compose).toContain("nexus-garage-data:");
    expect(compose).toContain("nexus-minio-data:");
    expect(compose).not.toMatch(/minio\/(?:minio|mc)|minio-init/u);
  });

  it("keeps the application S3 contract and CORS origins stable", async () => {
    const environment = await read(".env.example");
    const cors = JSON.parse(await read("docker/minio/cors.json")) as {
      CORSRules: Array<{ AllowedOrigins: string[]; AllowedMethods: string[] }>;
    };

    expect(environment).toContain("S3_ENDPOINT=http://127.0.0.1:9000");
    expect(environment).toContain("S3_REGION=us-east-1");
    expect(environment).toContain("S3_BUCKET=nexus-private");
    expect(environment).toContain("S3_ACCESS_KEY_ID=nexus-minio");
    expect(environment).toContain("S3_SECRET_ACCESS_KEY=nexus-minio-local-secret");
    expect(environment).toContain("S3_FORCE_PATH_STYLE=true");
    expect(cors.CORSRules).toEqual([
      expect.objectContaining({
        AllowedOrigins: ["http://localhost:3000", "http://127.0.0.1:3000"],
        AllowedMethods: ["PUT", "GET", "HEAD"]
      })
    ]);
  });

  it("exposes the idempotent SDK initialization command", async () => {
    const manifest = JSON.parse(await read("package.json")) as {
      scripts: Record<string, string>;
    };
    expect(manifest.scripts["storage:init"]).toContain("initialize-local-storage.ts");
  });
});

async function read(filename: string) {
  return readFile(resolve(filename), "utf8");
}
