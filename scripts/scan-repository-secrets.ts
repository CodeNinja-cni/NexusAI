import { execFile } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { extname, relative, resolve } from "node:path";
import { promisify } from "node:util";

const root = resolve(".");
const ignoredFiles = new Set(["package-lock.json"]);
const textExtensions = new Set([
  "",
  ".css",
  ".env",
  ".example",
  ".html",
  ".js",
  ".json",
  ".md",
  ".mjs",
  ".sh",
  ".sql",
  ".template",
  ".ts",
  ".tsx",
  ".yaml",
  ".yml"
]);
const secretPatterns = [
  { name: "private key", pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u },
  { name: "OpenAI key", pattern: /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/u },
  { name: "AWS access key", pattern: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/u },
  { name: "GitHub token", pattern: /\bgh[opsu]_[A-Za-z0-9]{30,}\b/u },
  { name: "Slack token", pattern: /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/u }
] as const;

let filesScanned = 0;
let scannedBytes = 0;
for (const filename of await listRepositoryFiles()) {
  const info = await stat(filename);
  if (info.size > 2 * 1024 * 1024 || !textExtensions.has(extname(filename))) continue;

  const contents = await readFile(filename, "utf8");
  filesScanned += 1;
  scannedBytes += info.size;
  for (const candidate of secretPatterns) {
    if (candidate.pattern.test(contents)) {
      throw new Error(
        `Repository secret scan found a possible ${candidate.name} in ${relative(root, filename)}.`
      );
    }
  }
}

console.info(JSON.stringify({ status: "ok", filesScanned, scannedBytes }));

async function listRepositoryFiles(): Promise<string[]> {
  const run = promisify(execFile);
  const { stdout } = await run(
    "git",
    ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
    { cwd: root, encoding: "buffer", maxBuffer: 16 * 1024 * 1024 }
  );

  return stdout
    .toString("utf8")
    .split("\0")
    .filter(Boolean)
    .filter((filename) => !ignoredFiles.has(filename))
    .filter((filename) => filename !== "tsconfig.tsbuildinfo")
    .map((filename) => resolve(root, filename));
}
