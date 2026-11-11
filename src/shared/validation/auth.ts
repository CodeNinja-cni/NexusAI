import { z } from "zod";

const COMMON_PASSWORDS = new Set([
  "111111",
  "123123",
  "123456",
  "123456789012345",
  "abc123",
  "correcthorsebatterystaple",
  "letmein",
  "letmeinletmeinletmein",
  "password",
  "passwordpassword",
  "qwerty",
  "qwertyqwertyqwerty"
]);

export const displayNameSchema = z
  .string()
  .trim()
  .min(2, "Name must contain at least 2 characters.")
  .max(120, "Name must contain at most 120 characters.")
  .transform((value) => value.normalize("NFKC"));

export const emailSchema = z
  .string()
  .trim()
  .max(320, "Email must contain at most 320 characters.")
  .pipe(z.email("Enter a valid email address."))
  .transform((value) => value.trim().toLowerCase());

export const passwordSchema = z
  .string()
  .min(6, "Password must contain at least 6 characters.")
  .max(128, "Password must contain at most 128 characters.")
  .refine(
    (value) => !COMMON_PASSWORDS.has(value.normalize("NFKC").toLowerCase()),
    "Choose a less common password."
  );

export const registrationSchema = z.object({
  name: displayNameSchema,
  email: emailSchema,
  password: passwordSchema
});

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Enter your password.").max(128, "Password is too long.")
});

const profileImageSchema = z
  .url("Image must be a valid URL.")
  .max(2048, "Image URL is too long.")
  .refine((value) => ["http:", "https:"].includes(new URL(value).protocol), {
    message: "Image URL must use HTTP or HTTPS."
  });

export const profileUpdateSchema = z
  .object({
    name: displayNameSchema.optional(),
    image: profileImageSchema.nullable().optional()
  })
  .strict()
  .refine((value) => value.name !== undefined || value.image !== undefined, {
    message: "Provide at least one profile field."
  });
