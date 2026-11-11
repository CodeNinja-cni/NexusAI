import { readdir, readFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";

const bundleRoot = resolve(".next/static");
const secretNames = [
  "APPLE_PRIVATE_KEY",
  "BETTER_AUTH_SECRET",
  "DATABASE_URL",
  "DIRECT_URL",
  "ERROR_REPORTING_TOKEN",
  "GOOGLE_CLIENT_SECRET",
  "MONITORING_TOKEN",
  "NEXT_SERVER_ACTIONS_ENCRYPTION_KEY",
  "OPENAI_API_KEY",
  "REDIS_URL",
  "S3_ACCESS_KEY_ID",
  "S3_SECRET_ACCESS_KEY",
  "SMTP_PASSWORD"
] as const;
const suspiciousPatterns = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u,
  /postgres(?:ql)?:\/\/[^\s"']+:[^\s"']+@/u,
  /rediss?:\/\/[^\s"']+:[^\s"']+@/u,
  /sk-(?:proj-)?[A-Za-z0-9_-]{20,}/u
] as const;

const files = await listFiles(bundleRoot);
let scannedBytes = 0;

for (const filename of files) {
  if (!/\.(?:css|html|js|json|map|txt)$/u.test(filename)) continue;
  const contents = await readFile(filename, "utf8");
  scannedBytes += Buffer.byteLength(contents);

  for (const name of secretNames) {
    const value = process.env[name]?.trim();
    if (value && value.length >= 8 && contents.includes(value)) {
      throw new Error(`Client bundle contains the configured value of ${name}.`);
    }
  }
  if (suspiciousPatterns.some((pattern) => pattern.test(contents))) {
    throw new Error(`Client bundle contains a secret-like value in ${filename}.`);
  }
}

console.info(JSON.stringify({ status: "ok", filesScanned: files.length, scannedBytes }));

async function listFiles(directory: string): Promise<string[]> {
  const directoryStat = await stat(directory).catch(() => undefined);
  if (!directoryStat?.isDirectory()) {
    throw new Error(".next/static is missing. Run the production build before scanning it.");
  }

  const output: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) output.push(...(await listFiles(path)));
    else if (entry.isFile()) output.push(path);
  }
  return output;
}
