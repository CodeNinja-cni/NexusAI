import "server-only";

import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  S3Client,
  type S3ClientConfig
} from "@aws-sdk/client-s3";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import { getServerEnvironment } from "@/platform/env/server";

import type { ObjectStorage } from "./object-storage";

export class S3ObjectStorage implements ObjectStorage {
  private readonly environment = getServerEnvironment().storage;
  private readonly client = new S3Client(this.clientConfig());

  async checkHealth() {
    await this.client.send(new HeadBucketCommand({ Bucket: this.environment.bucket }));
  }

  async createUploadGrant(input: {
    key: string;
    contentType: string;
    sizeBytes: number;
    expiresInSeconds: number;
  }) {
    const command = new PutObjectCommand({
      Bucket: this.environment.bucket,
      Key: input.key,
      ContentType: input.contentType,
      ContentLength: input.sizeBytes
    });
    const url = await getSignedUrl(this.client, command, {
      expiresIn: input.expiresInSeconds,
      signableHeaders: new Set(["content-type", "content-length"])
    });
    return {
      url,
      method: "PUT" as const,
      headers: {
        "Content-Type": input.contentType
      },
      expiresAt: new Date(Date.now() + input.expiresInSeconds * 1_000).toISOString()
    };
  }

  async createDownloadGrant(input: {
    key: string;
    filename: string;
    contentType: string;
    expiresInSeconds: number;
  }) {
    const command = new GetObjectCommand({
      Bucket: this.environment.bucket,
      Key: input.key,
      ResponseContentType: input.contentType,
      ResponseContentDisposition: `attachment; filename*=UTF-8''${encodeURIComponent(input.filename)}`
    });
    return {
      url: await getSignedUrl(this.client, command, { expiresIn: input.expiresInSeconds }),
      expiresAt: new Date(Date.now() + input.expiresInSeconds * 1_000).toISOString()
    };
  }

  async headObject(key: string) {
    try {
      const result = await this.client.send(
        new HeadObjectCommand({ Bucket: this.environment.bucket, Key: key })
      );
      return {
        sizeBytes: result.ContentLength ?? 0,
        contentType: result.ContentType ?? null,
        etag: result.ETag?.replaceAll('"', "") ?? null,
        versionId: result.VersionId ?? null
      };
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  async readObject(key: string, maximumBytes: number) {
    const metadata = await this.headObject(key);
    if (!metadata) throw new Error("object_not_found");
    if (metadata.sizeBytes > maximumBytes) throw new Error("object_too_large");
    const response = await this.client.send(
      new GetObjectCommand({ Bucket: this.environment.bucket, Key: key })
    );
    if (!response.Body) throw new Error("object_body_missing");
    const bytes = await response.Body.transformToByteArray();
    if (bytes.byteLength > maximumBytes) throw new Error("object_too_large");
    return bytes;
  }

  async deleteObject(key: string) {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.environment.bucket, Key: key }));
  }

  private clientConfig(): S3ClientConfig {
    return {
      ...(this.environment.endpoint ? { endpoint: this.environment.endpoint } : {}),
      region: this.environment.region,
      forcePathStyle: this.environment.forcePathStyle,
      ...(this.environment.accessKeyId && this.environment.secretAccessKey
        ? {
            credentials: {
              accessKeyId: this.environment.accessKeyId,
              secretAccessKey: this.environment.secretAccessKey
            }
          }
        : {})
    };
  }
}

function isNotFound(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const value = error as { name?: string; $metadata?: { httpStatusCode?: number } };
  return value.name === "NotFound" || value.$metadata?.httpStatusCode === 404;
}
