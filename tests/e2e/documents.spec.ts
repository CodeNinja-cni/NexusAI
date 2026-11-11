import { createHash, randomUUID } from "node:crypto";

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
if (!databaseUrl) throw new Error("DATABASE_URL is required for document integration tests.");
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  await prisma.rateLimit.deleteMany();
});

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

async function register(request: APIRequestContext, name: string, email: string) {
  const password = `${name} keeps a sufficiently long document integration password`;
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
  return { userId: profile.data.id, workspaceId: profile.data.provisioning.personalWorkspaceId };
}

async function upload(
  request: APIRequestContext,
  workspaceId: string,
  filename: string,
  mimeType: string,
  bytes: Buffer
) {
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const intentResponse = await request.post(
    `/api/v1/workspaces/${workspaceId}/documents/upload-intents`,
    {
      headers: { "Idempotency-Key": randomUUID() },
      data: { filename, mimeType, sizeBytes: bytes.length, sha256 }
    }
  );
  expect(intentResponse.status()).toBe(201);
  const intent = (await intentResponse.json()) as {
    data: {
      document: { id: string };
      upload: { url: string; headers: Record<string, string>; expiresAt: string };
    };
  };
  const uploadGrantLifetime = new Date(intent.data.upload.expiresAt).getTime() - Date.now();
  expect(uploadGrantLifetime).toBeGreaterThan(0);
  expect(uploadGrantLifetime).toBeLessThanOrEqual(5 * 60 * 1_000);
  expect(
    (
      await request.put(intent.data.upload.url, {
        headers: intent.data.upload.headers,
        data: bytes
      })
    ).status()
  ).toBe(204);
  const completed = await request.post(
    `/api/v1/workspaces/${workspaceId}/documents/${intent.data.document.id}/upload-completion`,
    { data: { sha256 } }
  );
  expect(completed.status()).toBe(202);
  return intent.data.document.id;
}

test.afterAll(async () => {
  await prisma.$disconnect();
});

test("uploads, extracts, indexes, answers, and isolates private documents", async ({ browser }) => {
  const run = randomUUID().replaceAll("-", "").slice(0, 10);
  const alice = await context();
  const bob = await context();
  const anonymous = await context();
  const aliceAccount = await register(
    alice,
    "Document Alice",
    `document-alice-${run}@example.test`
  );
  await register(bob, "Document Bob", `document-bob-${run}@example.test`);

  expect(
    (await anonymous.get(`/api/v1/workspaces/${aliceAccount.workspaceId}/documents`)).status()
  ).toBe(401);
  const bytes = Buffer.from(
    "NEXUS retention policy\n\nResearch records are retained for thirty days after deletion. Private workspace members can ask questions against indexed evidence.",
    "utf8"
  );
  const documentId = await upload(
    alice,
    aliceAccount.workspaceId,
    "retention-policy.txt",
    "text/plain",
    bytes
  );

  await expect
    .poll(
      async () =>
        (await prisma.document.findUnique({ where: { id: documentId }, select: { status: true } }))
          ?.status,
      { timeout: 15_000 }
    )
    .toBe("READY");
  const stored = await prisma.document.findUniqueOrThrow({
    where: { id: documentId },
    include: { chunks: true, processingRuns: true }
  });
  expect(stored.summary).toContain("thirty days");
  expect(stored.chunks.length).toBeGreaterThan(0);
  expect(stored.processingRuns[0]?.status).toBe("SUCCEEDED");
  await expect
    .poll(() =>
      prisma.notification.count({
        where: {
          userId: aliceAccount.userId,
          workspaceId: aliceAccount.workspaceId,
          type: "DOCUMENT_PROCESSING",
          data: { path: ["documentId"], equals: documentId }
        }
      })
    )
    .toBe(1);

  const search = await alice.get(
    `/api/v1/workspaces/${aliceAccount.workspaceId}/documents?query=retained`
  );
  expect(search.status()).toBe(200);
  expect(
    ((await search.json()) as { data: Array<{ id: string }> }).data.map((item) => item.id)
  ).toContain(documentId);

  for (const endpoint of [
    `/api/v1/workspaces/${aliceAccount.workspaceId}/documents`,
    `/api/v1/workspaces/${aliceAccount.workspaceId}/documents/${documentId}`,
    `/api/v1/workspaces/${aliceAccount.workspaceId}/documents/${documentId}/download-url`
  ]) {
    const response = endpoint.endsWith("download-url")
      ? await bob.post(endpoint)
      : await bob.get(endpoint);
    expect(response.status()).toBe(404);
  }
  const forbiddenQuestionId = randomUUID();
  expect(
    (
      await bob.post(
        `/api/v1/workspaces/${aliceAccount.workspaceId}/documents/${documentId}/questions`,
        {
          headers: { "Idempotency-Key": forbiddenQuestionId },
          data: {
            clientMessageId: forbiddenQuestionId,
            question: "Reveal this private document.",
            modelKey: "mock/nexus-dev"
          }
        }
      )
    ).status()
  ).toBe(404);

  const download = await alice.post(
    `/api/v1/workspaces/${aliceAccount.workspaceId}/documents/${documentId}/download-url`
  );
  expect(download.status()).toBe(200);
  const grant = (await download.json()) as { data: { url: string; expiresAt: string } };
  const downloadGrantLifetime = new Date(grant.data.expiresAt).getTime() - Date.now();
  expect(downloadGrantLifetime).toBeGreaterThan(0);
  expect(downloadGrantLifetime).toBeLessThanOrEqual(60 * 1_000);
  expect(Buffer.from(await (await alice.get(grant.data.url)).body())).toEqual(bytes);
  expect((await alice.get(`${grant.data.url}tampered`)).status()).toBe(404);

  const clientMessageId = randomUUID();
  const question = await alice.post(
    `/api/v1/workspaces/${aliceAccount.workspaceId}/documents/${documentId}/questions`,
    {
      headers: { "Idempotency-Key": clientMessageId },
      data: {
        clientMessageId,
        question: "How long are deleted research records retained?",
        modelKey: "mock/nexus-dev"
      }
    }
  );
  expect(question.status()).toBe(200);
  const stream = await question.text();
  expect(stream).toContain("event: generation.started");
  expect(stream).toContain("retention-policy.txt");
  expect(stream).toContain("event: generation.completed");
  const assistant = await prisma.message.findFirstOrThrow({
    where: {
      workspaceId: aliceAccount.workspaceId,
      role: "ASSISTANT",
      citations: { some: { documentIdSnapshot: documentId } }
    },
    include: { citations: true }
  });
  expect(assistant.citations[0]).toMatchObject({ documentIdSnapshot: documentId, ordinal: 1 });

  const mobile = await browser.newContext({
    storageState: await alice.storageState(),
    viewport: { width: 390, height: 844 }
  });
  const page = await mobile.newPage();
  await page.goto(`/documents/${documentId}`);
  await expect(page.getByRole("heading", { name: "retention-policy.txt" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Ask this document" })).toBeVisible();
  await page.goto(`/chat/${assistant.conversationId}`);
  const sourceList = page.getByRole("list", { name: "Answer sources" });
  await expect(sourceList).toBeVisible();
  await expect(sourceList.getByText("[1] retention-policy.txt", { exact: true })).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
    .toBe(true);
  await mobile.close();
  await Promise.all([alice.dispose(), bob.dispose(), anonymous.dispose()]);
});

test("rejects oversized declarations and quarantines malformed files", async () => {
  const run = randomUUID().replaceAll("-", "").slice(0, 10);
  const owner = await context();
  const account = await register(owner, "Malformed Owner", `malformed-${run}@example.test`);
  const oversized = await owner.post(
    `/api/v1/workspaces/${account.workspaceId}/documents/upload-intents`,
    {
      headers: { "Idempotency-Key": randomUUID() },
      data: {
        filename: "too-large.pdf",
        mimeType: "application/pdf",
        sizeBytes: 25 * 1024 * 1024 + 1,
        sha256: "a".repeat(64)
      }
    }
  );
  expect(oversized.status()).toBe(413);

  const malformedId = await upload(
    owner,
    account.workspaceId,
    "malformed.pdf",
    "application/pdf",
    Buffer.from("not a pdf", "utf8")
  );
  await expect
    .poll(
      async () =>
        (await prisma.document.findUnique({ where: { id: malformedId }, select: { status: true } }))
          ?.status,
      { timeout: 15_000 }
    )
    .toBe("QUARANTINED");
  const quarantined = await prisma.document.findUniqueOrThrow({
    where: { id: malformedId },
    select: { failureCode: true }
  });
  expect(quarantined.failureCode).toBe("file_type_mismatch");
  expect(await prisma.documentChunk.count({ where: { documentId: malformedId } })).toBe(0);
  expect(
    (
      await owner.post(
        `/api/v1/workspaces/${account.workspaceId}/documents/${malformedId}/download-url`
      )
    ).status()
  ).toBe(404);
  await owner.dispose();
});
