import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DOCUMENT_DOWNLOAD_GRANT_SECONDS,
  DOCUMENT_UPLOAD_GRANT_SECONDS
} from "@/modules/documents/server/document-service";
import { conversationListQuerySchema } from "@/modules/chat/server/validation";
import { documentListQuerySchema } from "@/modules/documents/server/validation";
import { usageSummaryQuerySchema } from "@/modules/usage/server/validation";
import { internalProblemResponse } from "@/platform/http/problem";

describe("production-readiness controls", () => {
  afterEach(() => vi.restoreAllMocks());

  it("keeps document bearer grants inside the approved windows", () => {
    expect(DOCUMENT_UPLOAD_GRANT_SECONDS).toBe(300);
    expect(DOCUMENT_DOWNLOAD_GRANT_SECONDS).toBe(60);
  });

  it("rejects unknown query parameters instead of silently discarding them", () => {
    expect(conversationListQuerySchema.safeParse({ unexpected: "value" }).success).toBe(false);
    expect(documentListQuerySchema.safeParse({ unexpected: "value" }).success).toBe(false);
    expect(
      usageSummaryQuerySchema.safeParse({
        workspaceId: "d48d7e7b-95c9-42a7-a52d-284ad9fd2df2",
        unexpected: "value"
      }).success
    ).toBe(false);
  });

  it("returns a correlation-safe problem without exposing the thrown diagnostic", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = internalProblemResponse("/api/v1/test", "request-123", "test-api");

    expect(response.status).toBe(500);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-request-id")).toBe("request-123");
    expect(await response.json()).toEqual({
      type: "https://nexus.local/problems/internal-error",
      title: "Request failed",
      status: 500,
      detail: "The request could not be completed safely.",
      instance: "/api/v1/test",
      code: "internal_error",
      requestId: "request-123"
    });
    expect(console.error).toHaveBeenCalledOnce();
    expect(String(vi.mocked(console.error).mock.calls[0]?.[0])).toContain(
      '"event":"api.request.failed"'
    );
    expect(String(vi.mocked(console.error).mock.calls[0]?.[0])).not.toContain("diagnostic");
  });
});
