import "server-only";

import { getServerEnvironment } from "@/platform/env/server";
import type { SocialAuthAvailability } from "@/modules/auth/social-auth";

export function getSocialAuthAvailability(): SocialAuthAvailability {
  const environment = getServerEnvironment();
  return {
    google: Boolean(environment.socialAuth.google),
    apple: Boolean(environment.socialAuth.apple)
  };
}
