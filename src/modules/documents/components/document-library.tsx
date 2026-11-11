"use client";

import Link from "next/link";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { useRef, useState, type ChangeEvent, type DragEvent } from "react";
import { FilePlus2, FileText, Search, ShieldCheck, UploadCloud } from "lucide-react";

import { Button } from "@/components/ui/button";
import { FormField, SelectField } from "@/components/ui/form-field";
import { Icon } from "@/components/ui/icon";
import { StatusPill } from "@/components/ui/status-pill";

import styles from "./documents.module.css";

interface DocumentItem {
  readonly id: string;
  readonly name: string;
  readonly status: string;
  readonly mimeType: string;
  readonly sizeBytes: string;
  readonly summary: string | null;
  readonly pageCount: number | null;
  readonly chunkCount: number;
  readonly createdAt: string;
}

interface DocumentLibraryProps {
  readonly workspaceId: string;
  readonly workspaceName: string;
  readonly documents: readonly DocumentItem[];
  readonly query: string;
  readonly status: string;
  readonly maximumBytes: number;
}

const MIME_BY_EXTENSION = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  txt: "text/plain"
} as const;

export function DocumentLibrary({
  workspaceId,
  workspaceName,
  documents,
  query,
  status,
  maximumBytes
}: DocumentLibraryProps) {
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [upload, setUpload] = useState<{ name: string; progress: number; stage: string } | null>(
    null
  );
  const [error, setError] = useState<string | null>(null);

  const acceptFile = async (file?: File) => {
    if (!file || upload) return;
    setError(null);
    const extension = file.name.split(".").at(-1)?.toLowerCase() as
      keyof typeof MIME_BY_EXTENSION | undefined;
    const mimeType = extension ? MIME_BY_EXTENSION[extension] : undefined;
    if (!mimeType) return setError("Choose a PDF, DOCX, or UTF-8 TXT file.");
    if (file.size <= 0 || file.size > maximumBytes)
      return setError(`Files must be between 1 byte and ${formatBytes(maximumBytes)}.`);
    try {
      setUpload({ name: file.name, progress: 1, stage: "Calculating integrity hash" });
      const sha256 = await digestFile(file);
      const key = crypto.randomUUID();
      const intent = await api<{
        document: { id: string };
        upload: { url: string; method: "PUT"; headers: Record<string, string> };
      }>(`/api/v1/workspaces/${workspaceId}/documents/upload-intents`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": key },
        body: JSON.stringify({ filename: file.name, mimeType, sizeBytes: file.size, sha256 })
      });
      setUpload({ name: file.name, progress: 4, stage: "Uploading to private storage" });
      await uploadObject(intent.upload, file, (progress) =>
        setUpload({
          name: file.name,
          progress: 4 + Math.round(progress * 0.86),
          stage: "Uploading to private storage"
        })
      );
      setUpload({ name: file.name, progress: 94, stage: "Verifying upload" });
      await api(
        `/api/v1/workspaces/${workspaceId}/documents/${intent.document.id}/upload-completion`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sha256 })
        }
      );
      setUpload({ name: file.name, progress: 100, stage: "Queued for secure processing" });
      router.push(`/documents/${intent.document.id}` as Route);
      router.refresh();
    } catch (reason) {
      setUpload(null);
      setError(reason instanceof Error ? reason.message : "The upload could not be completed.");
    }
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    void acceptFile(event.dataTransfer.files[0]);
  };

  return (
    <main className={styles.library}>
      <header className={styles.hero}>
        <div>
          <p className={styles.eyebrow}>DOCUMENT INTELLIGENCE / {workspaceName}</p>
          <h1>Private evidence, ready to question.</h1>
          <p>
            Upload source material once. NEXUS validates, extracts, indexes, and keeps every answer
            tied to the workspace boundary.
          </p>
        </div>
        <div className={styles.heroStamp}>
          <Icon icon={ShieldCheck} />
          <span>Private by default</span>
          <small>Signed access · isolated indexing</small>
        </div>
      </header>

      <section className={styles.uploadPanel} aria-labelledby="upload-title">
        <div
          className={styles.dropZone}
          data-dragging={dragging || undefined}
          onDragEnter={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragOver={(event) => event.preventDefault()}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
        >
          <span className={styles.uploadIcon}>
            <Icon icon={UploadCloud} />
          </span>
          <div>
            <p className={styles.eyebrow}>SECURE INGEST / PDF · DOCX · TXT</p>
            <h2 id="upload-title">Add source material</h2>
            <p>
              Drop one file here or select it from your device. Maximum {formatBytes(maximumBytes)}.
            </p>
          </div>
          <Button
            onClick={() => fileInput.current?.click()}
            disabled={Boolean(upload)}
            leadingIcon={<Icon icon={FilePlus2} />}
          >
            Choose file
          </Button>
          <input
            ref={fileInput}
            className={styles.hiddenInput}
            type="file"
            accept=".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
            onChange={(event: ChangeEvent<HTMLInputElement>) =>
              void acceptFile(event.target.files?.[0])
            }
          />
        </div>
        {upload ? (
          <div className={styles.progress} role="status" aria-live="polite">
            <div>
              <strong>{upload.name}</strong>
              <span>{upload.stage}</span>
            </div>
            <b>{upload.progress}%</b>
            <progress max="100" value={upload.progress}>
              {upload.progress}%
            </progress>
          </div>
        ) : null}
        {error ? (
          <p className={styles.alert} role="alert">
            {error}
          </p>
        ) : null}
      </section>

      <section className={styles.collection} aria-labelledby="library-title">
        <div className={styles.sectionHeading}>
          <div>
            <p className={styles.eyebrow}>
              {documents.length} RECORD{documents.length === 1 ? "" : "S"} / LIVE DATABASE
            </p>
            <h2 id="library-title">Document library</h2>
          </div>
        </div>
        <form className={styles.filters} action="/documents">
          <FormField
            label="Search indexed content"
            name="query"
            defaultValue={query}
            placeholder="Search titles, summaries, or text"
          />
          <SelectField label="Processing state" name="status" defaultValue={status}>
            <option value="ALL">All states</option>
            <option value="READY">Ready</option>
            <option value="QUEUED">Queued</option>
            <option value="PROCESSING">Processing</option>
            <option value="FAILED">Failed</option>
            <option value="QUARANTINED">Quarantined</option>
          </SelectField>
          <Button type="submit" variant="secondary" leadingIcon={<Icon icon={Search} />}>
            Filter
          </Button>
        </form>
        {documents.length ? (
          <ul className={styles.documentGrid}>
            {documents.map((document) => (
              <li key={document.id}>
                <Link href={`/documents/${document.id}` as Route} className={styles.documentCard}>
                  <div className={styles.fileGlyph}>
                    <Icon icon={FileText} />
                    <span>{extensionLabel(document.mimeType)}</span>
                  </div>
                  <div className={styles.cardBody}>
                    <div className={styles.cardTop}>
                      <h3>{document.name}</h3>
                      <StatusPill tone={statusTone(document.status)}>
                        {titleCase(document.status)}
                      </StatusPill>
                    </div>
                    <p>{document.summary ?? statusDescription(document.status)}</p>
                    <dl>
                      <div>
                        <dt>Size</dt>
                        <dd>{formatBytes(Number(document.sizeBytes))}</dd>
                      </div>
                      <div>
                        <dt>Pages</dt>
                        <dd>{document.pageCount ?? "—"}</dd>
                      </div>
                      <div>
                        <dt>Chunks</dt>
                        <dd>{document.chunkCount}</dd>
                      </div>
                      <div>
                        <dt>Added</dt>
                        <dd>
                          {new Intl.DateTimeFormat("en", { month: "short", day: "numeric" }).format(
                            new Date(document.createdAt)
                          )}
                        </dd>
                      </div>
                    </dl>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <div className={styles.empty}>
            <Icon icon={FileText} />
            <p className={styles.eyebrow}>LIBRARY / 000</p>
            <h3>No matching documents</h3>
            <p>
              Your database has no document records for these filters. Upload the first source
              above.
            </p>
          </div>
        )}
      </section>
    </main>
  );
}

async function digestFile(file: File) {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", await file.arrayBuffer()))]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
function uploadObject(
  grant: { url: string; method: "PUT"; headers: Record<string, string> },
  file: File,
  progress: (value: number) => void
) {
  return new Promise<void>((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open(grant.method, grant.url);
    for (const [name, value] of Object.entries(grant.headers))
      request.setRequestHeader(name, value);
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) progress((event.loaded / event.total) * 100);
    };
    request.onload = () =>
      request.status >= 200 && request.status < 300
        ? resolve()
        : reject(new Error("Private object storage rejected the upload."));
    request.onerror = () => reject(new Error("The upload connection failed."));
    request.send(file);
  });
}
async function api<T = unknown>(url: string, init?: RequestInit) {
  const response = await fetch(url, init);
  const payload = (await response.json().catch(() => null)) as { data?: T; detail?: string } | null;
  if (!response.ok) throw new Error(payload?.detail ?? "The request could not be completed.");
  return payload?.data as T;
}
function formatBytes(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 ** 2).toFixed(1)} MB`;
}
function titleCase(value: string) {
  return value.slice(0, 1) + value.slice(1).toLowerCase();
}
function extensionLabel(mime: string) {
  return mime === "application/pdf" ? "PDF" : mime === "text/plain" ? "TXT" : "DOCX";
}
function statusTone(status: string): "neutral" | "info" | "success" | "warning" | "danger" {
  return status === "READY"
    ? "success"
    : status === "FAILED" || status === "QUARANTINED"
      ? "danger"
      : status === "PROCESSING"
        ? "info"
        : "warning";
}
function statusDescription(status: string) {
  return status === "READY"
    ? "Indexed and ready for grounded questions."
    : status === "FAILED"
      ? "Processing could not be completed."
      : status === "QUARANTINED"
        ? "This file was isolated during validation."
        : "Secure processing is underway in the background.";
}
