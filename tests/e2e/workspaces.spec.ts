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
if (!databaseUrl) throw new Error("DATABASE_URL is required for workspace integration tests.");
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });

test.describe.configure({ mode: "serial" });

async function context(origin = baseURL) {
  return playwrightRequest.newContext({
    baseURL,
    extraHTTPHeaders: {
      Origin: origin,
      "Sec-Fetch-Site": origin === baseURL ? "same-origin" : "cross-site"
    }
  });
}

async function outboxUrl(email: string, template: "VERIFY_EMAIL" | "WORKSPACE_INVITATION") {
  await expect
    .poll(async () => {
      const event = await prisma.outboxEvent.findFirst({
        where: { payload: { path: ["to"], equals: email } },
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
        : undefined;
    })
    .toBeTruthy();
  const event = await prisma.outboxEvent.findFirstOrThrow({
    where: { payload: { path: ["to"], equals: email } },
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
  )
    throw new Error("Email outbox payload was invalid.");
  return payload.url;
}

async function register(contextValue: APIRequestContext, name: string, email: string) {
  const password = `${name} uses a deliberately long unique test password`;
  expect(
    (
      await contextValue.post("/api/auth/sign-up/email", {
        data: { name, email, password, callbackURL: "/auth/verified" }
      })
    ).status()
  ).toBe(200);
  expect((await contextValue.get(await outboxUrl(email, "VERIFY_EMAIL"))).ok()).toBe(true);
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
      await contextValue.post("/api/auth/sign-in/email", {
        data: { email, password, rememberMe: false }
      })
    ).status()
  ).toBe(200);
  const profile = (await (await contextValue.get("/api/v1/me")).json()) as {
    data: { id: string; provisioning: { personalWorkspaceId: string } };
  };
  return {
    id: profile.data.id,
    personalWorkspaceId: profile.data.provisioning.personalWorkspaceId
  };
}

function etag(
  resource: "workspace" | "workspace-member" | "workspace-invitation",
  id: string,
  version: number
) {
  return `"${resource}:${id}:${version}"`;
}

test.beforeAll(async () => {
  await prisma.rateLimit.deleteMany();
});

test.afterAll(async () => {
  await prisma.$disconnect();
});

test("enforces workspace lifecycle, role authority, invitations, switching, and isolation", async ({
  browser
}) => {
  const run = randomUUID().replaceAll("-", "").slice(0, 10);
  const ownerEmail = `owner-${run}@example.test`;
  const adminEmail = `admin-${run}@example.test`;
  const memberEmail = `member-${run}@example.test`;
  const owner = await context();
  const admin = await context();
  const member = await context();
  const anonymous = await context();
  const hostile = await context("https://attacker.example");
  const ownerAccount = await register(owner, "Owner One", ownerEmail);
  const adminAccount = await register(admin, "Admin Two", adminEmail);
  const memberAccount = await register(member, "Member Three", memberEmail);

  expect((await anonymous.get("/api/v1/workspaces")).status()).toBe(401);
  expect((await hostile.post("/api/v1/workspaces", { data: { name: "Hostile" } })).status()).toBe(
    403
  );

  const invalidCreate = await owner.post("/api/v1/workspaces", {
    data: { name: "X", owner: adminAccount.id }
  });
  expect(invalidCreate.status()).toBe(422);
  const created = await owner.post("/api/v1/workspaces", {
    data: { name: "Babbage Research", slug: "babbage-research" }
  });
  expect(created.status()).toBe(201);
  const team = (await created.json()) as {
    data: { id: string; version: number; role: string; memberCount: number };
  };
  expect(team.data).toMatchObject({ role: "OWNER", memberCount: 1 });

  const mobileBrowser = await browser.newContext({
    storageState: await owner.storageState(),
    viewport: { width: 390, height: 844 }
  });
  const mobilePage = await mobileBrowser.newPage();
  await mobilePage.goto("/workspace");
  await expect(mobilePage.getByRole("heading", { name: "Your workspaces" })).toBeVisible();
  await expect(mobilePage.getByText("Babbage Research", { exact: true })).toBeVisible();
  await expect
    .poll(() =>
      mobilePage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
    )
    .toBe(true);
  await mobilePage.goto(`/workspace/${team.data.id}`);
  await expect(mobilePage.getByRole("heading", { name: "Workspace settings" })).toBeVisible();
  await expect(mobilePage.getByRole("heading", { name: "Members and roles" })).toBeVisible();
  await mobileBrowser.close();

  expect((await admin.get(`/api/v1/workspaces/${team.data.id}`)).status()).toBe(404);
  expect((await owner.get(`/api/v1/workspaces/${adminAccount.personalWorkspaceId}`)).status()).toBe(
    404
  );
  expect((await admin.get(`/api/v1/workspaces/${ownerAccount.personalWorkspaceId}`)).status()).toBe(
    404
  );

  const personal = await owner.get(`/api/v1/workspaces/${ownerAccount.personalWorkspaceId}`);
  const personalBody = (await personal.json()) as { data: { version: number } };
  expect(
    (
      await owner.post(`/api/v1/workspaces/${ownerAccount.personalWorkspaceId}/invitations`, {
        data: { email: adminEmail, role: "MEMBER" }
      })
    ).status()
  ).toBe(409);
  expect(
    (
      await owner.delete(`/api/v1/workspaces/${ownerAccount.personalWorkspaceId}`, {
        headers: {
          "If-Match":
            personal.headers().etag ??
            etag("workspace", ownerAccount.personalWorkspaceId, personalBody.data.version)
        }
      })
    ).status()
  ).toBe(409);

  const inviteAdmin = await owner.post(`/api/v1/workspaces/${team.data.id}/invitations`, {
    data: { email: adminEmail, role: "MEMBER" }
  });
  expect(inviteAdmin.status()).toBe(202);
  const adminInviteUrl = new URL(await outboxUrl(adminEmail, "WORKSPACE_INVITATION"));
  const adminToken = new URLSearchParams(adminInviteUrl.hash.slice(1)).get("token");
  expect(adminToken).toBeTruthy();
  const storedAdminInvitation = await prisma.workspaceInvitation.findFirstOrThrow({
    where: { workspaceId: team.data.id, email: adminEmail },
    select: { tokenDigest: true }
  });
  expect(storedAdminInvitation.tokenDigest).toBe(
    createHash("sha256")
      .update(adminToken ?? "")
      .digest("hex")
  );
  expect(storedAdminInvitation.tokenDigest).not.toContain(adminToken ?? "not-a-token");

  expect(
    (
      await admin.post("/api/v1/workspace-invitations/accept", { data: { token: adminToken } })
    ).status()
  ).toBe(200);
  expect(
    await prisma.notification.count({
      where: {
        userId: ownerAccount.id,
        workspaceId: team.data.id,
        type: "NEW_ACTIVITY",
        data: { path: ["memberUserId"], equals: adminAccount.id }
      }
    })
  ).toBe(1);
  expect(
    (
      await admin.post("/api/v1/workspace-invitations/accept", { data: { token: adminToken } })
    ).status()
  ).toBe(409);

  let members = (await (await owner.get(`/api/v1/workspaces/${team.data.id}/members`)).json()) as {
    data: Array<{
      id: string;
      userId: string;
      role: "OWNER" | "ADMIN" | "MEMBER";
      version: number;
    }>;
  };
  const adminMembership = members.data.find((item) => item.userId === adminAccount.id);
  expect(adminMembership?.role).toBe("MEMBER");
  expect(
    (
      await owner.patch(`/api/v1/workspaces/${team.data.id}/members/${adminAccount.id}`, {
        headers: {
          "If-Match": etag("workspace-member", adminMembership!.id, adminMembership!.version)
        },
        data: { role: "ADMIN" }
      })
    ).status()
  ).toBe(200);

  expect(
    (
      await admin.post(`/api/v1/workspaces/${team.data.id}/invitations`, {
        data: { email: `forbidden-${run}@example.test`, role: "ADMIN" }
      })
    ).status()
  ).toBe(403);
  expect(
    (
      await admin.delete(`/api/v1/workspaces/${team.data.id}`, {
        headers: { "If-Match": etag("workspace", team.data.id, team.data.version) }
      })
    ).status()
  ).toBe(403);
  expect(
    (
      await admin.post(`/api/v1/workspaces/${team.data.id}/invitations`, {
        data: { email: memberEmail, role: "MEMBER" }
      })
    ).status()
  ).toBe(202);
  const memberUrl = new URL(await outboxUrl(memberEmail, "WORKSPACE_INVITATION"));
  const memberToken = new URLSearchParams(memberUrl.hash.slice(1)).get("token");
  expect(
    (
      await member.post("/api/v1/workspace-invitations/accept", { data: { token: memberToken } })
    ).status()
  ).toBe(200);

  expect((await member.get(`/api/v1/workspaces/${team.data.id}/members`)).status()).toBe(200);
  const teamReadForMember = await member.get(`/api/v1/workspaces/${team.data.id}`);
  const teamForMember = (await teamReadForMember.json()) as { data: { version: number } };
  expect(
    (
      await member.patch(`/api/v1/workspaces/${team.data.id}`, {
        headers: { "If-Match": etag("workspace", team.data.id, teamForMember.data.version) },
        data: { name: "Escalated" }
      })
    ).status()
  ).toBe(403);
  expect(
    (
      await member.post(`/api/v1/workspaces/${team.data.id}/invitations`, {
        data: { email: "nope@example.test", role: "MEMBER" }
      })
    ).status()
  ).toBe(403);

  expect(
    (
      await owner.post(`/api/v1/workspaces/${team.data.id}/ownership-transfers`, {
        data: { newOwnerUserId: adminAccount.id }
      })
    ).status()
  ).toBe(200);
  const ownerRows = await prisma.workspaceMember.findMany({
    where: { workspaceId: team.data.id, role: "OWNER" },
    select: { userId: true }
  });
  const ownerPointer = await prisma.workspace.findUniqueOrThrow({
    where: { id: team.data.id },
    select: { ownerUserId: true }
  });
  expect(ownerRows).toEqual([{ userId: adminAccount.id }]);
  expect(ownerPointer.ownerUserId).toBe(adminAccount.id);
  expect(
    (
      await owner.post(`/api/v1/workspaces/${team.data.id}/ownership-transfers`, {
        data: { newOwnerUserId: memberAccount.id }
      })
    ).status()
  ).toBe(403);
  const teamForFormerOwner = await owner.get(`/api/v1/workspaces/${team.data.id}`);
  expect(
    (
      await owner.delete(`/api/v1/workspaces/${team.data.id}`, {
        headers: { "If-Match": teamForFormerOwner.headers().etag ?? "" }
      })
    ).status()
  ).toBe(403);

  const selected = await member.post(`/api/v1/workspaces/${team.data.id}/selection`);
  expect(selected.status()).toBe(200);
  expect(await (await member.get("/dashboard")).text()).toContain("Babbage Research");

  const teamRead = await admin.get(`/api/v1/workspaces/${team.data.id}`);
  const teamCurrent = (await teamRead.json()) as { data: { version: number } };
  const deletion = await admin.delete(`/api/v1/workspaces/${team.data.id}`, {
    headers: {
      "If-Match":
        teamRead.headers().etag ?? etag("workspace", team.data.id, teamCurrent.data.version)
    }
  });
  expect(deletion.status()).toBe(202);
  expect((await member.get(`/api/v1/workspaces/${team.data.id}`)).status()).toBe(404);
  expect((await admin.post(`/api/v1/workspaces/${team.data.id}/restoration`)).status()).toBe(200);
  expect((await member.get(`/api/v1/workspaces/${team.data.id}`)).status()).toBe(200);

  members = (await (
    await admin.get(`/api/v1/workspaces/${team.data.id}/members`)
  ).json()) as typeof members;
  const memberMembership = members.data.find((item) => item.userId === memberAccount.id)!;
  expect(
    (
      await owner.delete(`/api/v1/workspaces/${team.data.id}/members/${memberAccount.id}`, {
        headers: {
          "If-Match": etag("workspace-member", memberMembership.id, memberMembership.version)
        }
      })
    ).status()
  ).toBe(204);
  expect((await member.get(`/api/v1/workspaces/${team.data.id}`)).status()).toBe(404);

  const raceWorkspaceResponse = await owner.post("/api/v1/workspaces", {
    data: { name: "Ownership Race Lab" }
  });
  const raceWorkspace = (await raceWorkspaceResponse.json()) as { data: { id: string } };
  await prisma.workspaceMember.createMany({
    data: [
      { workspaceId: raceWorkspace.data.id, userId: adminAccount.id, role: "MEMBER" },
      { workspaceId: raceWorkspace.data.id, userId: memberAccount.id, role: "MEMBER" }
    ]
  });
  const transferResults = await Promise.all([
    owner.post(`/api/v1/workspaces/${raceWorkspace.data.id}/ownership-transfers`, {
      data: { newOwnerUserId: adminAccount.id }
    }),
    owner.post(`/api/v1/workspaces/${raceWorkspace.data.id}/ownership-transfers`, {
      data: { newOwnerUserId: memberAccount.id }
    })
  ]);
  expect(transferResults.map((response) => response.status()).sort()).toEqual([200, 403]);
  const [racePointer, raceOwners] = await Promise.all([
    prisma.workspace.findUniqueOrThrow({
      where: { id: raceWorkspace.data.id },
      select: { ownerUserId: true }
    }),
    prisma.workspaceMember.findMany({
      where: { workspaceId: raceWorkspace.data.id, role: "OWNER" },
      select: { userId: true }
    })
  ]);
  expect(raceOwners).toHaveLength(1);
  expect(raceOwners[0]?.userId).toBe(racePointer.ownerUserId);
  const mismatchedOwnerUserId =
    racePointer.ownerUserId === adminAccount.id ? memberAccount.id : adminAccount.id;
  await expect(
    prisma.workspace.update({
      where: { id: raceWorkspace.data.id },
      data: { ownerUserId: mismatchedOwnerUserId }
    })
  ).rejects.toThrow(/workspace_owner_invariant_violation/u);
  expect(
    (
      await prisma.workspace.findUniqueOrThrow({
        where: { id: raceWorkspace.data.id },
        select: { ownerUserId: true }
      })
    ).ownerUserId
  ).toBe(racePointer.ownerUserId);

  await Promise.all([
    owner.dispose(),
    admin.dispose(),
    member.dispose(),
    anonymous.dispose(),
    hostile.dispose()
  ]);
});
