import { expect, test } from "@playwright/test";

test.describe("Application foundation", () => {
  test("serves the application shell", async ({ request }) => {
    const response = await request.get("/");
    const body = await response.text();

    expect(response.ok()).toBe(true);
    expect(body).toContain("Your work deserves a");
    expect(body).toContain("Create your workspace");
    expect(response.headers()["x-content-type-options"]).toBe("nosniff");
    expect(response.headers()["x-frame-options"]).toBe("DENY");
    expect(response.headers()["referrer-policy"]).toBe("strict-origin-when-cross-origin");
    expect(response.headers()["cross-origin-opener-policy"]).toBe("same-origin");
    expect(response.headers()["cross-origin-resource-policy"]).toBe("same-origin");
    expect(response.headers()["strict-transport-security"]).toBe("max-age=63072000");
    expect(response.headers()["access-control-allow-origin"]).toBeUndefined();
  });

  test("exposes minimal operational health contracts", async ({ request }) => {
    for (const path of ["/api/v1/health/live", "/api/v1/health/ready"]) {
      const response = await request.get(path);

      expect(response.status(), path).toBe(200);
      expect(await response.json(), path).toEqual({ data: { status: "ok" } });
      expect(response.headers()["cache-control"], path).toBe("no-store");
    }

    const hiddenDependencies = await request.get("/api/v1/health/dependencies");
    expect(hiddenDependencies.status()).toBe(404);

    const dependencies = await request.get("/api/v1/health/dependencies", {
      headers: {
        Authorization: "Bearer local-only-monitoring-token-change-before-deploying"
      }
    });
    expect(dependencies.status()).toBe(200);
    expect(await dependencies.json()).toMatchObject({
      data: {
        status: "ok",
        dependencies: {
          database: { status: "ok" },
          queue: { status: "skipped" },
          storage: { status: "ok" },
          scanner: { status: "skipped" }
        }
      }
    });
    expect(dependencies.headers()["cache-control"]).toBe("private, no-store");
    expect(
      dependencies
        .headers()
        .vary?.split(",")
        .map((value) => value.trim().toLowerCase())
    ).toContain("authorization");
  });
});
