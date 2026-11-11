"use client";

import { ErrorState } from "@/components/feedback/error-state";
import { Button } from "@/components/ui/button";

export default function NotificationsError({ reset }: { readonly reset: () => void }) {
  return (
    <ErrorState
      title="Notifications did not load"
      description="Your notification history remains stored. Try loading it again."
      action={<Button onClick={reset}>Try again</Button>}
    />
  );
}
