import "server-only";

import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "@/generated/prisma/client";
import { getServerEnvironment } from "@/platform/env/server";

const globalDatabase = globalThis as unknown as {
  prisma?: PrismaClient;
};

function createPrismaClient() {
  const environment = getServerEnvironment();
  const adapter = new PrismaPg({ connectionString: environment.databaseUrl });

  return new PrismaClient({
    adapter,
    log: environment.appEnvironment === "local" ? ["warn", "error"] : ["error"]
  });
}

export const prisma = globalDatabase.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalDatabase.prisma = prisma;
}
