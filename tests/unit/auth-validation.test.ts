import { describe, expect, it } from "vitest";

import {
  emailSchema,
  passwordSchema,
  profileUpdateSchema,
  registrationSchema
} from "@/shared/validation/auth";

describe("authentication request validation", () => {
  it("normalizes safe registration fields", () => {
    expect(
      registrationSchema.parse({
        name: "  Ada Lovelace  ",
        email: " ADA@Example.COM ",
        password: "a unique analytical engine passphrase"
      })
    ).toEqual({
      name: "Ada Lovelace",
      email: "ada@example.com",
      password: "a unique analytical engine passphrase"
    });
  });

  it("enforces the six-character boundary and rejects known-compromised passwords", () => {
    expect(passwordSchema.safeParse("five5").success).toBe(false);
    expect(passwordSchema.safeParse("six-ok").success).toBe(true);
    expect(passwordSchema.safeParse("123456").success).toBe(false);
    expect(passwordSchema.safeParse("passwordpassword").success).toBe(false);
  });

  it("bounds email and profile inputs", () => {
    expect(emailSchema.safeParse("not-an-email").success).toBe(false);
    expect(profileUpdateSchema.safeParse({}).success).toBe(false);
    expect(profileUpdateSchema.safeParse({ unexpected: true }).success).toBe(false);
    expect(profileUpdateSchema.safeParse({ image: "javascript:alert(1)" }).success).toBe(false);
    expect(
      profileUpdateSchema.safeParse({ name: "Grace Hopper", image: "https://example.com/a.png" })
        .success
    ).toBe(true);
  });
});
