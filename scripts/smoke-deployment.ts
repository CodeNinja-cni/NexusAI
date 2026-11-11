export {};

const configuredBaseUrl = process.env.DEPLOYMENT_SMOKE_BASE_URL?.trim();
if (!configuredBaseUrl) throw new Error("DEPLOYMENT_SMOKE_BASE_URL is required.");

const baseUrl = new URL(configuredBaseUrl);
const localTarget = baseUrl.hostname === "localhost" || baseUrl.hostname === "127.0.0.1";
if (!localTarget && baseUrl.protocol !== "https:") {
  throw new Error("Remote deployment smoke tests require HTTPS.");
}
if (baseUrl.pathname !== "/" || baseUrl.search || baseUrl.hash) {
  throw new Error("DEPLOYMENT_SMOKE_BASE_URL must be an origin without a path.");
}

const live = await request("/api/v1/health/live");
assertStatus(live, 200, "liveness");
const ready = await request("/api/v1/health/ready");
assertStatus(ready, 200, "readiness");
const home = await request("/");
assertStatus(home, 200, "home page");

for (const [name, expected] of [
  ["x-content-type-options", "nosniff"],
  ["x-frame-options", "DENY"],
  ["referrer-policy", "strict-origin-when-cross-origin"],
  ["cross-origin-opener-policy", "same-origin"],
  ["cross-origin-resource-policy", "same-origin"]
] as const) {
  if (home.headers.get(name) !== expected) throw new Error(`Missing expected ${name} header.`);
}
if (!localTarget && !home.headers.get("strict-transport-security")) {
  throw new Error("Remote deployment is missing Strict-Transport-Security.");
}
if (!localTarget && !home.headers.get("content-security-policy")) {
  throw new Error("Remote deployment is missing an enforced Content-Security-Policy.");
}
if (home.headers.get("access-control-allow-origin") === "*") {
  throw new Error("Home page exposes a wildcard CORS policy.");
}

const monitoringToken = process.env.MONITORING_TOKEN?.trim();
let dependencies = "not-requested";
if (monitoringToken) {
  const response = await request("/api/v1/health/dependencies", {
    Authorization: `Bearer ${monitoringToken}`
  });
  assertStatus(response, 200, "runtime dependencies");
  dependencies = "ok";
}

console.info(
  JSON.stringify({
    status: "ok",
    origin: baseUrl.origin,
    live: "ok",
    ready: "ok",
    dependencies,
    securityHeaders: "ok"
  })
);

async function request(path: string, headers: HeadersInit = {}) {
  return fetch(new URL(path, baseUrl), {
    headers,
    redirect: "manual",
    cache: "no-store",
    signal: AbortSignal.timeout(10_000)
  });
}

function assertStatus(response: Response, expected: number, check: string) {
  if (response.status !== expected) {
    throw new Error(`${check} check returned HTTP ${response.status}; expected ${expected}.`);
  }
}
