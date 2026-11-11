export const dynamic = "force-dynamic";

import { checkDatabase } from "@/platform/health/dependencies";

export async function GET() {
  try {
    const database = await checkDatabase();
    if (database.status !== "ok") throw new Error("database_unavailable");
    return Response.json({ data: { status: "ok" } }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json(
      { data: { status: "unavailable" } },
      { status: 503, headers: { "Cache-Control": "no-store" } }
    );
  }
}
