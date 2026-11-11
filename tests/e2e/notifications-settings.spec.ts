import { randomUUID } from "node:crypto";

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
if (!databaseUrl) throw new Error("DATABASE_URL is required for settings integration tests.");
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });

test.describe.configure({ mode: "serial" });

async function context() {
  return playwrightRequest.newContext({
    baseURL,
    extraHTTPHeaders: { Origin: baseURL, "Sec-Fetch-Site": "same-origin" }
  });
}

async function emailUrl(email: string, template: string) {
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
        payload.template === template &&
        typeof payload.url === "string"
        ? payload.url
        : null;
    })
    .toBeTruthy();
  const event = await prisma.outboxEvent.findFirstOrThrow({
    where: { topic: "auth.email.send", payload: { path: ["to"], equals: email } },
    orderBy: { createdAt: "desc" },
    select: { payload: true }
  });
  const payload = event.payload as Record<string, unknown>;
  if (payload.template !== template || typeof payload.url !== "string")
    throw new Error("Email payload was invalid.");
  return payload.url;
}

async function register(
  context: APIRequestContext,
  input: { name: string; email: string; password: string }
) {
  expect(
    (
      await context.post("/api/auth/sign-up/email", {
        data: { ...input, callbackURL: "/auth/verified" }
      })
    ).status()
  ).toBe(200);
  const verificationUrl = await emailUrl(input.email, "VERIFY_EMAIL");
  expect((await context.get(verificationUrl)).ok()).toBe(true);
  await expect
    .poll(
      async () =>
        (
          await prisma.user.findUnique({
            where: { email: input.email },
            select: { provisioning: { select: { status: true } } }
          })
        )?.provisioning?.status
    )
    .toBe("READY");
  expect(
    (
      await context.post("/api/auth/sign-in/email", {
        data: { email: input.email, password: input.password, rememberMe: false }
      })
    ).status()
  ).toBe(200);
  const me = await context.get("/api/v1/me");
  const body = (await me.json()) as {
    data: { id: string; provisioning: { personalWorkspaceId: string } };
  };
  return { userId: body.data.id, workspaceId: body.data.provisioning.personalWorkspaceId };
}

test.beforeAll(async () => {
  await prisma.rateLimit.deleteMany();
});

test.afterAll(async () => {
  await prisma.$disconnect();
});

test("persists settings, protects notifications, changes passwords, and governs account deletion", async () => {
  const suffix = randomUUID().slice(0, 8);
  const ownerEmail = `phase10-owner-${suffix}@example.test`;
  const outsiderEmail = `phase10-outsider-${suffix}@example.test`;
  const ownerPassword = "Phase ten owner uses a deliberately long password";
  const outsiderPassword = "Phase ten outsider uses a different long password";
  const owner = await context();
  const outsider = await context();
  const ownerAccount = await register(owner, {
    name: "Phase Ten Owner",
    email: ownerEmail,
    password: ownerPassword
  });
  const outsiderAccount = await register(outsider, {
    name: "Phase Ten Outsider",
    email: outsiderEmail,
    password: outsiderPassword
  });

  const preferences = await owner.get("/api/v1/me/preferences");
  expect(preferences.status()).toBe(200);
  const preferenceEtag = preferences.headers()["etag"];
  expect(preferenceEtag).toBeTruthy();
  const invalidModel = await owner.patch("/api/v1/me/preferences", {
    headers: { "If-Match": preferenceEtag! },
    data: { defaultModelKey: "unavailable/model" }
  });
  expect(invalidModel.status()).toBe(422);
  const updatePreferences = await owner.patch("/api/v1/me/preferences", {
    headers: { "If-Match": preferenceEtag! },
    data: {
      defaultModelKey: "mock/nexus-dev",
      timeZone: "Africa/Lagos",
      aiPreferences: { responseStyle: "CONCISE", includeSources: true, explainCode: false },
      notificationPreferences: {
        newActivity: true,
        documentProcessing: true,
        workflowStatus: false
      }
    }
  });
  expect(updatePreferences.status()).toBe(200);
  expect(await updatePreferences.json()).toMatchObject({
    data: {
      defaultModelKey: "mock/nexus-dev",
      timeZone: "Africa/Lagos",
      aiPreferences: { responseStyle: "CONCISE" }
    }
  });
  expect(
    (
      await owner.patch("/api/v1/me/preferences", {
        headers: { "If-Match": preferenceEtag! },
        data: { timeZone: "UTC" }
      })
    ).status()
  ).toBe(412);

  const ownNotification = await prisma.notification.create({
    data: {
      userId: ownerAccount.userId,
      workspaceId: ownerAccount.workspaceId,
      type: "NEW_ACTIVITY",
      title: "Owner-only activity",
      body: "This notification belongs only to its recipient.",
      actionUrl: `/workspace/${ownerAccount.workspaceId}`
    }
  });
  await prisma.notification.create({
    data: {
      userId: outsiderAccount.userId,
      type: "SYSTEM_ALERT",
      title: "Outsider alert",
      body: "Private to the outsider."
    }
  });
  const ownerNotifications = await owner.get("/api/v1/notifications");
  expect(ownerNotifications.status()).toBe(200);
  const ownerPayload = (await ownerNotifications.json()) as {
    data: { id: string; etag: string; title: string }[];
  };
  expect(ownerPayload.data.map((item) => item.title)).toContain("Owner-only activity");
  expect(ownerPayload.data.map((item) => item.title)).not.toContain("Outsider alert");
  expect(
    (
      await outsider.patch(`/api/v1/notifications/${ownNotification.id}`, {
        headers: { "If-Match": `"notification:${ownNotification.id}:1"` },
        data: { read: true }
      })
    ).status()
  ).toBe(404);
  const ownItem = ownerPayload.data.find((item) => item.id === ownNotification.id)!;
  expect(
    (
      await owner.patch(`/api/v1/notifications/${ownItem.id}`, {
        headers: { "If-Match": ownItem.etag },
        data: { read: true }
      })
    ).status()
  ).toBe(200);

  const otherDevice = await context();
  expect(
    (
      await otherDevice.post("/api/auth/sign-in/email", {
        data: { email: ownerEmail, password: ownerPassword, rememberMe: false }
      })
    ).status()
  ).toBe(200);
  const newPassword = "Phase ten owner rotates to another long password";
  expect(
    (
      await owner.post("/api/auth/change-password", {
        data: { currentPassword: ownerPassword, newPassword, revokeOtherSessions: true }
      })
    ).status()
  ).toBe(200);
  expect((await otherDevice.get("/api/v1/me")).status()).toBe(401);
  await expect
    .poll(async () =>
      prisma.notification.count({
        where: { userId: ownerAccount.userId, type: "SYSTEM_ALERT", title: "Password changed" }
      })
    )
    .toBe(1);
  await otherDevice.dispose();

  const team = await owner.post("/api/v1/workspaces", {
    headers: { "Idempotency-Key": randomUUID() },
    data: { name: "Deletion ownership blocker", slug: `phase10-${suffix}` }
  });
  expect(team.status()).toBe(201);
  const teamData = (await team.json()) as { data: { id: string; version: number } };
  expect(
    (
      await owner.post("/api/v1/me/deletion-request", {
        headers: { "Idempotency-Key": randomUUID() },
        data: { password: newPassword, confirmation: "DELETE MY ACCOUNT" }
      })
    ).status()
  ).toBe(409);
  const stillActive = await prisma.user.findUniqueOrThrow({
    where: { id: ownerAccount.userId },
    select: { status: true }
  });
  expect(stillActive.status).toBe("ACTIVE");
  expect(
    (
      await owner.delete(`/api/v1/workspaces/${teamData.data.id}`, {
        headers: { "If-Match": `"workspace:${teamData.data.id}:${teamData.data.version}"` }
      })
    ).status()
  ).toBe(202);

  const deletion = await owner.post("/api/v1/me/deletion-request", {
    headers: { "Idempotency-Key": randomUUID() },
    data: { password: newPassword, confirmation: "DELETE MY ACCOUNT" }
  });
  expect(deletion.status()).toBe(202);
  expect((await owner.get("/api/v1/me")).status()).toBe(401);
  const cancellationUrl = await emailUrl(ownerEmail, "ACCOUNT_DELETION_CANCELLATION");
  const token = new URL(cancellationUrl).searchParams.get("token");
  expect(token).toBeTruthy();
  expect(
    (await outsider.post("/api/v1/account-deletion/cancellations", { data: { token } })).status()
  ).toBe(200);
  expect(
    (
      await owner.post("/api/auth/sign-in/email", {
        data: { email: ownerEmail, password: newPassword, rememberMe: false }
      })
    ).status()
  ).toBe(200);
  expect((await owner.get("/api/v1/me")).status()).toBe(200);
});
