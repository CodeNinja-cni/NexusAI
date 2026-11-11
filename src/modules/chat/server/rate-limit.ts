import "server-only";

import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/platform/database/prisma";
import { getServerEnvironment } from "@/platform/env/server";

const WINDOW_MS = 60_000;

export async function consumeChatRateLimit(userId: string, workspaceId: string) {
  const now = Date.now();
  const windowStartedAt = new Date(Math.floor(now / WINDOW_MS) * WINDOW_MS);
  const limit = getServerEnvironment().ai.requestsPerMinute;

  await prisma.$transaction(
    async (transaction) => {
      for (const key of [`user:${userId}`, `workspace:${workspaceId}`]) {
        const rows = await transaction.$queryRaw<{ count: number }[]>(Prisma.sql`
          INSERT INTO "ai_rate_limit_buckets" ("key", "window_started_at", "count", "updated_at")
          VALUES (${key}, ${windowStartedAt}, 1, CURRENT_TIMESTAMP)
          ON CONFLICT ("key", "window_started_at") DO UPDATE
          SET "count" = "ai_rate_limit_buckets"."count" + 1,
              "updated_at" = CURRENT_TIMESTAMP
          RETURNING "count"
        `);

        if ((rows[0]?.count ?? limit + 1) > limit) {
          throw new ChatRateLimitError(
            Math.max(1, Math.ceil((windowStartedAt.getTime() + WINDOW_MS - now) / 1000))
          );
        }
      }

      const retentionBefore = new Date(now - 2 * 24 * 60 * 60 * 1000);
      await transaction.$executeRaw(Prisma.sql`
        DELETE FROM "ai_rate_limit_buckets"
        WHERE ctid IN (
          SELECT ctid
          FROM "ai_rate_limit_buckets"
          WHERE "window_started_at" < ${retentionBefore}
          ORDER BY "window_started_at"
          LIMIT 100
        )
      `);
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted }
  );
}

export class ChatRateLimitError extends Error {
  constructor(readonly retryAfterSeconds: number) {
    super("Chat generation rate limit exceeded.");
  }
}
