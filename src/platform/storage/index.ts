import "server-only";

import { getServerEnvironment } from "@/platform/env/server";

import { FilesystemObjectStorage } from "./filesystem-storage";
import type { ObjectStorage } from "./object-storage";
import { S3ObjectStorage } from "./s3-storage";

let storage: ObjectStorage | undefined;

export function getObjectStorage(): ObjectStorage {
  storage ??=
    getServerEnvironment().storage.driver === "filesystem"
      ? new FilesystemObjectStorage()
      : new S3ObjectStorage();
  return storage;
}

export type { DownloadGrant, ObjectMetadata, ObjectStorage, UploadGrant } from "./object-storage";
