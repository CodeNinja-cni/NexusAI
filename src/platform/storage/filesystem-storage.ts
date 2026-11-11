import "server-only";

import { constants } from "node:fs";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { access, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { getServerEnvironment } from "@/platform/env/server";

import type { DownloadGrant, ObjectMetadata, ObjectStorage, UploadGrant } from "./object-storage";

type GrantPayload =
  | {
      readonly operation: "upload";
      readonly key: string;
      readonly contentType: string;
      readonly sizeBytes: number;
      readonly expiresAt: number;
    }
  | {
      readonly operation: "download";
      readonly key: string;
      readonly contentType: string;
      readonly filename: string;
      readonly expiresAt: number;
    };

export class FilesystemObjectStorage implements ObjectStorage {
  private readonly root = resolve(getServerEnvironment().storage.filesystemDirectory);

  async checkHealth() {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    await access(this.root, constants.R_OK | constants.W_OK);
  }

  async createUploadGrant(input: {
    key: string;
    contentType: string;
    sizeBytes: number;
    expiresInSeconds: number;
  }): Promise<UploadGrant> {
    const expiresAt = Date.now() + input.expiresInSeconds * 1_000;
    const token = signGrant({
      operation: "upload",
      key: input.key,
      contentType: input.contentType,
      sizeBytes: input.sizeBytes,
      expiresAt
    });
    return {
      url: `${getServerEnvironment().appBaseUrl}/api/v1/document-uploads/${token}`,
      method: "PUT",
      headers: { "Content-Type": input.contentType },
      expiresAt: new Date(expiresAt).toISOString()
    };
  }

  async createDownloadGrant(input: {
    key: string;
    filename: string;
    contentType: string;
    expiresInSeconds: number;
  }): Promise<DownloadGrant> {
    const expiresAt = Date.now() + input.expiresInSeconds * 1_000;
    const token = signGrant({
      operation: "download",
      key: input.key,
      filename: input.filename,
      contentType: input.contentType,
      expiresAt
    });
    return {
      url: `${getServerEnvironment().appBaseUrl}/api/v1/document-downloads/${token}`,
      expiresAt: new Date(expiresAt).toISOString()
    };
  }

  async headObject(key: string): Promise<ObjectMetadata | null> {
    try {
      const [file, metadata] = await Promise.all([
        stat(this.objectPath(key)),
        readFile(this.metadataPath(key), "utf8")
      ]);
      const parsed = JSON.parse(metadata) as { contentType: string; etag: string };
      return {
        sizeBytes: file.size,
        contentType: parsed.contentType,
        etag: parsed.etag,
        versionId: null
      };
    } catch (error) {
      if (isMissing(error)) return null;
      throw error;
    }
  }

  async readObject(key: string, maximumBytes: number) {
    const metadata = await this.headObject(key);
    if (!metadata) throw new Error("object_not_found");
    if (metadata.sizeBytes > maximumBytes) throw new Error("object_too_large");
    return new Uint8Array(await readFile(this.objectPath(key)));
  }

  async deleteObject(key: string) {
    await Promise.all([
      rm(this.objectPath(key), { force: true }),
      rm(this.metadataPath(key), { force: true })
    ]);
  }

  async acceptTestUpload(token: string, contentType: string | null, bytes: Uint8Array) {
    const payload = verifyGrant(token);
    if (payload.operation !== "upload") throw new Error("invalid_upload_grant");
    if (bytes.byteLength !== payload.sizeBytes) throw new Error("upload_size_mismatch");
    if (contentType !== payload.contentType) throw new Error("upload_content_type_mismatch");
    const objectPath = this.objectPath(payload.key);
    await mkdir(dirname(objectPath), { recursive: true, mode: 0o700 });
    await writeFile(objectPath, bytes, { mode: 0o600 });
    const etag = createHash("sha256").update(bytes).digest("hex");
    await writeFile(
      this.metadataPath(payload.key),
      JSON.stringify({ contentType: payload.contentType, etag }),
      { mode: 0o600 }
    );
  }

  async readTestDownload(token: string) {
    const payload = verifyGrant(token);
    if (payload.operation !== "download") throw new Error("invalid_download_grant");
    return {
      bytes: new Uint8Array(await readFile(this.objectPath(payload.key))),
      contentType: payload.contentType,
      filename: payload.filename
    };
  }

  private objectPath(key: string) {
    const path = resolve(this.root, key);
    if (!path.startsWith(`${this.root}/`)) throw new Error("invalid_storage_key");
    return path;
  }

  private metadataPath(key: string) {
    return `${this.objectPath(key)}.metadata.json`;
  }
}

function signGrant(payload: GrantPayload) {
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = createHmac("sha256", getServerEnvironment().betterAuthSecret)
    .update(encoded)
    .digest("base64url");
  return `${encoded}.${signature}`;
}

function verifyGrant(token: string): GrantPayload {
  const [encoded, suppliedSignature, ...rest] = token.split(".");
  if (!encoded || !suppliedSignature || rest.length > 0) throw new Error("invalid_storage_grant");
  const expected = createHmac("sha256", getServerEnvironment().betterAuthSecret)
    .update(encoded)
    .digest();
  let supplied: Buffer;
  try {
    supplied = Buffer.from(suppliedSignature, "base64url");
  } catch {
    throw new Error("invalid_storage_grant");
  }
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
    throw new Error("invalid_storage_grant");
  }
  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch {
    throw new Error("invalid_storage_grant");
  }
  if (!payload || typeof payload !== "object") throw new Error("invalid_storage_grant");
  const candidate = payload as Record<string, unknown>;
  if (typeof candidate.expiresAt !== "number" || candidate.expiresAt < Date.now()) {
    throw new Error("expired_storage_grant");
  }
  if (candidate.operation === "upload") {
    if (
      typeof candidate.key !== "string" ||
      typeof candidate.contentType !== "string" ||
      typeof candidate.sizeBytes !== "number"
    ) {
      throw new Error("invalid_storage_grant");
    }
    return candidate as GrantPayload;
  }
  if (
    candidate.operation === "download" &&
    typeof candidate.key === "string" &&
    typeof candidate.contentType === "string" &&
    typeof candidate.filename === "string"
  ) {
    return candidate as GrantPayload;
  }
  throw new Error("invalid_storage_grant");
}

function isMissing(error: unknown) {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
}
