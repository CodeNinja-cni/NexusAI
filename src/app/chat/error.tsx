"use client";

import { ErrorState } from "@/components/feedback/error-state";
import { Button } from "@/components/ui/button";

export default function ChatError({ reset }: { readonly reset: () => void }) {
  return (
    <div style={{ padding: "3rem" }}>
      <ErrorState
        title="The conversation studio could not load"
        description="The persisted records are unchanged. Retry this view or return to conversations."
        action={<Button onClick={reset}>Retry</Button>}
      />
    </div>
  );
}
