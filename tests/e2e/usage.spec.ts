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
if (!databaseUrl) throw new Error("DATABASE_URL is required for usage integration tests.");
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
        payload.template === "VERIFY_EMAIL" &&
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
  ) {
    throw new Error("Verification event was malformed.");
  }
  return payload.url;
}

async function register(request: APIRequestContext, name: string, email: string) {
  const password = `${name} uses a sufficiently long usage integration password`;
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
  const profile = (await (await request.get("/api/v1/me")).json()) as { data: { id: string } };
  return { userId: profile.data.id };
}

async function createConversation(request: APIRequestContext, workspaceId: string, title: string) {
  const response = await request.post(`/api/v1/workspaces/${workspaceId}/conversations`, {
    headers: { "Idempotency-Key": randomUUID() },
    data: { title, modelKey: "mock/nexus-dev", documentIds: [] }
  });
  expect(response.status()).toBe(201);
  return ((await response.json()) as { data: { id: string } }).data.id;
}

async function generate(
  request: APIRequestContext,
  workspaceId: string,
  conversationId: string,
  prompt: string
) {
  return request.post(
    `/api/v1/workspaces/${workspaceId}/conversations/${conversationId}/messages`,
    {
      headers: { "Idempotency-Key": randomUUID() },
      data: {
        clientMessageId: randomUUID(),
        content: prompt,
        modelKey: "mock/nexus-dev",
        documentIds: []
      }
    }
  );
}

test.beforeAll(async () => {
  await prisma.rateLimit.deleteMany();
});

test.afterAll(async () => {
  await prisma.$disconnect();
});

test("enforces concurrent quotas and exposes only authorized usage records", async () => {
  const run = randomUUID().replaceAll("-", "").slice(0, 10);
  const owner = await context();
  const member = await context();
  const anonymous = await context();
  const ownerAccount = await register(owner, "Usage Owner", `usage-owner-${run}@example.test`);
  const memberAccount = await register(member, "Usage Member", `usage-member-${run}@example.test`);

  const workspace = await prisma.workspace.create({
    data: {
      kind: "TEAM",
      name: "Usage control room",
      ownerUserId: ownerAccount.userId,
      createdByUserId: ownerAccount.userId,
      members: {
        create: [
          { userId: ownerAccount.userId, role: "OWNER" },
          { userId: memberAccount.userId, role: "MEMBER", invitedByUserId: ownerAccount.userId }
        ]
      },
      storageQuota: { create: {} },
      usagePolicy: { create: {} }
    },
    select: { id: true }
  });
  await prisma.userPreference.update({
    where: { userId: ownerAccount.userId },
    data: { defaultWorkspaceId: workspace.id }
  });

  const quotaResponse = await owner.get(`/api/v1/usage/quota?workspaceId=${workspace.id}`);
  expect(quotaResponse.status()).toBe(200);
  const initialEtag = quotaResponse.headers()["etag"]!;
  expect(
    ((await quotaResponse.json()) as { data: { limits: { requests: string | null } } }).data.limits
      .requests
  ).toBeNull();

  const memberMutation = await member.patch(`/api/v1/usage/quota?workspaceId=${workspace.id}`, {
    headers: { "If-Match": initialEtag },
    data: {
      requestLimit: "1",
      inputTokenLimit: null,
      outputTokenLimit: null,
      costLimitMicros: null
    }
  });
  expect(memberMutation.status()).toBe(403);

  const configured = await owner.patch(`/api/v1/usage/quota?workspaceId=${workspace.id}`, {
    headers: { "If-Match": initialEtag },
    data: {
      requestLimit: "1",
      inputTokenLimit: null,
      outputTokenLimit: null,
      costLimitMicros: null
    }
  });
  expect(configured.status()).toBe(200);
  const configuredEtag = configured.headers()["etag"]!;

  const firstConversation = await createConversation(owner, workspace.id, "First concurrent usage");
  const secondConversation = await createConversation(
    owner,
    workspace.id,
    "Second concurrent usage"
  );
  const responses = await Promise.all([
    generate(
      owner,
      workspace.id,
      firstConversation,
      "Record the first real provider completion payload."
    ),
    generate(owner, workspace.id, secondConversation, "Compete for the same single request quota.")
  ]);
  expect(responses.map((response) => response.status()).sort()).toEqual([200, 429]);
  const completed = responses.find((response) => response.status() === 200)!;
  expect(await completed.text()).toContain("event: generation.completed");
  const rejected = responses.find((response) => response.status() === 429)!;
  expect(((await rejected.json()) as { code: string }).code).toBe("quota_exceeded");

  const usage = await prisma.usageRecord.findFirstOrThrow({ where: { workspaceId: workspace.id } });
  expect(usage.provider).toBe("mock");
  expect(usage.usageSource).toBe("DEVELOPMENT_ESTIMATE");
  expect(usage.pricingStatus).toBe("UNPRICED");
  expect(usage.providerRequestId).toMatch(/^mock-/u);
  expect(usage.inputTokens).toBeGreaterThan(0n);
  expect(usage.outputTokens).toBeGreaterThan(0n);

  const reservation = await prisma.usageReservation.findUniqueOrThrow({
    where: { logicalOperationId: usage.logicalOperationId }
  });
  expect(reservation.status).toBe("SETTLED");
  expect(reservation.actualInputTokens).toBe(usage.inputTokens);
  expect(reservation.actualOutputTokens).toBe(usage.outputTokens);
  const period = await prisma.usageQuotaPeriod.findUniqueOrThrow({
    where: { id: reservation.quotaPeriodId }
  });
  expect(period.consumedRequests).toBe(1n);
  expect(period.reservedRequests).toBe(0n);
  expect(period.consumedInputTokens).toBe(usage.inputTokens);

  const summary = await owner.get(`/api/v1/usage/summary?workspaceId=${workspace.id}&groupBy=day`);
  expect(summary.status()).toBe(200);
  const summaryBody = (await summary.json()) as {
    data: { totals: { aiRequests: number; unpricedRequests: number }; breakdown: unknown[] };
  };
  expect(summaryBody.data.totals).toMatchObject({ aiRequests: 1, unpricedRequests: 1 });
  expect(summaryBody.data.breakdown).toHaveLength(1);

  const ownerRecords = await owner.get(`/api/v1/usage/records?workspaceId=${workspace.id}`);
  expect(ownerRecords.status()).toBe(200);
  expect((await ownerRecords.json()) as { data: unknown[]; meta: { scope: string } }).toMatchObject(
    { data: [{ provider: "mock" }], meta: { scope: "workspace" } }
  );
  const memberRecords = await member.get(`/api/v1/usage/records?workspaceId=${workspace.id}`);
  expect(memberRecords.status()).toBe(200);
  expect(
    (await memberRecords.json()) as { data: unknown[]; meta: { scope: string } }
  ).toMatchObject({ data: [], meta: { scope: "self" } });
  expect((await anonymous.get(`/api/v1/usage/summary?workspaceId=${workspace.id}`)).status()).toBe(
    401
  );

  const usagePage = await owner.get("/usage");
  expect(usagePage.status()).toBe(200);
  expect(await usagePage.text()).toContain("Know exactly what the workspace consumed");

  expect(
    (
      await owner.patch(`/api/v1/usage/quota?workspaceId=${workspace.id}`, {
        headers: { "If-Match": initialEtag },
        data: {
          requestLimit: "2",
          inputTokenLimit: null,
          outputTokenLimit: null,
          costLimitMicros: null
        }
      })
    ).status()
  ).toBe(412);
  const costLimited = await owner.patch(`/api/v1/usage/quota?workspaceId=${workspace.id}`, {
    headers: { "If-Match": configuredEtag },
    data: {
      requestLimit: "2",
      inputTokenLimit: null,
      outputTokenLimit: null,
      costLimitMicros: "1000000"
    }
  });
  expect(costLimited.status()).toBe(200);
  const thirdConversation = await createConversation(owner, workspace.id, "Unpriced cost quota");
  const unpricedAttempt = await generate(
    owner,
    workspace.id,
    thirdConversation,
    "This must fail closed before an unpriced provider request."
  );
  expect(unpricedAttempt.status()).toBe(503);
  expect(((await unpricedAttempt.json()) as { code: string }).code).toBe("pricing_unavailable");
  expect(await prisma.usageRecord.count({ where: { workspaceId: workspace.id } })).toBe(1);
  expect(await prisma.message.count({ where: { conversationId: thirdConversation } })).toBe(0);
});
