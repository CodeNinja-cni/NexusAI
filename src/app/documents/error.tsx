"use client";

import { ErrorState } from "@/components/feedback/error-state";
import { Button } from "@/components/ui/button";

export default function DocumentsError({ reset }: { readonly reset: () => void }) {
  return (
    <div style={{ padding: "3rem" }}>
      <ErrorState
        title="Document intelligence could not load"
        description="Your private files and database records are unchanged. Retry this view when ready."
        action={<Button onClick={reset}>Retry</Button>}
      />
    </div>
  );
}
