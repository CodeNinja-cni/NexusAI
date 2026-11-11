import { getServerEnvironment } from "@/platform/env/server";
import { getObjectStorage } from "@/platform/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { readonly params: Promise<{ token: string }> };

export async function PUT(request: Request, context: Context) {
  const environment = getServerEnvironment();
  if (environment.storage.driver !== "filesystem" || environment.appEnvironment !== "test") {
    return new Response(null, { status: 404 });
  }
  const declaredLength = Number(request.headers.get("content-length"));
  if (
    !Number.isSafeInteger(declaredLength) ||
    declaredLength < 0 ||
    declaredLength > environment.documents.maxBytes
  ) {
    return new Response(null, { status: 413 });
  }
  try {
    const bytes = new Uint8Array(await request.arrayBuffer());
    if (bytes.byteLength > environment.documents.maxBytes) {
      return new Response(null, { status: 413 });
    }
    const storage = getObjectStorage();
    if (!storage.acceptTestUpload) return new Response(null, { status: 404 });
    await storage.acceptTestUpload(
      (await context.params).token,
      request.headers.get("content-type"),
      bytes
    );
    return new Response(null, { status: 204 });
  } catch {
    return new Response(null, { status: 403 });
  }
}
