import "server-only";

export interface UploadGrant {
  readonly url: string;
  readonly method: "PUT";
  readonly headers: Readonly<Record<string, string>>;
  readonly expiresAt: string;
}

export interface DownloadGrant {
  readonly url: string;
  readonly expiresAt: string;
}

export interface ObjectMetadata {
  readonly sizeBytes: number;
  readonly contentType: string | null;
  readonly etag: string | null;
  readonly versionId: string | null;
}

export interface ObjectStorage {
  checkHealth(): Promise<void>;
  createUploadGrant(input: {
    readonly key: string;
    readonly contentType: string;
    readonly sizeBytes: number;
    readonly expiresInSeconds: number;
  }): Promise<UploadGrant>;
  createDownloadGrant(input: {
    readonly key: string;
    readonly filename: string;
    readonly contentType: string;
    readonly expiresInSeconds: number;
  }): Promise<DownloadGrant>;
  headObject(key: string): Promise<ObjectMetadata | null>;
  readObject(key: string, maximumBytes: number): Promise<Uint8Array>;
  deleteObject(key: string): Promise<void>;
  acceptTestUpload?(token: string, contentType: string | null, bytes: Uint8Array): Promise<void>;
  readTestDownload?(
    token: string
  ): Promise<{ bytes: Uint8Array; contentType: string; filename: string }>;
}
