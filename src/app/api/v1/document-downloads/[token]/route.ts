import { getServerEnvironment } from "@/platform/env/server";
import { getObjectStorage } from "@/platform/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { readonly params: Promise<{ token: string }> };

export async function GET(_request: Request, context: Context) {
  const environment = getServerEnvironment();
  if (environment.storage.driver !== "filesystem" || environment.appEnvironment !== "test") {
    return new Response(null, { status: 404 });
  }
  try {
    const storage = getObjectStorage();
    if (!storage.readTestDownload) return new Response(null, { status: 404 });
    const object = await storage.readTestDownload((await context.params).token);
    return new Response(new Uint8Array(object.bytes).buffer, {
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(object.filename)}`,
        "Content-Type": object.contentType,
        "X-Content-Type-Options": "nosniff"
      }
    });
  } catch {
    return new Response(null, { status: 404 });
  }
}
