"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { authClient } from "@/modules/auth/client";

export function LogoutButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  return (
    <Button
      variant="secondary"
      loading={pending}
      loadingLabel="Signing out"
      leadingIcon={<Icon icon={LogOut} />}
      onClick={async () => {
        setPending(true);
        await authClient.signOut();
        router.push("/auth/login");
        router.refresh();
      }}
    >
      Sign out
    </Button>
  );
}
