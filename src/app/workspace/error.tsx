"use client";

import { ErrorState } from "@/components/feedback/error-state";
import { Button } from "@/components/ui/button";

export default function WorkspaceError({ retry }: { readonly retry: () => void }) {
  return (
    <ErrorState
      title="Workspace controls are unavailable"
      description="The workspace data could not be loaded safely."
      action={<Button onClick={retry}>Try again</Button>}
    />
  );
}
