export interface SocialAuthAvailability {
  readonly google: boolean;
  readonly apple: boolean;
}

export type SocialAuthMode = "login" | "register";
