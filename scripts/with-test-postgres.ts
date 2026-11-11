import { spawn } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import EmbeddedPostgres from "embedded-postgres";

const command = process.argv[2];
const args = process.argv.slice(3);

if (!command) {
  throw new Error("Usage: with-test-postgres <command> [...args]");
}

const databaseDirectory = await mkdtemp(join(tmpdir(), "nexus-postgres-"));
const port = 55_432;
const user = "nexus_test";
const password = "nexus_test_password";
const database = "nexus_ai_test";
const postgres = new EmbeddedPostgres({
  databaseDir: databaseDirectory,
  port,
  user,
  password,
  persistent: false,
  autoRehydrateSymlinks: true,
  onLog: () => undefined,
  onError: (error) => console.error("Embedded PostgreSQL:", error)
});

let stopped = false;

async function stopPostgres() {
  if (stopped) return;
  stopped = true;
  await postgres.stop();
}

process.once("SIGINT", () => void stopPostgres());
process.once("SIGTERM", () => void stopPostgres());

try {
  await postgres.initialise();
  await postgres.start();
  await postgres.createDatabase(database);

  const databaseUrl = `postgresql://${user}:${password}@127.0.0.1:${port}/${database}?schema=public`;
  const child = spawn(command, args, {
    cwd: process.cwd(),
    env: {
      ...process.env,
      APP_ENV: "test",
      AI_PROVIDER: "mock",
      AI_REQUESTS_PER_MINUTE: "3",
      OBJECT_STORAGE_DRIVER: "filesystem",
      DOCUMENT_STORAGE_DIR: join(databaseDirectory, "objects"),
      QUEUE_DRIVER: "direct",
      DOCUMENT_SCANNER: "structural",
      APP_BASE_URL: "http://127.0.0.1:3100",
      DATABASE_URL: databaseUrl,
      TEST_DATABASE_URL: databaseUrl,
      BETTER_AUTH_SECRET: "test-only-better-auth-secret-with-at-least-32-characters",
      SMTP_HOST: "127.0.0.1",
      SMTP_PORT: "1026",
      SMTP_SECURE: "false",
      SMTP_FROM: "NEXUS AI Tests <noreply@nexus.test>"
    },
    stdio: "inherit"
  });

  const exitCode = await new Promise<number>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (signal) {
        reject(new Error(`Child process terminated by ${signal}.`));
        return;
      }
      resolve(code ?? 1);
    });
  });

  process.exitCode = exitCode;
} finally {
  await stopPostgres();
}
