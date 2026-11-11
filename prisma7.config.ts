import "dotenv/config";

import { defineConfig, env } from "prisma/config";

process.env.DATABASE_URL ??=
  "postgresql://nexus:nexus_local_password@127.0.0.1:5432/nexus_ai?schema=public";

const migrationDatabaseUrl = process.env.DIRECT_URL?.trim() || env("DATABASE_URL");

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations"
  },
  datasource: {
    url: migrationDatabaseUrl
  }
});
