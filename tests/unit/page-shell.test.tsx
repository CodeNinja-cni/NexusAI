import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { PageShell } from "@/components/layout/page-shell";

describe("PageShell", () => {
  it("renders children and forwards accessible container attributes", () => {
    const markup = renderToStaticMarkup(
      <PageShell aria-label="Test shell" data-testid="page-shell">
        Foundation content
      </PageShell>
    );

    expect(markup).toContain("Foundation content");
    expect(markup).toContain('aria-label="Test shell"');
    expect(markup).toContain('data-testid="page-shell"');
  });
});
