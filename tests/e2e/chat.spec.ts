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
if (!databaseUrl) throw new Error("DATABASE_URL is required for chat integration tests.");
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
  const password = `${name} keeps a sufficiently long chat integration password`;
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
  const profile = (await (await request.get("/api/v1/me")).json()) as {
    data: { id: string; provisioning: { personalWorkspaceId: string } };
  };
  return {
    userId: profile.data.id,
    workspaceId: profile.data.provisioning.personalWorkspaceId
  };
}

const mutationHeaders = () => ({ "Idempotency-Key": randomUUID() });

test.beforeAll(async () => {
  await prisma.rateLimit.deleteMany();
});

test.afterAll(async () => {
  await prisma.$disconnect();
});

test("streams, persists, regenerates, cancels, tracks usage, and isolates chat", async ({
  browser
}) => {
  const run = randomUUID().replaceAll("-", "").slice(0, 10);
  const alice = await context();
  const bob = await context();
  const anonymous = await context();
  const aliceAccount = await register(alice, "Chat Alice", `chat-alice-${run}@example.test`);
  const bobAccount = await register(bob, "Chat Bob", `chat-bob-${run}@example.test`);

  expect(
    (await anonymous.get(`/api/v1/workspaces/${aliceAccount.workspaceId}/conversations`)).status()
  ).toBe(401);

  const createIdempotencyKey = randomUUID();
  const createBody = {
    title: "Branch-aware systems review",
    modelKey: "mock/nexus-dev",
    documentIds: []
  };
  const createdResponse = await alice.post(
    `/api/v1/workspaces/${aliceAccount.workspaceId}/conversations`,
    {
      headers: { "Idempotency-Key": createIdempotencyKey },
      data: createBody
    }
  );
  expect(createdResponse.status()).toBe(201);
  const created = (await createdResponse.json()) as { data: { id: string } };
  const conversationId = created.data.id;
  const replayedCreate = await alice.post(
    `/api/v1/workspaces/${aliceAccount.workspaceId}/conversations`,
    { headers: { "Idempotency-Key": createIdempotencyKey }, data: createBody }
  );
  expect(replayedCreate.status()).toBe(201);
  expect(((await replayedCreate.json()) as { data: { id: string } }).data.id).toBe(conversationId);
  expect(await prisma.conversation.count({ where: { id: conversationId } })).toBe(1);

  expect(
    (
      await bob.get(
        `/api/v1/workspaces/${aliceAccount.workspaceId}/conversations/${conversationId}`
      )
    ).status()
  ).toBe(404);
  expect(
    (
      await alice.post(
        `/api/v1/workspaces/${aliceAccount.workspaceId}/conversations/${conversationId}/messages`,
        {
          headers: mutationHeaders(),
          data: {
            clientMessageId: randomUUID(),
            content: "This should fail strict validation.",
            modelKey: "mock/nexus-dev",
            documentIds: [],
            privateApiKey: "must-not-be-accepted"
          }
        }
      )
    ).status()
  ).toBe(422);

  const streamResponse = await alice.post(
    `/api/v1/workspaces/${aliceAccount.workspaceId}/conversations/${conversationId}/messages`,
    {
      headers: mutationHeaders(),
      data: {
        clientMessageId: randomUUID(),
        content: "Explain why durable branches matter and include a code sample.",
        modelKey: "mock/nexus-dev",
        documentIds: []
      }
    }
  );
  expect(streamResponse.status()).toBe(200);
  expect(streamResponse.headers()["content-type"]).toContain("text/event-stream");
  const streamText = await streamResponse.text();
  expect(streamText).toContain("event: generation.started");
  expect(streamText).toContain("event: message.delta");
  expect(streamText).toContain("event: generation.completed");

  const persisted = await prisma.message.findMany({
    where: { conversationId },
    orderBy: { sequence: "asc" },
    select: { id: true, role: true, status: true, content: true, parentMessageId: true }
  });
  expect(persisted).toHaveLength(2);
  expect(persisted[0]).toMatchObject({ role: "USER", status: "COMPLETED" });
  expect(persisted[1]).toMatchObject({ role: "ASSISTANT", status: "COMPLETED" });
  expect(persisted[1]?.content).toContain("Development mock");
  const firstUserMessage = persisted[0]!;
  const firstAssistantMessage = persisted[1]!;
  const usage = await prisma.usageRecord.findFirstOrThrow({
    where: { messageId: firstAssistantMessage.id }
  });
  expect(usage.provider).toBe("mock");
  expect(usage.inputTokens).toBeGreaterThan(0n);
  expect(usage.outputTokens).toBeGreaterThan(0n);

  const regeneration = await alice.post(
    `/api/v1/workspaces/${aliceAccount.workspaceId}/conversations/${conversationId}/messages/${firstAssistantMessage.id}/regenerations`,
    {
      headers: mutationHeaders(),
      data: { clientGenerationId: randomUUID(), modelKey: "mock/nexus-dev" }
    }
  );
  expect(regeneration.status()).toBe(200);
  expect(await regeneration.text()).toContain("event: generation.completed");
  const sibling = await prisma.message.findFirstOrThrow({
    where: { conversationId, supersedesMessageId: firstAssistantMessage.id }
  });
  expect(sibling.parentMessageId).toBe(firstUserMessage.id);
  expect(sibling.status).toBe("COMPLETED");

  const secondConversationResponse = await alice.post(
    `/api/v1/workspaces/${aliceAccount.workspaceId}/conversations`,
    {
      headers: mutationHeaders(),
      data: { modelKey: "mock/nexus-dev", documentIds: [] }
    }
  );
  const secondConversation = (await secondConversationResponse.json()) as { data: { id: string } };
  const pendingStream = alice.post(
    `/api/v1/workspaces/${aliceAccount.workspaceId}/conversations/${secondConversation.data.id}/messages`,
    {
      headers: mutationHeaders(),
      data: {
        clientMessageId: randomUUID(),
        content: "Generate a response that will be deliberately stopped.",
        modelKey: "mock/nexus-dev",
        documentIds: []
      }
    }
  );
  await expect
    .poll(async () => {
      const assistant = await prisma.message.findFirst({
        where: {
          conversationId: secondConversation.data.id,
          role: "ASSISTANT",
          status: { in: ["PENDING", "STREAMING"] }
        },
        select: { id: true }
      });
      return assistant?.id;
    })
    .toBeTruthy();
  const activeAssistant = await prisma.message.findFirstOrThrow({
    where: { conversationId: secondConversation.data.id, role: "ASSISTANT" },
    select: { id: true }
  });
  const cancellation = await alice.post(
    `/api/v1/workspaces/${aliceAccount.workspaceId}/conversations/${secondConversation.data.id}/generations/${activeAssistant.id}/cancellation`,
    { headers: mutationHeaders() }
  );
  expect(cancellation.status()).toBe(202);
  const cancelledStream = await pendingStream;
  expect(await cancelledStream.text()).toContain("event: generation.cancelled");
  await expect
    .poll(
      async () =>
        (
          await prisma.message.findUnique({
            where: { id: activeAssistant.id },
            select: { status: true }
          })
        )?.status
    )
    .toBe("CANCELLED");

  const currentWindow = new Date(Math.floor(Date.now() / 60_000) * 60_000);
  await prisma.aiRateLimitBucket.upsert({
    where: {
      key_windowStartedAt: { key: `user:${aliceAccount.userId}`, windowStartedAt: currentWindow }
    },
    create: {
      key: `user:${aliceAccount.userId}`,
      windowStartedAt: currentWindow,
      count: 3
    },
    update: { count: 3 }
  });
  const rateLimited = await alice.post(
    `/api/v1/workspaces/${aliceAccount.workspaceId}/conversations/${secondConversation.data.id}/messages`,
    {
      headers: mutationHeaders(),
      data: {
        clientMessageId: randomUUID(),
        content: "This request should be rate limited before persistence.",
        modelKey: "mock/nexus-dev",
        documentIds: []
      }
    }
  );
  expect(rateLimited.status()).toBe(429);
  expect(rateLimited.headers()["retry-after"]).toBeTruthy();

  expect(
    (
      await bob.get(
        `/api/v1/workspaces/${bobAccount.workspaceId}/conversations/${conversationId}/messages`
      )
    ).status()
  ).toBe(404);

  const mobileContext = await browser.newContext({
    storageState: await alice.storageState(),
    viewport: { width: 390, height: 844 }
  });
  const mobilePage = await mobileContext.newPage();
  await mobilePage.goto(`/chat/${conversationId}`);
  await expect(
    mobilePage.getByRole("heading", { name: "Branch-aware systems review" })
  ).toBeVisible();
  await expect(mobilePage.getByText("Development mock", { exact: false }).first()).toBeVisible();
  await expect
    .poll(() =>
      mobilePage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
    )
    .toBe(true);
  await mobileContext.close();

  await Promise.all([alice.dispose(), bob.dispose(), anonymous.dispose()]);
});

test("searches, organizes, paginates, persists, and enforces conversation ownership", async ({
  browser
}) => {
  const run = randomUUID().replaceAll("-", "").slice(0, 10);
  const owner = await context();
  const member = await context();
  const ownerAccount = await register(owner, "History Owner", `history-owner-${run}@example.test`);
  const memberAccount = await register(
    member,
    "History Member",
    `history-member-${run}@example.test`
  );

  const workspaceResponse = await owner.post("/api/v1/workspaces", {
    data: { name: "Conversation Observatory", slug: `conversation-observatory-${run}` }
  });
  expect(workspaceResponse.status()).toBe(201);
  const workspace = (await workspaceResponse.json()) as { data: { id: string } };
  const workspaceId = workspace.data.id;
  await prisma.workspaceMember.create({
    data: { workspaceId, userId: memberAccount.userId, role: "MEMBER" }
  });

  const ownerCreate = await owner.post(`/api/v1/workspaces/${workspaceId}/conversations`, {
    headers: mutationHeaders(),
    data: {
      title: "Architecture field notes",
      modelKey: "mock/nexus-dev",
      documentIds: []
    }
  });
  expect(ownerCreate.status()).toBe(201);
  const ownerConversation = (await ownerCreate.json()) as {
    data: { id: string; version: number };
  };
  const ownerConversationId = ownerConversation.data.id;

  const generated = await owner.post(
    `/api/v1/workspaces/${workspaceId}/conversations/${ownerConversationId}/messages`,
    {
      headers: mutationHeaders(),
      data: {
        clientMessageId: randomUUID(),
        content: "Trace the quartz-compass persistence invariant.",
        modelKey: "mock/nexus-dev",
        documentIds: []
      }
    }
  );
  expect(generated.status()).toBe(200);
  expect(await generated.text()).toContain("event: generation.completed");

  const titleSearch = await member.get(
    `/api/v1/workspaces/${workspaceId}/conversations?query=Architecture&status=ALL`
  );
  expect(titleSearch.status()).toBe(200);
  expect(
    ((await titleSearch.json()) as { data: Array<{ id: string }> }).data.map((item) => item.id)
  ).toContain(ownerConversationId);
  const messageSearch = await member.get(
    `/api/v1/workspaces/${workspaceId}/conversations?query=quartz-compass&status=ALL`
  );
  expect(messageSearch.status()).toBe(200);
  expect(
    ((await messageSearch.json()) as { data: Array<{ id: string }> }).data.map((item) => item.id)
  ).toContain(ownerConversationId);

  const memberRead = await member.get(
    `/api/v1/workspaces/${workspaceId}/conversations/${ownerConversationId}`
  );
  expect(memberRead.status()).toBe(200);
  expect(
    (
      await member.patch(`/api/v1/workspaces/${workspaceId}/conversations/${ownerConversationId}`, {
        headers: { "If-Match": memberRead.headers().etag ?? "" },
        data: { title: "Unauthorized rename" }
      })
    ).status()
  ).toBe(403);
  expect(
    (
      await member.delete(
        `/api/v1/workspaces/${workspaceId}/conversations/${ownerConversationId}`,
        { headers: { "If-Match": memberRead.headers().etag ?? "" } }
      )
    ).status()
  ).toBe(403);

  const memberCreate = await member.post(`/api/v1/workspaces/${workspaceId}/conversations`, {
    headers: mutationHeaders(),
    data: {
      title: "Member research thread",
      modelKey: "mock/nexus-dev",
      documentIds: []
    }
  });
  expect(memberCreate.status()).toBe(201);
  let memberConversation = (await memberCreate.json()) as {
    data: { id: string; version: number; title: string; status: "ACTIVE" | "ARCHIVED" };
  };
  const memberConversationId = memberConversation.data.id;

  const renamed = await member.patch(
    `/api/v1/workspaces/${workspaceId}/conversations/${memberConversationId}`,
    {
      headers: {
        "If-Match": `"conversation:${memberConversationId}:${memberConversation.data.version}"`
      },
      data: { title: "Renamed member research" }
    }
  );
  expect(renamed.status()).toBe(200);
  memberConversation = (await renamed.json()) as typeof memberConversation;
  expect(memberConversation.data.title).toBe("Renamed member research");

  const archived = await member.patch(
    `/api/v1/workspaces/${workspaceId}/conversations/${memberConversationId}`,
    {
      headers: { "If-Match": archivedEtag(memberConversation.data) },
      data: { status: "ARCHIVED" }
    }
  );
  expect(archived.status()).toBe(200);
  memberConversation = (await archived.json()) as typeof memberConversation;
  expect(memberConversation.data.status).toBe("ARCHIVED");
  const activeList = (await (
    await member.get(`/api/v1/workspaces/${workspaceId}/conversations?status=ACTIVE`)
  ).json()) as { data: Array<{ id: string }> };
  expect(activeList.data.map((item) => item.id)).not.toContain(memberConversationId);
  const archiveList = (await (
    await member.get(`/api/v1/workspaces/${workspaceId}/conversations?status=ARCHIVED`)
  ).json()) as { data: Array<{ id: string }> };
  expect(archiveList.data.map((item) => item.id)).toContain(memberConversationId);
  const createdByMember = (await (
    await member.get(`/api/v1/workspaces/${workspaceId}/conversations?status=ALL&createdByMe=true`)
  ).json()) as { data: Array<{ id: string }> };
  expect(createdByMember.data.map((item) => item.id)).toContain(memberConversationId);
  expect(createdByMember.data.map((item) => item.id)).not.toContain(ownerConversationId);

  const ownerManaged = await owner.patch(
    `/api/v1/workspaces/${workspaceId}/conversations/${memberConversationId}`,
    {
      headers: { "If-Match": archivedEtag(memberConversation.data) },
      data: { title: "Owner-reviewed member research", status: "ACTIVE" }
    }
  );
  expect(ownerManaged.status()).toBe(200);
  memberConversation = (await ownerManaged.json()) as typeof memberConversation;

  const messagePage = await member.get(
    `/api/v1/workspaces/${workspaceId}/conversations/${ownerConversationId}/messages?limit=1`
  );
  expect(messagePage.status()).toBe(200);
  const latest = (await messagePage.json()) as {
    data: Array<{ role: string }>;
    meta: { nextCursor: string | null };
  };
  expect(latest.data).toHaveLength(1);
  expect(latest.data[0]?.role).toBe("ASSISTANT");
  expect(latest.meta.nextCursor).toBeTruthy();
  const earlier = await member.get(
    `/api/v1/workspaces/${workspaceId}/conversations/${ownerConversationId}/messages?limit=1&cursor=${encodeURIComponent(latest.meta.nextCursor ?? "")}`
  );
  expect(earlier.status()).toBe(200);
  expect(((await earlier.json()) as { data: Array<{ role: string }> }).data[0]?.role).toBe("USER");

  const removed = await member.delete(
    `/api/v1/workspaces/${workspaceId}/conversations/${memberConversationId}`,
    { headers: { "If-Match": archivedEtag(memberConversation.data) } }
  );
  expect(removed.status()).toBe(204);
  expect(
    (
      await member.get(`/api/v1/workspaces/${workspaceId}/conversations/${memberConversationId}`)
    ).status()
  ).toBe(404);
  const tombstone = await prisma.conversation.findUniqueOrThrow({
    where: { id: memberConversationId },
    select: { deletedAt: true, purgeAfter: true }
  });
  expect(tombstone.deletedAt).toBeTruthy();
  expect(tombstone.purgeAfter).toBeTruthy();
  const restored = await member.post(
    `/api/v1/workspaces/${workspaceId}/conversations/${memberConversationId}/restoration`,
    { headers: mutationHeaders() }
  );
  expect(restored.status()).toBe(200);
  expect(
    (
      await member.get(`/api/v1/workspaces/${workspaceId}/conversations/${memberConversationId}`)
    ).status()
  ).toBe(200);

  const ownerBeforeDelete = await owner.get(
    `/api/v1/workspaces/${workspaceId}/conversations/${ownerConversationId}`
  );
  expect(
    (
      await owner.delete(`/api/v1/workspaces/${workspaceId}/conversations/${ownerConversationId}`, {
        headers: { "If-Match": ownerBeforeDelete.headers().etag ?? "" }
      })
    ).status()
  ).toBe(204);
  expect(
    (
      await member.post(
        `/api/v1/workspaces/${workspaceId}/conversations/${ownerConversationId}/restoration`,
        { headers: mutationHeaders() }
      )
    ).status()
  ).toBe(403);
  expect(
    (
      await owner.post(
        `/api/v1/workspaces/${workspaceId}/conversations/${ownerConversationId}/restoration`,
        { headers: mutationHeaders() }
      )
    ).status()
  ).toBe(200);

  expect((await member.post(`/api/v1/workspaces/${workspaceId}/selection`)).status()).toBe(200);
  const browserContext = await browser.newContext({
    storageState: await member.storageState(),
    viewport: { width: 390, height: 844 }
  });
  const page = await browserContext.newPage();
  await page.goto(`/chat/${ownerConversationId}`);
  await expect(
    page.getByText("quartz-compass persistence invariant", { exact: false }).first()
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByText("quartz-compass persistence invariant", { exact: false }).first()
  ).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
    .toBe(true);
  await browserContext.close();

  expect(ownerAccount.userId).not.toBe(memberAccount.userId);
  await Promise.all([owner.dispose(), member.dispose()]);
});

function archivedEtag(conversation: { id: string; version: number }) {
  return `"conversation:${conversation.id}:${conversation.version}"`;
}
