import { randomUUID } from "node:crypto";

import { PrismaPg } from "@prisma/adapter-pg";
import AxeBuilder from "@axe-core/playwright";
import {
  expect,
  request as playwrightRequest,
  test,
  type APIRequestContext
} from "@playwright/test";

import { PrismaClient } from "../../src/generated/prisma/client";

const baseURL = "http://127.0.0.1:3100";
const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) throw new Error("DATABASE_URL is required for auth integration tests.");

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  await prisma.rateLimit.deleteMany();
});

async function newBrowserContext(origin = baseURL) {
  return playwrightRequest.newContext({
    baseURL,
    extraHTTPHeaders: {
      Origin: origin,
      "Sec-Fetch-Site": origin === baseURL ? "same-origin" : "cross-site"
    }
  });
}

async function emailUrl(email: string, template: "VERIFY_EMAIL" | "RESET_PASSWORD") {
  await expect
    .poll(
      async () => {
        const event = await prisma.outboxEvent.findFirst({
          where: {
            topic: "auth.email.send",
            payload: { path: ["to"], equals: email }
          },
          orderBy: { createdAt: "desc" },
          select: { payload: true }
        });
        const payload = event?.payload;
        if (!payload || Array.isArray(payload) || typeof payload !== "object") return undefined;
        if (payload.template !== template || typeof payload.url !== "string") return undefined;
        return payload.url;
      },
      { timeout: 10_000 }
    )
    .toBeTruthy();

  const event = await prisma.outboxEvent.findFirstOrThrow({
    where: {
      topic: "auth.email.send",
      payload: { path: ["to"], equals: email }
    },
    orderBy: { createdAt: "desc" },
    select: { payload: true }
  });
  const payload = event.payload;
  if (
    !payload ||
    Array.isArray(payload) ||
    typeof payload !== "object" ||
    payload.template !== template ||
    typeof payload.url !== "string"
  ) {
    throw new Error("Auth email outbox payload was invalid.");
  }
  return payload.url;
}

async function registerVerifyAndLogin(
  context: APIRequestContext,
  input: { name: string; email: string; password: string }
) {
  const registration = await context.post("/api/auth/sign-up/email", {
    data: { ...input, callbackURL: "/auth/verified" }
  });
  expect(registration.status()).toBe(200);
  const registrationBody = await registration.json();
  expect(registrationBody).toMatchObject({ token: null });

  const duplicateRegistration = await context.post("/api/auth/sign-up/email", {
    data: { ...input, callbackURL: "/auth/verified" }
  });
  expect(duplicateRegistration.status()).toBe(registration.status());
  expect(await duplicateRegistration.json()).toMatchObject({
    token: null,
    user: { name: input.name, email: input.email, emailVerified: false }
  });

  const verificationUrl = await emailUrl(input.email, "VERIFY_EMAIL");
  const verification = await context.get(verificationUrl);
  expect(verification.ok()).toBe(true);
  expect(verification.url()).toContain("/auth/verified");

  await expect
    .poll(async () => {
      const user = await prisma.user.findUnique({
        where: { email: input.email },
        select: { emailVerified: true, provisioning: { select: { status: true } } }
      });
      return user ? `${user.emailVerified}:${user.provisioning?.status}` : undefined;
    })
    .toBe("true:READY");

  const login = await context.post("/api/auth/sign-in/email", {
    data: { email: input.email, password: input.password, rememberMe: false }
  });
  expect(login.status()).toBe(200);
  const cookie = login.headers()["set-cookie"] ?? "";
  expect(cookie.toLowerCase()).toContain("httponly");
  expect(cookie.toLowerCase()).toContain("samesite=lax");
  expect(cookie.toLowerCase()).toContain("path=/");

  const me = await context.get("/api/v1/me");
  expect(me.status()).toBe(200);
  const profile = (await me.json()) as {
    data: { email: string; provisioning: { personalWorkspaceId: string } };
  };
  expect(profile.data.email).toBe(input.email);
  const dashboard = await context.get("/dashboard");
  expect(dashboard.status()).toBe(200);
  expect(await dashboard.text()).toContain(input.name);
  return { me, workspaceId: profile.data.provisioning.personalWorkspaceId };
}

test.afterAll(async () => {
  await prisma.$disconnect();
});

test("registration, verification, login, authorization, profile validation, recovery, and logout", async ({
  browser
}) => {
  const runId = randomUUID().replaceAll("-", "").slice(0, 12);
  const adaEmail = `ada-${runId}@example.test`;
  const graceEmail = `grace-${runId}@example.test`;
  const authUiContext = await browser.newContext({
    baseURL,
    viewport: { width: 390, height: 844 }
  });
  const authUiPage = await authUiContext.newPage();
  for (const path of ["/auth/register", "/auth/login"]) {
    await authUiPage.goto(path);
    const password = authUiPage.getByLabel("Password", { exact: true });
    await expect(password).toHaveAttribute("type", "password");
    if (path === "/auth/register") await expect(password).toHaveAttribute("minlength", "6");
    await authUiPage.getByRole("button", { name: "Show password" }).click();
    await expect(password).toHaveAttribute("type", "text");
    await authUiPage.getByRole("button", { name: "Hide password" }).click();
    await expect(password).toHaveAttribute("type", "password");
    await expect(authUiPage.getByRole("button", { name: "Continue with Google" })).toBeVisible();
    await expect(authUiPage.getByRole("button", { name: "Continue with Apple" })).toBeVisible();
    expect(
      (
        await new AxeBuilder({ page: authUiPage })
          .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
          .analyze()
      ).violations,
      path
    ).toEqual([]);
    await expect
      .poll(() =>
        authUiPage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
      )
      .toBe(true);
  }
  await authUiContext.close();

  const anonymous = await newBrowserContext();
  expect((await anonymous.get("/api/v1/me")).status()).toBe(401);
  expect((await anonymous.get("/dashboard", { maxRedirects: 0 })).status()).toBe(307);

  const hostile = await newBrowserContext("https://attacker.example");
  const hostileRegistration = await hostile.post("/api/auth/sign-up/email", {
    data: {
      name: "Mallory",
      email: "mallory@example.test",
      password: "mallory has a sufficiently long password",
      callbackURL: "/auth/verified"
    }
  });
  expect(hostileRegistration.status()).toBe(403);
  await hostile.dispose();

  const ada = await newBrowserContext();
  const adaPassword = "Ada keeps this analytical engine phrase unique";
  const adaAccount = await registerVerifyAndLogin(ada, {
    name: "Ada Lovelace",
    email: adaEmail,
    password: adaPassword
  });

  const adaWorkspace = await ada.get(`/api/v1/workspaces/${adaAccount.workspaceId}`);
  expect(adaWorkspace.status()).toBe(200);
  expect(await adaWorkspace.json()).toMatchObject({
    data: { id: adaAccount.workspaceId, kind: "PERSONAL", role: "OWNER" }
  });

  const adaSessionToken = await prisma.session.findFirstOrThrow({
    where: { user: { email: adaEmail } },
    select: { token: true }
  });
  const settings = await ada.get("/settings/profile");
  expect(settings.status()).toBe(200);
  expect(await settings.text()).not.toContain(adaSessionToken.token);

  const grace = await newBrowserContext();
  const gracePassword = "Grace uses another very long unique password";
  const graceAccount = await registerVerifyAndLogin(grace, {
    name: "Grace Hopper",
    email: graceEmail,
    password: gracePassword
  });

  const [adaUser, graceUser] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { email: adaEmail }, select: { id: true } }),
    prisma.user.findUniqueOrThrow({ where: { email: graceEmail }, select: { id: true } })
  ]);

  await Promise.all([
    prisma.conversation.create({
      data: {
        workspaceId: adaAccount.workspaceId,
        createdByUserId: adaUser.id,
        title: "Analytical engine launch decision",
        modelKey: "nexus-test-model"
      }
    }),
    prisma.document.create({
      data: {
        workspaceId: adaAccount.workspaceId,
        createdByUserId: adaUser.id,
        name: "Engine research notes.pdf",
        originalFilename: "engine-research-notes.pdf",
        status: "READY",
        storageKey: `tests/${runId}/ada-document`,
        mimeType: "application/pdf",
        sizeBytes: 4096,
        uploadedAt: new Date(),
        processedAt: new Date()
      }
    }),
    prisma.usageRecord.create({
      data: {
        operationId: randomUUID(),
        logicalOperationId: randomUUID(),
        workspaceId: adaAccount.workspaceId,
        userId: adaUser.id,
        requestId: `dashboard-ada-${runId}`,
        operation: "CHAT_GENERATION",
        provider: "test-provider",
        model: "nexus-test-model",
        status: "SUCCEEDED",
        inputTokens: 1250,
        outputTokens: 500,
        estimatedCostMicros: 420000,
        usageSource: "PROVIDER_REPORTED",
        pricingStatus: "PRICED",
        inputPriceMicrosPerMillion: 120000000,
        outputPriceMicrosPerMillion: 540000000,
        pricingVersion: "test-2026-11-07"
      }
    }),
    prisma.auditLog.create({
      data: {
        workspaceId: adaAccount.workspaceId,
        actorUserId: adaUser.id,
        actorKind: "USER",
        action: "dashboard.fixture.persisted",
        targetType: "workspace",
        targetId: adaAccount.workspaceId,
        outcome: "SUCCEEDED",
        requestId: `dashboard-audit-ada-${runId}`
      }
    }),
    prisma.conversation.create({
      data: {
        workspaceId: graceAccount.workspaceId,
        createdByUserId: graceUser.id,
        title: "Private compiler migration notes"
      }
    }),
    prisma.document.create({
      data: {
        workspaceId: graceAccount.workspaceId,
        createdByUserId: graceUser.id,
        name: "Grace private systems brief.txt",
        originalFilename: "private-systems-brief.txt",
        status: "READY",
        storageKey: `tests/${runId}/grace-document`,
        mimeType: "text/plain",
        sizeBytes: 2048,
        uploadedAt: new Date(),
        processedAt: new Date()
      }
    })
  ]);

  const adaDashboard = await ada.get("/dashboard");
  expect(adaDashboard.status()).toBe(200);
  const adaDashboardBody = await adaDashboard.text();
  expect(adaDashboardBody).toContain("Analytical engine launch decision");
  expect(adaDashboardBody).toContain("Engine research notes.pdf");
  expect(adaDashboardBody).toContain("US$0.42");
  expect(adaDashboardBody).toContain("Dashboard Fixture Persisted");
  expect(adaDashboardBody).not.toContain("Private compiler migration notes");
  expect(adaDashboardBody).not.toContain("Grace private systems brief.txt");

  const accessibleSession = await browser.newContext({
    storageState: await ada.storageState(),
    viewport: { width: 390, height: 844 }
  });
  const accessiblePage = await accessibleSession.newPage();
  for (const path of ["/dashboard", "/settings/profile", "/workspace"]) {
    await accessiblePage.goto(path);
    expect(
      (
        await new AxeBuilder({ page: accessiblePage })
          .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
          .analyze()
      ).violations,
      path
    ).toEqual([]);
    await expect
      .poll(() =>
        accessiblePage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
      )
      .toBe(true);
  }
  await accessibleSession.close();

  const graceDashboard = await grace.get("/dashboard");
  expect(graceDashboard.status()).toBe(200);
  const graceDashboardBody = await graceDashboard.text();
  expect(graceDashboardBody).toContain("Private compiler migration notes");
  expect(graceDashboardBody).toContain("Grace private systems brief.txt");
  expect(graceDashboardBody).not.toContain("Analytical engine launch decision");
  expect(graceDashboardBody).not.toContain("Engine research notes.pdf");

  expect((await grace.get(`/api/v1/workspaces/${adaAccount.workspaceId}`)).status()).toBe(404);
  expect((await ada.get(`/api/v1/workspaces/${graceAccount.workspaceId}`)).status()).toBe(404);
  expect(await (await grace.get("/api/v1/me")).text()).not.toContain(adaEmail);
  expect(await (await ada.get("/api/v1/me")).text()).not.toContain(graceEmail);
  expect(
    (
      await ada.get(`/api/v1/workspaces/${adaAccount.workspaceId}/conversations?unexpected=ignored`)
    ).status()
  ).toBe(422);

  const adaMe = await ada.get("/api/v1/me");
  const etag = adaMe.headers().etag;
  expect(etag).toBeTruthy();

  const rejectedOrigin = await ada.patch("/api/v1/me", {
    headers: { Origin: "https://attacker.example", "If-Match": etag ?? "" },
    data: { name: "Compromised" }
  });
  expect(rejectedOrigin.status()).toBe(403);

  const profileUpdate = await ada.patch("/api/v1/me", {
    headers: { "If-Match": etag ?? "" },
    data: { name: "Ada Byron" }
  });
  expect(profileUpdate.status()).toBe(200);
  expect(await profileUpdate.json()).toMatchObject({ data: { name: "Ada Byron" } });

  const staleUpdate = await ada.patch("/api/v1/me", {
    headers: { "If-Match": etag ?? "" },
    data: { name: "Stale update" }
  });
  expect(staleUpdate.status()).toBe(412);

  const resetRequest = await ada.post("/api/auth/request-password-reset", {
    data: { email: adaEmail, redirectTo: "/auth/reset-password" }
  });
  expect(resetRequest.status()).toBe(200);
  const resetRequestBody = await resetRequest.json();

  const unknownResetRequest = await anonymous.post("/api/auth/request-password-reset", {
    data: { email: `unknown-${runId}@example.test`, redirectTo: "/auth/reset-password" }
  });
  expect(unknownResetRequest.status()).toBe(resetRequest.status());
  expect(await unknownResetRequest.json()).toEqual(resetRequestBody);

  const resetUrl = new URL(await emailUrl(adaEmail, "RESET_PASSWORD"));
  const resetToken = resetUrl.pathname.split("/").at(-1);
  expect(resetToken).toBeTruthy();

  const newPassword = "Ada replaces it with a different long unique phrase";
  const reset = await anonymous.post("/api/auth/reset-password", {
    data: { token: resetToken, newPassword }
  });
  expect(reset.status()).toBe(200);
  expect((await ada.get("/api/v1/me")).status()).toBe(401);

  const oldPasswordLogin = await anonymous.post("/api/auth/sign-in/email", {
    data: { email: adaEmail, password: adaPassword, rememberMe: false }
  });
  expect(oldPasswordLogin.status()).toBe(401);

  const adaAgain = await newBrowserContext();
  expect(
    (
      await adaAgain.post("/api/auth/sign-in/email", {
        data: { email: adaEmail, password: newPassword, rememberMe: false }
      })
    ).status()
  ).toBe(200);
  expect((await adaAgain.get("/api/v1/me")).status()).toBe(200);
  expect((await adaAgain.post("/api/auth/sign-out", { data: {} })).status()).toBe(200);
  expect((await adaAgain.get("/api/v1/me")).status()).toBe(401);

  await Promise.all([anonymous.dispose(), ada.dispose(), grace.dispose(), adaAgain.dispose()]);
});
