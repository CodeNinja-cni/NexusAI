"use client";

import { ErrorState } from "@/components/feedback/error-state";
import { Button } from "@/components/ui/button";

export default function WorkflowsError({ reset }: { readonly reset: () => void }) {
  return (
    <div style={{ padding: "3rem" }}>
      <ErrorState
        title="Workflow studio unavailable"
        description="The workflow records could not be loaded. No execution state was changed."
        action={<Button onClick={reset}>Try again</Button>}
      />
    </div>
  );
}
