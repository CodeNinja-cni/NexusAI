import { createHmac, randomUUID } from "node:crypto";

import { PrismaPg } from "@prisma/adapter-pg";
import {
  expect,
  request as playwrightRequest,
  test,
  type APIRequestContext
} from "@playwright/test";

import { PrismaClient } from "../../src/generated/prisma/client";

const baseURL = "http://127.0.0.1:3100";
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required for administration integration tests.");
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });

test.describe.configure({ mode: "serial" });

async function context() {
  return playwrightRequest.newContext({
    baseURL,
    extraHTTPHeaders: { Origin: baseURL, "Sec-Fetch-Site": "same-origin" }
  });
}

async function verificationUrl(email: string) {
  await expect
    .poll(async () => {
      const event = await prisma.outboxEvent.findFirst({
        where: { topic: "auth.email.send", payload: { path: ["to"], equals: email } },
        orderBy: { createdAt: "desc" },
        select: { payload: true }
      });
      const payload = event?.payload;
      return payload &&
        !Array.isArray(payload) &&
        typeof payload === "object" &&
        typeof payload.url === "string"
        ? payload.url
        : undefined;
    })
    .toBeTruthy();
  const event = await prisma.outboxEvent.findFirstOrThrow({
    where: { topic: "auth.email.send", payload: { path: ["to"], equals: email } },
    orderBy: { createdAt: "desc" },
    select: { payload: true }
  });
  const payload = event.payload;
  if (
    !payload ||
    Array.isArray(payload) ||
    typeof payload !== "object" ||
    typeof payload.url !== "string"
  )
    throw new Error("Verification event was malformed.");
  return payload.url;
}

async function register(request: APIRequestContext, name: string, email: string, password: string) {
  expect(
    (
      await request.post("/api/auth/sign-up/email", {
        data: { name, email, password, callbackURL: "/auth/verified" }
      })
    ).status()
  ).toBe(200);
  expect((await request.get(await verificationUrl(email))).ok()).toBe(true);
  await expect
    .poll(
      async () =>
        (
          await prisma.user.findUnique({
            where: { email },
            select: { provisioning: { select: { status: true } } }
          })
        )?.provisioning?.status
    )
    .toBe("READY");
  expect(
    (
      await request.post("/api/auth/sign-in/email", {
        data: { email, password, rememberMe: false }
      })
    ).status()
  ).toBe(200);
  return prisma.user.findUniqueOrThrow({ where: { email }, select: { id: true, version: true } });
}

async function enrollTotp(request: APIRequestContext, password: string) {
  const enrollment = await request.post("/api/auth/two-factor/enable", {
    data: { password, method: "totp" }
  });
  expect(enrollment.status()).toBe(200);
  const body = (await enrollment.json()) as { totpURI: string; backupCodes: string[] };
  expect(body.backupCodes).toHaveLength(10);
  const verification = await request.post("/api/auth/two-factor/verify-totp", {
    data: { code: totp(body.totpURI), trustDevice: false }
  });
  expect(verification.status()).toBe(200);
  return body;
}

function totp(uri: string) {
  const secret = new URL(uri).searchParams.get("secret");
  if (!secret) throw new Error("TOTP URI did not contain a secret.");
  const counter = BigInt(Math.floor(Date.now() / 30_000));
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(counter);
  const digest = createHmac("sha1", decodeBase32(secret)).update(message).digest();
  const offset = digest[digest.length - 1]! & 0x0f;
  const value = (digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return value.toString().padStart(6, "0");
}

function decodeBase32(value: string) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const character of value.toUpperCase().replaceAll("=", "")) {
    const index = alphabet.indexOf(character);
    if (index < 0) throw new Error("Invalid base32 TOTP secret.");
    bits += index.toString(2).padStart(5, "0");
  }
  const bytes: number[] = [];
  for (let index = 0; index + 8 <= bits.length; index += 8)
    bytes.push(Number.parseInt(bits.slice(index, index + 8), 2));
  return Buffer.from(bytes);
}

test.beforeAll(async () => {
  await prisma.adminRateLimitBucket.deleteMany();
});

test.afterAll(async () => {
  await prisma.$disconnect();
});

test("enforces MFA-backed platform administration and prevents privilege escalation", async () => {
  const run = randomUUID().replaceAll("-", "").slice(0, 10);
  const ordinary = await context();
  const administrator = await context();
  const target = await context();
  const ordinaryEmail = `ordinary-admin-test-${run}@example.test`;
  const adminEmail = `operator-${run}@example.test`;
  const targetEmail = `target-${run}@example.test`;
  const ordinaryPassword = "Ordinary workspace owner has no platform authority";
  const adminPassword = "Platform operator uses a unique long passphrase";
  const targetPassword = "Target account has another unique long passphrase";

  const ordinaryUser = await register(ordinary, "Ordinary Owner", ordinaryEmail, ordinaryPassword);
  const denied = await ordinary.get("/api/v1/admin/dashboard");
  expect(denied.status()).toBe(403);
  expect((await denied.json()) as { code: string }).toMatchObject({ code: "admin_access_denied" });
  const deniedPage = await ordinary.get("/admin/dashboard");
  expect(await deniedPage.text()).not.toContain("Operate with evidence");
  expect(
    await prisma.auditLog.findFirst({
      where: { actorUserId: ordinaryUser.id, action: "admin.access.denied", outcome: "DENIED" }
    })
  ).toBeTruthy();

  const adminUser = await register(administrator, "Platform Operator", adminEmail, adminPassword);
  await prisma.user.update({ where: { id: adminUser.id }, data: { platformRole: "ADMIN" } });
  const noMfa = await administrator.get("/api/v1/admin/dashboard");
  expect(noMfa.status()).toBe(403);
  expect((await noMfa.json()) as { code: string }).toMatchObject({ code: "admin_mfa_required" });

  const adminEnrollment = await enrollTotp(administrator, adminPassword);
  const assuredSession = await prisma.session.findFirstOrThrow({
    where: { userId: adminUser.id },
    orderBy: { createdAt: "desc" },
    select: { id: true, token: true, mfaVerifiedAt: true }
  });
  expect(assuredSession.mfaVerifiedAt).toBeTruthy();
  expect((await administrator.get("/api/v1/admin/dashboard")).status()).toBe(200);
  const consolePage = await administrator.get("/admin/dashboard");
  expect(consolePage.status()).toBe(200);
  expect(await consolePage.text()).toContain("Operate with evidence");
  expect(await consolePage.text()).not.toContain(assuredSession.token);

  const targetUser = await register(target, "Promotion Target", targetEmail, targetPassword);
  const prematurePromotion = await administrator.patch(`/api/v1/admin/users/${targetUser.id}`, {
    headers: { "If-Match": `"${targetUser.version}"` },
    data: {
      platformRole: "ADMIN",
      version: targetUser.version,
      reason: "Approved platform operations rotation assignment."
    }
  });
  expect(prematurePromotion.status()).toBe(422);
  expect((await prematurePromotion.json()) as { code: string }).toMatchObject({
    code: "admin_mfa_enrollment_required"
  });
  expect(
    (
      await prisma.user.findUniqueOrThrow({
        where: { id: targetUser.id },
        select: { platformRole: true }
      })
    ).platformRole
  ).toBe("USER");

  await enrollTotp(target, targetPassword);
  const enrolledTarget = await prisma.user.findUniqueOrThrow({
    where: { id: targetUser.id },
    select: { version: true }
  });
  const promotion = await administrator.patch(`/api/v1/admin/users/${targetUser.id}`, {
    headers: { "If-Match": `"${enrolledTarget.version}"` },
    data: {
      platformRole: "ADMIN",
      version: enrolledTarget.version,
      reason: "Approved platform operations rotation assignment."
    }
  });
  expect(promotion.status()).toBe(200);
  const promoted = (await promotion.json()) as { data: { version: number } };
  expect((await target.get("/api/v1/me")).status()).toBe(401);
  expect(
    await prisma.auditLog.findFirst({
      where: {
        actorUserId: adminUser.id,
        action: "admin.user.access_changed",
        targetId: targetUser.id
      }
    })
  ).toBeTruthy();

  const selfMutation = await administrator.patch(`/api/v1/admin/users/${adminUser.id}`, {
    headers: { "If-Match": `"${adminUser.version + 1}"` },
    data: {
      status: "SUSPENDED",
      version: adminUser.version + 1,
      reason: "Attempted self suspension must always be rejected."
    }
  });
  expect(selfMutation.status()).toBe(409);
  expect((await selfMutation.json()) as { code: string }).toMatchObject({
    code: "self_admin_mutation_denied"
  });

  const suspension = await administrator.patch(`/api/v1/admin/users/${targetUser.id}`, {
    headers: { "If-Match": `"${promoted.data.version}"` },
    data: {
      status: "SUSPENDED",
      version: promoted.data.version,
      reason: "Operator rotation ended and access must be suspended."
    }
  });
  expect(suspension.status()).toBe(200);
  expect(
    (
      await prisma.user.findUniqueOrThrow({
        where: { id: targetUser.id },
        select: { status: true }
      })
    ).status
  ).toBe("SUSPENDED");

  const settings = await administrator.get("/api/v1/admin/settings");
  expect(settings.status()).toBe(200);
  const setting = (
    (await settings.json()) as { data: { key: string; version: number }[] }
  ).data.find((item) => item.key === "maintenance_notice")!;
  await prisma.session.update({
    where: { id: assuredSession.id },
    data: { mfaVerifiedAt: new Date(Date.now() - 20 * 60 * 1000) }
  });
  const staleMfa = await administrator.patch("/api/v1/admin/settings/maintenance_notice", {
    headers: { "If-Match": `"${setting.version}"` },
    data: {
      value: { enabled: true, message: "Scheduled database maintenance is in progress." },
      reason: "Publish the approved maintenance window notice."
    }
  });
  expect(staleMfa.status()).toBe(403);
  expect((await staleMfa.json()) as { code: string }).toMatchObject({ code: "fresh_mfa_required" });
  expect((await administrator.get("/api/v1/admin/settings")).status()).toBe(200);

  const stepUp = await administrator.post("/api/auth/two-factor/verify-totp", {
    data: { code: totp(adminEnrollment.totpURI), trustDevice: false }
  });
  expect(stepUp.status()).toBe(200);
  const configured = await administrator.patch("/api/v1/admin/settings/maintenance_notice", {
    headers: { "If-Match": `"${setting.version}"` },
    data: {
      value: { enabled: true, message: "Scheduled database maintenance is in progress." },
      reason: "Publish the approved maintenance window notice."
    }
  });
  expect(configured.status()).toBe(200);
  const staleWrite = await administrator.patch("/api/v1/admin/settings/maintenance_notice", {
    headers: { "If-Match": `"${setting.version}"` },
    data: {
      value: { enabled: false, message: "" },
      reason: "Attempt to reuse a stale configuration version."
    }
  });
  expect(staleWrite.status()).toBe(412);

  const disableAdminMfa = await administrator.post("/api/auth/two-factor/disable", {
    data: { password: adminPassword }
  });
  expect(disableAdminMfa.status()).toBe(403);
  expect(
    (
      await prisma.user.findUniqueOrThrow({
        where: { id: adminUser.id },
        select: { twoFactorEnabled: true }
      })
    ).twoFactorEnabled
  ).toBe(true);

  expect((await administrator.post("/api/auth/sign-out", { data: {} })).status()).toBe(200);
  const challengedLogin = await administrator.post("/api/auth/sign-in/email", {
    data: { email: adminEmail, password: adminPassword, rememberMe: false }
  });
  expect(challengedLogin.status()).toBe(200);
  expect(await challengedLogin.json()).toMatchObject({ twoFactorRedirect: true });
  expect((await administrator.get("/api/v1/admin/dashboard")).status()).toBe(401);
  const recovered = await administrator.post("/api/auth/two-factor/verify-backup-code", {
    data: { code: adminEnrollment.backupCodes[0], trustDevice: false }
  });
  expect(recovered.status()).toBe(200);
  expect((await administrator.get("/api/v1/admin/dashboard")).status()).toBe(200);

  const auditView = await administrator.get("/api/v1/admin/audit-logs");
  expect(auditView.status()).toBe(200);
  expect(
    await prisma.auditLog.findFirst({
      where: { actorUserId: adminUser.id, action: "admin.audit_logs.viewed" }
    })
  ).toBeTruthy();
  expect((await administrator.get("/api/v1/admin/usage/summary?groupBy=model")).status()).toBe(200);

  await Promise.all([ordinary.dispose(), administrator.dispose(), target.dispose()]);
});
