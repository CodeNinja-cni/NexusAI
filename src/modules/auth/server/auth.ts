import "server-only";

import { randomUUID } from "node:crypto";

import { prismaAdapter } from "@better-auth/prisma-adapter";
import { betterAuth } from "better-auth/minimal";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { getSessionCookie } from "better-auth/cookies";
import { twoFactor } from "better-auth/plugins";
import { importPKCS8, SignJWT } from "jose";
import { after } from "next/server";

import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/platform/database/prisma";
import { getServerEnvironment } from "@/platform/env/server";
import { queueAuthEmail } from "@/platform/mail/auth-email";
import { logger } from "@/platform/observability/logger";
import {
  provisionPersonalWorkspace,
  requestPersonalWorkspaceProvisioning
} from "@/modules/workspaces/server/provision-personal-workspace";
import { passwordSchema, registrationSchema } from "@/shared/validation/auth";
import { createNotification } from "@/modules/notifications/server/service";

const environment = getServerEnvironment();
const secureCookies =
  environment.appEnvironment !== "local" && environment.appEnvironment !== "test";

const socialProviders = {
  ...(environment.socialAuth.google
    ? {
        google: {
          clientId: environment.socialAuth.google.clientId,
          clientSecret: environment.socialAuth.google.clientSecret,
          disableImplicitSignUp: true
        }
      }
    : {}),
  ...(environment.socialAuth.apple
    ? {
        apple: async () => {
          const apple = environment.socialAuth.apple!;
          const privateKey = await importPKCS8(apple.privateKey.replaceAll("\\n", "\n"), "ES256");
          const now = Math.floor(Date.now() / 1000);
          const clientSecret = await new SignJWT({})
            .setProtectedHeader({ alg: "ES256", kid: apple.keyId })
            .setIssuer(apple.teamId)
            .setSubject(apple.clientId)
            .setAudience("https://appleid.apple.com")
            .setIssuedAt(now)
            .setExpirationTime(now + 180 * 24 * 60 * 60)
            .sign(privateKey);

          return { clientId: apple.clientId, clientSecret, disableImplicitSignUp: true };
        }
      }
    : {})
};

async function isRegistrationClosed(): Promise<boolean> {
  const registrationPolicy = await prisma.platformSetting.findUnique({
    where: { key: "user_registration" },
    select: { value: true }
  });
  const policy = registrationPolicy?.value;
  return Boolean(
    policy && !Array.isArray(policy) && typeof policy === "object" && policy.mode === "CLOSED"
  );
}

function requestsSocialRegistration(body: unknown): boolean {
  return (
    Boolean(body) &&
    typeof body === "object" &&
    (body as Record<string, unknown>).requestSignUp === true
  );
}

function requestId(request: Request | undefined) {
  const suppliedRequestId = request?.headers.get("x-request-id")?.trim();
  return suppliedRequestId && suppliedRequestId.length <= 128 ? suppliedRequestId : randomUUID();
}

function assertGeneratedAuthUrl(value: string): string {
  const url = new URL(value);
  const configuredOrigin = new URL(environment.appBaseUrl).origin;
  if (url.origin !== configuredOrigin || !url.pathname.startsWith("/api/auth/")) {
    throw new Error("Auth email URL did not match the configured auth origin.");
  }
  return url.toString();
}

function passwordFromBody(body: unknown): string | undefined {
  if (!body || typeof body !== "object") return undefined;
  const record = body as Record<string, unknown>;
  const password = record.password ?? record.newPassword;
  return typeof password === "string" ? password : undefined;
}

async function writeAuthAudit(data: Prisma.AuditLogUncheckedCreateInput): Promise<void> {
  try {
    await prisma.auditLog.create({ data });
  } catch {
    // Auth completion must not leave a user/session half-created because a secondary audit write
    // failed. Provisioning and product mutations use same-transaction audit writes instead.
    logger.error("auth.audit.write_failed");
  }
}

export const auth = betterAuth({
  appName: "NEXUS AI",
  baseURL: environment.appBaseUrl,
  basePath: "/api/auth",
  secret: environment.betterAuthSecret,
  trustedOrigins: [
    ...new Set([
      ...environment.trustedOrigins,
      ...(environment.socialAuth.apple ? ["https://appleid.apple.com"] : [])
    ])
  ],
  socialProviders,
  account: {
    encryptOAuthTokens: true,
    accountLinking: {
      enabled: true,
      disableImplicitLinking: true,
      requireLocalEmailVerified: true,
      allowDifferentEmails: false,
      updateUserInfoOnLink: false
    }
  },
  database: prismaAdapter(prisma, {
    provider: "postgresql",
    transaction: true
  }),
  plugins: [
    twoFactor({
      issuer: "NEXUS AI",
      trustDeviceMaxAge: 0,
      accountLockout: { enabled: true, maxFailedAttempts: 5, durationSeconds: 15 * 60 },
      backupCodeOptions: { amount: 10, length: 12, storeBackupCodes: "encrypted" }
    })
  ],
  emailAndPassword: {
    enabled: true,
    autoSignIn: false,
    requireEmailVerification: true,
    minPasswordLength: 6,
    maxPasswordLength: 128,
    resetPasswordTokenExpiresIn: 30 * 60,
    revokeSessionsOnPasswordReset: true,
    sendResetPassword: ({ user, url }) =>
      queueAuthEmail({
        template: "RESET_PASSWORD",
        to: user.email,
        name: user.name,
        url: assertGeneratedAuthUrl(url)
      })
  },
  emailVerification: {
    expiresIn: 24 * 60 * 60,
    sendOnSignUp: true,
    sendOnSignIn: true,
    autoSignInAfterVerification: false,
    sendVerificationEmail: ({ user, url }) =>
      queueAuthEmail({
        template: "VERIFY_EMAIL",
        to: user.email,
        name: user.name,
        url: assertGeneratedAuthUrl(url)
      }),
    beforeEmailVerification: async (user) => {
      await requestPersonalWorkspaceProvisioning(user.id);
    },
    afterEmailVerification: async (user, request) => {
      await provisionPersonalWorkspace(user.id, requestId(request));
    }
  },
  user: {
    validateUserInfo: async ({ source }) => {
      if (source.action !== "create-user" || !(await isRegistrationClosed())) return;
      return {
        error: "REGISTRATION_CLOSED",
        errorDescription: "Registration is currently closed."
      };
    },
    additionalFields: {
      platformRole: {
        type: "string",
        required: true,
        defaultValue: "USER",
        input: false
      },
      status: {
        type: "string",
        required: true,
        defaultValue: "ACTIVE",
        input: false
      },
      suspendedAt: { type: "date", required: false, input: false },
      deletionRequestedAt: { type: "date", required: false, input: false },
      deletedAt: { type: "date", required: false, input: false },
      version: { type: "number", required: true, defaultValue: 1, input: false }
    }
  },
  verification: {
    storeIdentifier: "hashed"
  },
  session: {
    expiresIn: 7 * 24 * 60 * 60,
    disableSessionRefresh: true,
    freshAge: 10 * 60,
    cookieCache: { enabled: false },
    additionalFields: {
      mfaVerifiedAt: { type: "date", required: false, input: false }
    }
  },
  rateLimit: {
    enabled: true,
    storage: "database",
    window: 60,
    max: 120,
    customRules: {
      "/sign-in/email": { window: 15 * 60, max: 5 },
      "/sign-in/social": { window: 15 * 60, max: 20 },
      "/sign-up/email": { window: 60 * 60, max: 5 },
      "/send-verification-email": { window: 60 * 60, max: 3 },
      "/request-password-reset": { window: 60 * 60, max: 3 },
      "/reset-password": { window: 15 * 60, max: 5 }
    }
  },
  hooks: {
    before: createAuthMiddleware(async (context) => {
      const requestsRegistration =
        context.path === "/sign-up/email" ||
        (context.path === "/sign-in/social" && requestsSocialRegistration(context.body));
      if (requestsRegistration && (await isRegistrationClosed())) {
        throw new APIError("FORBIDDEN", {
          code: "REGISTRATION_CLOSED",
          message: "Registration is currently closed."
        });
      }

      if (context.path === "/two-factor/disable") {
        const token = context.request
          ? getSessionCookie(context.request, { cookiePrefix: "nexus" })
          : null;
        const session = token
          ? await prisma.session.findUnique({
              where: { token },
              select: { user: { select: { platformRole: true } } }
            })
          : null;
        if (session?.user.platformRole === "ADMIN") {
          throw new APIError("FORBIDDEN", {
            code: "ADMIN_MFA_REQUIRED",
            message: "Platform administrators cannot disable multi-factor authentication."
          });
        }
      }

      if (context.path === "/sign-up/email") {
        const registration = registrationSchema.safeParse(context.body);
        if (!registration.success) {
          throw new APIError("UNPROCESSABLE_ENTITY", {
            code: "VALIDATION_ERROR",
            message: registration.error.issues[0]?.message ?? "Registration details are invalid."
          });
        }
        Object.assign(context.body as Record<string, unknown>, registration.data);
      }

      const password = passwordFromBody(context.body);
      if (
        password &&
        ["/sign-up/email", "/reset-password", "/change-password", "/set-password"].includes(
          context.path
        ) &&
        !passwordSchema.safeParse(password).success
      ) {
        throw new APIError("UNPROCESSABLE_ENTITY", {
          code: "PASSWORD_POLICY_VIOLATION",
          message: "Choose a password that meets the published password policy."
        });
      }
    }),
    after: createAuthMiddleware(async (context) => {
      if (
        [
          "/two-factor/verify-totp",
          "/two-factor/verify-backup-code",
          "/two-factor/generate-backup-codes",
          "/two-factor/disable"
        ].includes(context.path)
      ) {
        const userId = context.context.session?.user.id ?? context.context.newSession?.user.id;
        if (userId) {
          const sessionId = context.context.session?.session.id;
          if (
            sessionId &&
            ["/two-factor/verify-totp", "/two-factor/verify-backup-code"].includes(context.path)
          ) {
            await prisma.session.updateMany({
              where: { id: sessionId, userId },
              data: { mfaVerifiedAt: new Date() }
            });
          }
          await writeAuthAudit({
            actorUserId: userId,
            actorKind: "USER",
            action:
              context.path === "/two-factor/disable"
                ? "mfa.disabled"
                : context.path === "/two-factor/generate-backup-codes"
                  ? "mfa.recovery_codes.rotated"
                  : "mfa.verified",
            targetType: "user",
            targetId: userId,
            outcome: "SUCCEEDED",
            requestId: requestId(context.request),
            metadata: {
              method: context.path.includes("backup-code") ? "RECOVERY_CODE" : "TOTP"
            }
          });
        }
      }

      if (context.path !== "/change-password") return;
      const userId = context.context.session?.user.id ?? context.context.newSession?.user.id;
      if (!userId) return;
      const securityRequestId = requestId(context.request);
      try {
        await prisma.$transaction(async (transaction) => {
          await createNotification(transaction, {
            userId,
            type: "SYSTEM_ALERT",
            title: "Password changed",
            body: "Your NEXUS AI password was changed and other sessions were revoked.",
            actionUrl: "/settings/security",
            data: { event: "PASSWORD_CHANGED" },
            eventKey: `password-changed:${userId}:${securityRequestId}`
          });
          await transaction.auditLog.create({
            data: {
              actorUserId: userId,
              actorKind: "USER",
              action: "password.changed",
              targetType: "user",
              targetId: userId,
              outcome: "SUCCEEDED",
              requestId: securityRequestId,
              metadata: { otherSessionsRevoked: true }
            }
          });
        });
      } catch {
        logger.error("auth.security_event.write_failed");
      }
    })
  },
  databaseHooks: {
    account: {
      create: {
        before: async (account) => {
          if (!("accessToken" in account || "refreshToken" in account || "idToken" in account)) {
            return;
          }
          return {
            data: {
              ...account,
              accessToken: null,
              refreshToken: null,
              idToken: null,
              accessTokenExpiresAt: null,
              refreshTokenExpiresAt: null
            }
          };
        }
      },
      update: {
        before: async (account) => {
          if (!("accessToken" in account || "refreshToken" in account || "idToken" in account)) {
            return;
          }
          return {
            data: {
              ...account,
              accessToken: null,
              refreshToken: null,
              idToken: null,
              accessTokenExpiresAt: null,
              refreshTokenExpiresAt: null
            }
          };
        }
      }
    },
    user: {
      create: {
        after: async (user, context) => {
          const registrationRequestId = requestId(context?.request);
          if (user.emailVerified) {
            await requestPersonalWorkspaceProvisioning(user.id);
            await provisionPersonalWorkspace(user.id, registrationRequestId);
          }
          await writeAuthAudit({
            actorUserId: user.id,
            actorKind: "USER",
            action: "account.registered",
            targetType: "user",
            targetId: user.id,
            outcome: "SUCCEEDED",
            requestId: registrationRequestId,
            metadata: {}
          });
        }
      },
      update: {
        before: async (data) => {
          if (data.twoFactorEnabled !== false || !data.id) return;
          const current = await prisma.user.findUnique({
            where: { id: data.id },
            select: { platformRole: true }
          });
          if (current?.platformRole === "ADMIN") {
            throw new APIError("FORBIDDEN", {
              code: "ADMIN_MFA_REQUIRED",
              message: "Platform administrators cannot disable multi-factor authentication."
            });
          }
        }
      }
    },
    session: {
      create: {
        before: async (session) => {
          const user = await prisma.user.findUnique({
            where: { id: session.userId },
            select: { status: true, deletedAt: true }
          });
          return user?.status === "ACTIVE" && !user.deletedAt;
        },
        after: async (session, context) => {
          const mfaUser = await prisma.user.findUnique({
            where: { id: session.userId },
            select: { twoFactorEnabled: true }
          });
          if (mfaUser?.twoFactorEnabled) {
            await prisma.session.update({
              where: { id: session.id },
              data: { mfaVerifiedAt: new Date() }
            });
          }
          await writeAuthAudit({
            actorUserId: session.userId,
            actorKind: "USER",
            action: "session.created",
            targetType: "session",
            targetId: session.id,
            outcome: "SUCCEEDED",
            requestId: requestId(context?.request),
            metadata: {}
          });
        }
      },
      delete: {
        after: async (session, context) => {
          await writeAuthAudit({
            actorUserId: session.userId,
            actorKind: "USER",
            action: "session.revoked",
            targetType: "session",
            targetId: session.id,
            outcome: "SUCCEEDED",
            requestId: requestId(context?.request),
            metadata: {}
          });
        }
      }
    }
  },
  advanced: {
    useSecureCookies: secureCookies,
    cookiePrefix: "nexus",
    defaultCookieAttributes: {
      httpOnly: true,
      secure: secureCookies,
      sameSite: "lax",
      path: "/"
    },
    database: {
      joins: true,
      validateSchema: true
    },
    backgroundTasks: {
      handler: (promise) => {
        after(async () => promise);
      }
    }
  },
  logger: {
    level: "error",
    log: (level) => {
      logger.error("auth.request.failed", { providerLevel: level });
    }
  },
  telemetry: { enabled: false }
});

export type AuthSession = typeof auth.$Infer.Session;
