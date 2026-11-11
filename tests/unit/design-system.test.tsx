import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Plus } from "lucide-react";

import { EmptyState } from "@/components/feedback/empty-state";
import { SocialAuthButtons } from "@/modules/auth/components/social-auth-buttons";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { FormField, SelectField, TextAreaField } from "@/components/ui/form-field";
import { Icon } from "@/components/ui/icon";
import { PasswordField } from "@/components/ui/password-field";

describe("NEXUS design system primitives", () => {
  it("renders button state without losing its accessible name", () => {
    const markup = renderToStaticMarkup(
      <Button loading loadingLabel="Creating item" leadingIcon={<Icon icon={Plus} />}>
        Create item
      </Button>
    );

    expect(markup).toContain("Creating item");
    expect(markup).toContain('aria-busy="true"');
    expect(markup).toContain("disabled");
  });

  it("associates labels, descriptions, and validation errors with form controls", () => {
    const markup = renderToStaticMarkup(
      <>
        <FormField id="name" label="Name" hint="Shown to members." />
        <TextAreaField id="summary" label="Summary" error="A summary is required." />
        <SelectField id="scope" label="Scope">
          <option>Workspace</option>
        </SelectField>
      </>
    );

    expect(markup).toContain('for="name"');
    expect(markup).toContain('aria-describedby="name-description"');
    expect(markup).toContain('aria-invalid="true"');
    expect(markup).toContain('role="alert"');
    expect(markup).toContain('for="scope"');
  });

  it("renders an accessible password visibility control", () => {
    const markup = renderToStaticMarkup(
      <PasswordField id="password" label="Password" autoComplete="current-password" />
    );

    expect(markup).toContain('type="password"');
    expect(markup).toContain('aria-label="Show password"');
    expect(markup).toContain('aria-pressed="false"');
  });

  it("renders honest Google and Apple availability states", () => {
    const markup = renderToStaticMarkup(
      <SocialAuthButtons availability={{ google: false, apple: false }} mode="login" />
    );

    expect(markup).toContain("Continue with Google");
    expect(markup).toContain("Continue with Apple");
    expect(markup.match(/disabled/g)).toHaveLength(2);
    expect(markup).toContain("after provider credentials are configured");
  });

  it("renders semantic surface and empty-state content", () => {
    const markup = renderToStaticMarkup(
      <>
        <Card>
          <CardHeader title="Workspace" />
          <CardBody>Private workspace details</CardBody>
        </Card>
        <EmptyState title="No documents" description="Upload a source when you are ready." />
      </>
    );

    expect(markup).toContain("<article");
    expect(markup).toContain("Workspace");
    expect(markup).toContain("No documents");
  });
});
