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
if (!databaseUrl) throw new Error("DATABASE_URL is required for workflow integration tests.");
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
  )
    throw new Error("Verification event was malformed.");
  return payload.url;
}

async function register(request: APIRequestContext, name: string, email: string) {
  const password = `${name} keeps a sufficiently long workflow integration password`;
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

const validDefinition = {
  schemaVersion: "nexus.workflow.v1",
  nodes: [
    { id: "input", kind: "INPUT", position: { x: 60, y: 100 }, config: { label: "Request" } },
    {
      id: "template",
      kind: "TEMPLATE",
      position: { x: 280, y: 100 },
      config: { template: "Review this value:\n{{previous}}" }
    },
    {
      id: "prompt",
      kind: "AI_PROMPT",
      position: { x: 500, y: 100 },
      config: {
        instruction: "Return a concise review of the supplied workflow value.",
        modelKey: "mock/nexus-dev"
      }
    },
    { id: "output", kind: "OUTPUT", position: { x: 720, y: 100 }, config: { label: "Review" } }
  ],
  edges: [
    { id: "edge-1", source: "input", target: "template" },
    { id: "edge-2", source: "template", target: "prompt" },
    { id: "edge-3", source: "prompt", target: "output" }
  ]
};

test.beforeAll(async () => {
  await prisma.rateLimit.deleteMany();
});

test.afterAll(async () => {
  await prisma.$disconnect();
});

test("authors, publishes, executes, audits, and isolates controlled workflows", async ({
  browser
}) => {
  const run = randomUUID().replaceAll("-", "").slice(0, 10);
  const owner = await context();
  const member = await context();
  const outsider = await context();
  const anonymous = await context();
  const ownerAccount = await register(owner, "Flow Owner", `flow-owner-${run}@example.test`);
  const memberAccount = await register(member, "Flow Member", `flow-member-${run}@example.test`);
  await register(outsider, "Flow Outsider", `flow-outsider-${run}@example.test`);

  const workspaceResponse = await owner.post("/api/v1/workspaces", {
    data: { name: `Workflow Control ${run}` }
  });
  expect(workspaceResponse.status()).toBe(201);
  const workspace = (await workspaceResponse.json()) as { data: { id: string } };
  const workspaceId = workspace.data.id;
  await prisma.workspaceMember.create({
    data: { workspaceId, userId: memberAccount.userId, role: "MEMBER" }
  });

  expect((await anonymous.get(`/api/v1/workspaces/${workspaceId}/workflows`)).status()).toBe(401);
  expect((await outsider.get(`/api/v1/workspaces/${workspaceId}/workflows`)).status()).toBe(404);
  expect(
    (
      await member.post(`/api/v1/workspaces/${workspaceId}/workflows`, {
        data: { name: "Member authored workflow" }
      })
    ).status()
  ).toBe(403);

  const createdResponse = await owner.post(`/api/v1/workspaces/${workspaceId}/workflows`, {
    data: {
      name: "Evidence reviewer",
      description: "Controlled review with a deterministic test provider."
    }
  });
  expect(createdResponse.status()).toBe(201);
  const created = (await createdResponse.json()) as { data: { id: string; etag: string } };
  const workflowId = created.data.id;
  expect(
    (
      await member.post(`/api/v1/workspaces/${workspaceId}/workflows/${workflowId}/versions`, {
        data: { schemaVersion: "nexus.workflow.v1", definition: validDefinition }
      })
    ).status()
  ).toBe(403);

  const codeDefinition = structuredClone(validDefinition);
  codeDefinition.nodes[1] = {
    id: "code",
    kind: "CODE",
    position: { x: 280, y: 100 },
    config: { source: "return process.env" }
  } as unknown as (typeof codeDefinition.nodes)[number];
  const codeAttempt = await owner.post(
    `/api/v1/workspaces/${workspaceId}/workflows/${workflowId}/versions`,
    { data: { schemaVersion: "nexus.workflow.v1", definition: codeDefinition } }
  );
  expect(codeAttempt.status()).toBe(422);
  expect(((await codeAttempt.json()) as { code: string }).code).toBe("workflow_schema_invalid");

  const versionResponse = await owner.post(
    `/api/v1/workspaces/${workspaceId}/workflows/${workflowId}/versions`,
    { data: { schemaVersion: "nexus.workflow.v1", definition: validDefinition } }
  );
  expect(versionResponse.status()).toBe(201);
  const version = (await versionResponse.json()) as {
    data: { id: string; versionNumber: number; definitionSha256: string };
  };
  expect(version.data.versionNumber).toBe(1);
  expect(version.data.definitionSha256).toMatch(/^[0-9a-f]{64}$/u);

  const publishResponse = await owner.post(
    `/api/v1/workspaces/${workspaceId}/workflows/${workflowId}/versions/${version.data.id}/publication`
  );
  expect(publishResponse.status()).toBe(200);
  expect(((await publishResponse.json()) as { data: { status: string } }).data.status).toBe(
    "ACTIVE"
  );

  const inputSecret = `do-not-log-${run}`;
  const idempotencyKey = randomUUID();
  const executionResponse = await member.post(
    `/api/v1/workspaces/${workspaceId}/workflows/${workflowId}/executions`,
    {
      headers: { "Idempotency-Key": idempotencyKey },
      data: { input: { text: inputSecret } }
    }
  );
  expect(executionResponse.status()).toBe(202);
  const execution = (await executionResponse.json()) as { data: { id: string } };
  const replay = await member.post(
    `/api/v1/workspaces/${workspaceId}/workflows/${workflowId}/executions`,
    {
      headers: { "Idempotency-Key": idempotencyKey },
      data: { input: { text: inputSecret } }
    }
  );
  expect(replay.status()).toBe(202);
  expect(((await replay.json()) as { data: { id: string } }).data.id).toBe(execution.data.id);
  expect(await prisma.workflowExecution.count({ where: { id: execution.data.id } })).toBe(1);

  await expect
    .poll(
      async () =>
        (
          await prisma.workflowExecution.findUnique({
            where: { id: execution.data.id },
            select: { status: true }
          })
        )?.status,
      { timeout: 15_000 }
    )
    .toBe("SUCCEEDED");
  const completed = await prisma.workflowExecution.findUniqueOrThrow({
    where: { id: execution.data.id },
    select: { output: true, workflowVersionId: true }
  });
  expect(completed.workflowVersionId).toBe(version.data.id);
  expect(JSON.stringify(completed.output)).toContain("Development mock");

  const usage = await prisma.usageRecord.findFirstOrThrow({
    where: { workflowExecutionId: execution.data.id }
  });
  expect(usage).toMatchObject({
    provider: "mock",
    operation: "workflow.ai_prompt",
    status: "SUCCEEDED"
  });
  expect(usage.inputTokens).toBeGreaterThan(0n);
  expect(usage.outputTokens).toBeGreaterThan(0n);

  const logResponse = await member.get(
    `/api/v1/workspaces/${workspaceId}/workflow-executions/${execution.data.id}/logs`
  );
  expect(logResponse.status()).toBe(200);
  const logBody = (await logResponse.json()) as {
    data: Array<{ event: string; message: string; data: unknown }>;
  };
  expect(logBody.data.map((item) => item.event)).toContain("execution.succeeded");
  expect(JSON.stringify(logBody.data)).not.toContain(inputSecret);
  expect(
    await prisma.auditLog.count({
      where: { workspaceId, action: { startsWith: "workflow." }, targetId: { not: null } }
    })
  ).toBeGreaterThanOrEqual(4);

  const queuedCancellation = await member.post(
    `/api/v1/workspaces/${workspaceId}/workflows/${workflowId}/executions`,
    {
      headers: { "Idempotency-Key": randomUUID() },
      data: { input: { text: "Cancel this controlled run." } }
    }
  );
  const cancellationExecution = (await queuedCancellation.json()) as { data: { id: string } };
  expect(
    (
      await member.post(
        `/api/v1/workspaces/${workspaceId}/workflow-executions/${cancellationExecution.data.id}/cancellation`
      )
    ).status()
  ).toBe(202);
  await expect
    .poll(
      async () =>
        (
          await prisma.workflowExecution.findUnique({
            where: { id: cancellationExecution.data.id },
            select: { status: true }
          })
        )?.status
    )
    .toBe("CANCELLED");

  const revokedResponse = await member.post(
    `/api/v1/workspaces/${workspaceId}/workflows/${workflowId}/executions`,
    {
      headers: { "Idempotency-Key": randomUUID() },
      data: { input: { text: `authorization-revocation-${"x".repeat(400)}` } }
    }
  );
  expect(revokedResponse.status()).toBe(202);
  const revokedExecution = (await revokedResponse.json()) as { data: { id: string } };
  await expect
    .poll(
      async () =>
        (
          await prisma.workflowExecution.findUnique({
            where: { id: revokedExecution.data.id },
            select: { status: true }
          })
        )?.status,
      { timeout: 15_000 }
    )
    .toBe("RUNNING");
  await prisma.workspaceMember.delete({
    where: { workspaceId_userId: { workspaceId, userId: memberAccount.userId } }
  });
  await expect
    .poll(
      async () =>
        prisma.workflowExecution.findUnique({
          where: { id: revokedExecution.data.id },
          select: { status: true, errorCode: true }
        }),
      { timeout: 15_000 }
    )
    .toMatchObject({ status: "CANCELLED", errorCode: "workflow_authorization_revoked" });

  expect(
    (
      await outsider.get(
        `/api/v1/workspaces/${workspaceId}/workflow-executions/${execution.data.id}`
      )
    ).status()
  ).toBe(404);
  expect(
    (
      await owner.patch(`/api/v1/workspaces/${workspaceId}/workflows/${workflowId}`, {
        headers: { "If-Match": created.data.etag },
        data: { name: "Stale rename" }
      })
    ).status()
  ).toBe(412);

  const browserContext = await browser.newContext({
    storageState: await owner.storageState(),
    viewport: { width: 390, height: 844 }
  });
  const page = await browserContext.newPage();
  await owner.post(`/api/v1/workspaces/${workspaceId}/selection`);
  await page.goto(`/workflows/${workflowId}`);
  await expect(page.getByRole("heading", { name: "Evidence reviewer" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Execution canvas" })).toBeVisible();
  await expect(page.getByText("CONTROLLED ENGINE")).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
    .toBe(true);
  await browserContext.close();

  await Promise.all([owner.dispose(), member.dispose(), outsider.dispose(), anonymous.dispose()]);
  expect(ownerAccount.workspaceId).toBeTruthy();
});
