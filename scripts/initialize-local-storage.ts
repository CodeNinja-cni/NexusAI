import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  DeleteObjectCommand,
  GetBucketCorsCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutBucketCorsCommand,
  PutObjectCommand,
  S3Client,
  type CORSRule
} from "@aws-sdk/client-s3";

const applicationEnvironment = process.env.APP_ENV?.trim() || "local";
if (applicationEnvironment !== "local" && applicationEnvironment !== "test") {
  throw new Error("Local storage initialization is restricted to APP_ENV=local or test.");
}

const endpointValue = required("S3_ENDPOINT");
const endpoint = new URL(endpointValue);
if (endpoint.protocol !== "http:" || !isLoopback(endpoint.hostname)) {
  throw new Error("Local storage initialization requires a loopback HTTP S3_ENDPOINT.");
}

const bucket = required("S3_BUCKET");
if (bucket !== "nexus-private") {
  throw new Error("Local storage initialization requires S3_BUCKET=nexus-private.");
}

const client = new S3Client({
  endpoint: endpoint.href,
  region: required("S3_REGION"),
  forcePathStyle: true,
  credentials: {
    accessKeyId: required("S3_ACCESS_KEY_ID"),
    secretAccessKey: required("S3_SECRET_ACCESS_KEY")
  }
});

await waitForBucket(client, bucket);

const desiredCors = await readCorsConfiguration();
await client.send(
  new PutBucketCorsCommand({ Bucket: bucket, CORSConfiguration: { CORSRules: desiredCors } })
);
const appliedCors = await client.send(new GetBucketCorsCommand({ Bucket: bucket }));
assert.deepEqual(normalizeCors(appliedCors.CORSRules ?? []), normalizeCors(desiredCors));

const objectKey = `_nexus/storage-initialization/${randomUUID()}.txt`;
const objectBody = "nexus-local-s3-round-trip";
try {
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: objectKey,
      Body: objectBody,
      ContentType: "text/plain"
    })
  );
  const downloaded = await client.send(new GetObjectCommand({ Bucket: bucket, Key: objectKey }));
  assert.equal(await downloaded.Body?.transformToString(), objectBody);
} finally {
  await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: objectKey }));
}

const anonymousBucketUrl = new URL(`/${encodeURIComponent(bucket)}`, endpoint);
const anonymousResponse = await fetch(anonymousBucketUrl, {
  method: "HEAD",
  redirect: "manual",
  signal: AbortSignal.timeout(5_000)
});
if (anonymousResponse.ok) {
  throw new Error("The local object-storage bucket unexpectedly accepted anonymous access.");
}

console.info(
  JSON.stringify({
    status: "ok",
    provider: "garage",
    endpoint: endpoint.origin,
    bucket,
    corsRules: desiredCors.length,
    anonymousAccessStatus: anonymousResponse.status,
    signedRoundTrip: "ok"
  })
);

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function isLoopback(hostname: string) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

async function waitForBucket(s3: S3Client, bucketName: string) {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 30; attempt += 1) {
    try {
      await s3.send(new HeadBucketCommand({ Bucket: bucketName }));
      return;
    } catch (error) {
      lastError = error;
      if (attempt < 30) await new Promise((resolveDelay) => setTimeout(resolveDelay, 1_000));
    }
  }
  throw new Error("Garage did not expose the initialized nexus-private bucket in time.", {
    cause: lastError
  });
}

async function readCorsConfiguration(): Promise<CORSRule[]> {
  const filename = resolve("docker/minio/cors.json");
  const parsed: unknown = JSON.parse(await readFile(filename, "utf8"));
  if (!parsed || typeof parsed !== "object" || !("CORSRules" in parsed)) {
    throw new Error("docker/minio/cors.json must contain CORSRules.");
  }

  const rules = (parsed as { CORSRules?: unknown }).CORSRules;
  if (!Array.isArray(rules) || rules.length === 0) {
    throw new Error("docker/minio/cors.json must contain at least one CORS rule.");
  }
  for (const rule of rules) {
    if (!rule || typeof rule !== "object") throw new Error("Every CORS rule must be an object.");
    const candidate = rule as Record<string, unknown>;
    if (!Array.isArray(candidate.AllowedMethods) || !Array.isArray(candidate.AllowedOrigins)) {
      throw new Error("Every CORS rule requires AllowedMethods and AllowedOrigins arrays.");
    }
  }
  return rules as CORSRule[];
}

function normalizeCors(rules: CORSRule[]) {
  return rules.map((rule) => ({
    AllowedHeaders: [...(rule.AllowedHeaders ?? [])].sort(),
    AllowedMethods: [...(rule.AllowedMethods ?? [])].sort(),
    AllowedOrigins: [...(rule.AllowedOrigins ?? [])].sort(),
    ExposeHeaders: [...(rule.ExposeHeaders ?? [])].sort(),
    MaxAgeSeconds: rule.MaxAgeSeconds
  }));
}
