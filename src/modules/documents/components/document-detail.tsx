"use client";

import Link from "next/link";
import type { Route } from "next";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  ArrowLeft,
  Download,
  FileText,
  MessageSquareText,
  RefreshCw,
  ShieldCheck
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { TextAreaField } from "@/components/ui/form-field";
import { Icon } from "@/components/ui/icon";
import { StatusPill } from "@/components/ui/status-pill";

import styles from "./documents.module.css";

interface DocumentDetailRecord {
  readonly id: string;
  readonly name: string;
  readonly originalFilename: string;
  readonly status: string;
  readonly mimeType: string;
  readonly detectedMimeType: string | null;
  readonly sizeBytes: string;
  readonly pageCount: number | null;
  readonly chunkCount: number;
  readonly summary: string | null;
  readonly failureCode: string | null;
  readonly uploadedAt: string | null;
  readonly processedAt: string | null;
  readonly processingRuns: readonly {
    id: string;
    status: string;
    attempt: number;
    errorCode: string | null;
    createdAt: string;
  }[];
}

interface Citation {
  ordinal: number;
  documentName: string;
  excerpt: string;
  pageStart: number | null;
  pageEnd: number | null;
}

export function DocumentDetail({
  workspaceId,
  initialDocument,
  modelKey
}: {
  workspaceId: string;
  initialDocument: DocumentDetailRecord;
  modelKey: string;
}) {
  const [document, setDocument] = useState(initialDocument);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [citations, setCitations] = useState<readonly Citation[]>([]);
  const [conversationId, setConversationId] = useState<string>();
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const response = await fetch(`/api/v1/workspaces/${workspaceId}/documents/${document.id}`, {
      cache: "no-store"
    });
    if (!response.ok) return;
    const payload = (await response.json()) as { data: DocumentDetailRecord };
    setDocument(payload.data);
  }, [document.id, workspaceId]);

  useEffect(() => {
    if (!["QUEUED", "PROCESSING"].includes(document.status)) return;
    const timer = window.setInterval(() => void refresh(), 2_000);
    return () => window.clearInterval(timer);
  }, [document.status, refresh]);

  const download = async () => {
    setError(null);
    try {
      const response = await fetch(
        `/api/v1/workspaces/${workspaceId}/documents/${document.id}/download-url`,
        { method: "POST" }
      );
      const payload = (await response.json()) as { data?: { url: string }; detail?: string };
      if (!response.ok || !payload.data)
        throw new Error(payload.detail ?? "Download access could not be created.");
      window.location.assign(payload.data.url);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Download failed.");
    }
  };

  const ask = async (event: FormEvent) => {
    event.preventDefault();
    const content = question.trim();
    if (!content || asking) return;
    setAsking(true);
    setAnswer("");
    setCitations([]);
    setError(null);
    try {
      const clientMessageId = crypto.randomUUID();
      const response = await fetch(
        `/api/v1/workspaces/${workspaceId}/documents/${document.id}/questions`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", "Idempotency-Key": clientMessageId },
          body: JSON.stringify({
            clientMessageId,
            question: content,
            modelKey,
            ...(conversationId ? { conversationId } : {})
          })
        }
      );
      if (!response.ok || !response.body) {
        const problem = (await response.json().catch(() => null)) as { detail?: string } | null;
        throw new Error(problem?.detail ?? "The grounded answer could not be started.");
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const result = await reader.read();
        if (result.done) break;
        buffer += decoder.decode(result.value, { stream: true });
        const frames = buffer.split("\n\n");
        buffer = frames.pop() ?? "";
        for (const frame of frames) {
          const eventName = frame.match(/^event: (.+)$/mu)?.[1];
          const rawData = frame.match(/^data: (.+)$/mu)?.[1];
          if (!eventName || !rawData) continue;
          const data = JSON.parse(rawData) as {
            delta?: string;
            conversationId?: string;
            citations?: Citation[];
            message?: string;
          };
          if (eventName === "generation.started") {
            if (data.conversationId) setConversationId(data.conversationId);
            setCitations(data.citations ?? []);
          }
          if (eventName === "message.delta" && data.delta) setAnswer((value) => value + data.delta);
          if (eventName === "generation.error")
            throw new Error(data.message ?? "The AI provider could not complete this answer.");
        }
      }
      setQuestion("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The question could not be answered.");
    } finally {
      setAsking(false);
    }
  };

  const latestRun = document.processingRuns[0];
  return (
    <main className={styles.detail}>
      <Link href={"/documents" as Route} className={styles.backLink}>
        <Icon icon={ArrowLeft} /> Document library
      </Link>
      <header className={styles.detailHeader}>
        <div className={styles.documentIdentity}>
          <span>
            <Icon icon={FileText} />
          </span>
          <div>
            <p className={styles.eyebrow}>
              {mimeLabel(document.mimeType)} / {formatBytes(Number(document.sizeBytes))}
            </p>
            <h1>{document.name}</h1>
            <p>Original file: {document.originalFilename}</p>
          </div>
        </div>
        <div className={styles.detailActions}>
          <StatusPill tone={statusTone(document.status)}>{titleCase(document.status)}</StatusPill>
          <Button
            variant="secondary"
            onClick={() => void download()}
            leadingIcon={<Icon icon={Download} />}
          >
            Download
          </Button>
        </div>
      </header>
      {error ? (
        <p className={styles.alert} role="alert">
          {error}
        </p>
      ) : null}

      <section className={styles.processingRail} aria-label="Document processing status">
        {(["Uploaded", "Validated", "Extracted", "Indexed"] as const).map((label, index) => (
          <div key={label} data-complete={processingStep(document.status) > index || undefined}>
            <span>{String(index + 1).padStart(2, "0")}</span>
            <strong>{label}</strong>
          </div>
        ))}
      </section>

      <div className={styles.detailGrid}>
        <section className={styles.summaryPanel}>
          <div className={styles.panelHeading}>
            <div>
              <p className={styles.eyebrow}>EXTRACTIVE OVERVIEW</p>
              <h2>Document summary</h2>
            </div>
            <Icon icon={ShieldCheck} />
          </div>
          {document.status === "READY" ? (
            <p className={styles.summaryText}>{document.summary}</p>
          ) : document.status === "FAILED" || document.status === "QUARANTINED" ? (
            <div className={styles.failure}>
              <strong>Processing stopped safely</strong>
              <p>
                The file is not available for retrieval. Reference:{" "}
                {document.failureCode ?? "document_processing_failed"}.
              </p>
            </div>
          ) : (
            <div className={styles.pending}>
              <Icon icon={RefreshCw} />
              <strong>Background processing in progress</strong>
              <p>This page updates automatically while extraction and indexing continue.</p>
            </div>
          )}
        </section>
        <aside className={styles.metadataPanel}>
          <p className={styles.eyebrow}>INDEX RECORD</p>
          <dl>
            <div>
              <dt>Pages</dt>
              <dd>{document.pageCount ?? "—"}</dd>
            </div>
            <div>
              <dt>Search chunks</dt>
              <dd>{document.chunkCount}</dd>
            </div>
            <div>
              <dt>Detected type</dt>
              <dd>
                {document.detectedMimeType ? mimeLabel(document.detectedMimeType) : "Pending"}
              </dd>
            </div>
            <div>
              <dt>Latest run</dt>
              <dd>
                {latestRun ? `#${latestRun.attempt} · ${titleCase(latestRun.status)}` : "Pending"}
              </dd>
            </div>
            <div>
              <dt>Processed</dt>
              <dd>
                {document.processedAt
                  ? new Intl.DateTimeFormat("en", {
                      dateStyle: "medium",
                      timeStyle: "short"
                    }).format(new Date(document.processedAt))
                  : "—"}
              </dd>
            </div>
          </dl>
        </aside>
      </div>

      <section className={styles.questionPanel} aria-labelledby="question-title">
        <div className={styles.questionIntro}>
          <span>
            <Icon icon={MessageSquareText} />
          </span>
          <div>
            <p className={styles.eyebrow}>GROUNDED RETRIEVAL</p>
            <h2 id="question-title">Ask this document</h2>
            <p>
              Answers are generated only from retrieved passages. Citations remain attached to the
              persisted conversation.
            </p>
          </div>
        </div>
        <form onSubmit={(event) => void ask(event)}>
          <TextAreaField
            label="Question"
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            placeholder="What does this source say about…"
            disabled={document.status !== "READY" || asking}
            rows={3}
          />
          <Button
            type="submit"
            loading={asking}
            loadingLabel="Reading sources"
            disabled={document.status !== "READY" || !question.trim()}
          >
            Ask with evidence
          </Button>
        </form>
        {answer || asking ? (
          <div className={styles.answer} aria-live="polite">
            <p className={styles.eyebrow}>
              NEXUS ANSWER / {citations.length} SOURCE PASSAGE{citations.length === 1 ? "" : "S"}
            </p>
            <div>{answer || "Retrieving relevant passages…"}</div>
            {citations.length ? (
              <ol>
                {citations.map((citation) => (
                  <li key={citation.ordinal}>
                    <strong>
                      [{citation.ordinal}] {citation.documentName}
                    </strong>
                    <span>
                      {citation.pageStart
                        ? `Page ${citation.pageStart}${citation.pageEnd && citation.pageEnd !== citation.pageStart ? `–${citation.pageEnd}` : ""}`
                        : `Chunk ${citation.ordinal}`}
                    </span>
                    <p>{citation.excerpt}</p>
                  </li>
                ))}
              </ol>
            ) : null}
          </div>
        ) : null}
      </section>
    </main>
  );
}

function processingStep(status: string) {
  if (status === "READY") return 4;
  if (status === "PROCESSING") return 2;
  if (status === "QUEUED") return 1;
  return status === "UPLOADING" ? 0 : 1;
}
function mimeLabel(mime: string) {
  return mime === "application/pdf"
    ? "PDF"
    : mime === "text/plain"
      ? "TXT"
      : mime.includes("wordprocessingml")
        ? "DOCX"
        : mime;
}
function formatBytes(value: number) {
  return value < 1024 ** 2
    ? `${(value / 1024).toFixed(1)} KB`
    : `${(value / 1024 ** 2).toFixed(1)} MB`;
}
function titleCase(value: string) {
  return value.slice(0, 1) + value.slice(1).toLowerCase();
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
