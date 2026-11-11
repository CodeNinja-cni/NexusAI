import { randomUUID } from "node:crypto";

import { Prisma } from "../src/generated/prisma/client";
import { prisma } from "../src/platform/database/prisma";
import { logger } from "../src/platform/observability/logger";

function argument(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1]?.trim() : undefined;
}

const email = argument("--email")?.toLowerCase();
const reason = argument("--reason");
const confirmation = argument("--confirm");

if (
  !email ||
  !email.includes("@") ||
  !reason ||
  reason.length < 12 ||
  confirmation !== "NEXUS-FIRST-ADMIN"
) {
  throw new Error(
    'Usage: npm run admin:bootstrap -- --email operator@example.com --reason "documented reason" --confirm NEXUS-FIRST-ADMIN'
  );
}

await prisma.$transaction(
  async (transaction) => {
    await transaction.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(621198241)`);
    const activeAdministrators = await transaction.user.count({
      where: { platformRole: "ADMIN", status: "ACTIVE", deletedAt: null }
    });
    if (activeAdministrators > 0) {
      throw new Error("Bootstrap refused because an active platform administrator already exists.");
    }
    const user = await transaction.user.findUnique({
      where: { email },
      select: {
        id: true,
        emailVerified: true,
        status: true,
        deletedAt: true,
        twoFactorEnabled: true,
        twoFactor: { select: { verified: true } }
      }
    });
    if (
      !user ||
      !user.emailVerified ||
      user.status !== "ACTIVE" ||
      user.deletedAt ||
      !user.twoFactorEnabled ||
      !user.twoFactor?.verified
    ) {
      throw new Error(
        "Bootstrap target must be active, verified, and have verified TOTP enrollment."
      );
    }
    await transaction.user.update({
      where: { id: user.id },
      data: { platformRole: "ADMIN", version: { increment: 1 } }
    });
    await transaction.session.deleteMany({ where: { userId: user.id } });
    await transaction.auditLog.create({
      data: {
        actorKind: "SYSTEM",
        action: "admin.bootstrap.completed",
        targetType: "user",
        targetId: user.id,
        outcome: "SUCCEEDED",
        requestId: `bootstrap-${randomUUID()}`,
        changes: { platformRole: { from: "USER", to: "ADMIN" } },
        metadata: { reason, sessionsRevoked: true }
      }
    });
  },
  { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
);

logger.info("admin_bootstrap.completed", { sessionsRevoked: true });
await prisma.$disconnect();
