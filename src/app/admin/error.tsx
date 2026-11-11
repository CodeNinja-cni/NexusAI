"use client";

import { ErrorState } from "@/components/feedback/error-state";
import { Button } from "@/components/ui/button";

export default function AdminError({ reset }: { readonly reset: () => void }) {
  return (
    <ErrorState
      title="The administration console could not load"
      description="No platform state was changed. Retry the protected request."
      action={<Button onClick={reset}>Retry</Button>}
    />
  );
}
