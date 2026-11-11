export const dynamic = "force-dynamic";

export function GET() {
  return Response.json(
    { data: { status: "ok" } },
    {
      headers: {
        "Cache-Control": "no-store"
      }
    }
  );
}
