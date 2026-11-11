export const dynamic = "force-dynamic";

import { getServerEnvironment } from "@/platform/env/server";
import { checkRuntimeDependencies } from "@/platform/health/dependencies";
import { hasValidBearerToken } from "@/platform/http/bearer-token";

export async function GET(request: Request) {
  if (!hasValidBearerToken(request, getServerEnvironment().observability.monitoringToken)) {
    return Response.json(
      {
        type: "https://nexus.local/problems/not-found",
        title: "Not found",
        status: 404,
        code: "not_found"
      },
      { status: 404, headers: noStoreHeaders() }
    );
  }

  const dependencies = await checkRuntimeDependencies();
  const available = Object.values(dependencies).every(
    ({ status }) => status === "ok" || status === "skipped"
  );

  return Response.json(
    {
      data: {
        status: available ? "ok" : "unavailable",
        dependencies
      }
    },
    {
      status: available ? 200 : 503,
      headers: noStoreHeaders()
    }
  );
}

function noStoreHeaders() {
  return {
    "Cache-Control": "private, no-store",
    Vary: "Authorization"
  };
}
