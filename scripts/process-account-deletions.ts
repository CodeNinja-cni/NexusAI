import { processDueAccountDeletions } from "@/modules/settings/server/account-deletion";
import { prisma } from "@/platform/database/prisma";
import { logger } from "@/platform/observability/logger";

try {
  const processed = await processDueAccountDeletions();
  logger.info("account_deletion.completed", { processed });
} finally {
  await prisma.$disconnect();
}
