import "server-only";

import { createHash } from "node:crypto";

import { fileTypeFromBuffer } from "file-type";
import mammoth from "mammoth";

import { getServerEnvironment } from "@/platform/env/server";

export const SUPPORTED_DOCUMENT_TYPES = {
  "application/pdf": ["pdf"],
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ["docx"],
  "text/plain": ["txt"]
} as const;

export type SupportedDocumentMime = keyof typeof SUPPORTED_DOCUMENT_TYPES;

export interface ExtractedDocument {
  readonly text: string;
  readonly pageCount: number | null;
  readonly detectedMimeType: SupportedDocumentMime;
  readonly extractor: string;
  readonly pages: readonly {
    readonly page: number;
    readonly start: number;
    readonly end: number;
  }[];
}

export interface PreparedChunk {
  readonly ordinal: number;
  readonly content: string;
  readonly tokenCount: number;
  readonly pageStart: number | null;
  readonly pageEnd: number | null;
  readonly charStart: number;
  readonly charEnd: number;
  readonly contentSha256: string;
}

export class DocumentExtractionError extends Error {
  constructor(
    readonly code:
      | "file_type_mismatch"
      | "malformed_pdf"
      | "malformed_docx"
      | "invalid_text_encoding"
      | "document_page_limit_exceeded"
      | "document_text_limit_exceeded"
      | "document_has_no_text",
    readonly quarantine: boolean
  ) {
    super(code);
  }
}

export async function extractDocument(bytes: Uint8Array, declaredMime: SupportedDocumentMime) {
  const detected = await fileTypeFromBuffer(bytes);
  if (declaredMime === "application/pdf") {
    if (detected?.mime !== "application/pdf") {
      throw new DocumentExtractionError("file_type_mismatch", true);
    }
    return extractPdf(bytes);
  }
  if (declaredMime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
    if (detected?.mime !== declaredMime) {
      throw new DocumentExtractionError("file_type_mismatch", true);
    }
    return extractDocx(bytes);
  }
  if (detected) throw new DocumentExtractionError("file_type_mismatch", true);
  return extractText(bytes);
}

export function chunkDocument(extracted: ExtractedDocument): readonly PreparedChunk[] {
  const environment = getServerEnvironment().documents;
  const chunks: PreparedChunk[] = [];
  let start = 0;

  while (start < extracted.text.length) {
    let end = Math.min(start + environment.chunkCharacters, extracted.text.length);
    if (end < extracted.text.length) {
      const boundary = Math.max(
        extracted.text.lastIndexOf("\n", end),
        extracted.text.lastIndexOf(" ", end)
      );
      if (boundary > start + Math.floor(environment.chunkCharacters / 2)) end = boundary;
    }
    const raw = extracted.text.slice(start, end);
    const leading = raw.length - raw.trimStart().length;
    const content = raw.trim();
    const charStart = start + leading;
    const charEnd = charStart + content.length;
    if (content) {
      const overlappingPages = extracted.pages.filter(
        (page) => page.end > charStart && page.start < charEnd
      );
      chunks.push({
        ordinal: chunks.length,
        content,
        tokenCount: Math.max(1, Math.ceil([...content].length / 4)),
        pageStart: overlappingPages.at(0)?.page ?? null,
        pageEnd: overlappingPages.at(-1)?.page ?? null,
        charStart,
        charEnd,
        contentSha256: createHash("sha256").update(content).digest("hex")
      });
    }
    if (end >= extracted.text.length) break;
    start = Math.max(start + 1, end - environment.chunkOverlapCharacters);
  }

  if (chunks.length === 0) throw new DocumentExtractionError("document_has_no_text", false);
  return chunks;
}

export function createExtractiveSummary(text: string) {
  const paragraphs = text
    .split(/\n{2,}/u)
    .map((value) => value.trim())
    .filter(Boolean)
    .slice(0, 4);
  const summary = paragraphs.join(" ").replace(/\s+/gu, " ").trim();
  return summary.length <= 1_500 ? summary : `${summary.slice(0, 1_497).trimEnd()}…`;
}

function normalizeText(value: string, allowEmpty = false) {
  const normalized = value
    .normalize("NFC")
    .replaceAll("\r\n", "\n")
    .replaceAll("\r", "\n")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/gu, " ")
    .replace(/[ \t]+/gu, " ")
    .replace(/ *\n */gu, "\n")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
  if (normalized.length > 10_000_000) {
    throw new DocumentExtractionError("document_text_limit_exceeded", false);
  }
  if (!normalized && !allowEmpty) throw new DocumentExtractionError("document_has_no_text", false);
  return normalized;
}

async function extractPdf(bytes: Uint8Array): Promise<ExtractedDocument> {
  try {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const loadingTask = pdfjs.getDocument({
      data: bytes.slice(),
      useSystemFonts: false,
      verbosity: 0
    });
    const pdf = await loadingTask.promise;
    if (pdf.numPages > getServerEnvironment().documents.maxPages) {
      await loadingTask.destroy();
      throw new DocumentExtractionError("document_page_limit_exceeded", false);
    }
    const pageTexts: string[] = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      pageTexts.push(
        content.items
          .flatMap((item) => ("str" in item && typeof item.str === "string" ? [item.str] : []))
          .join(" ")
      );
      page.cleanup();
    }
    await loadingTask.destroy();
    return withPageOffsets(pageTexts, "application/pdf", "pdfjs-6");
  } catch (error) {
    if (error instanceof DocumentExtractionError) throw error;
    throw new DocumentExtractionError("malformed_pdf", false);
  }
}

async function extractDocx(bytes: Uint8Array): Promise<ExtractedDocument> {
  try {
    validateDocxContainer(bytes);
    const result = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });
    const text = normalizeText(result.value);
    return {
      text,
      pageCount: null,
      detectedMimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      extractor: "mammoth-1",
      pages: [{ page: 1, start: 0, end: text.length }]
    };
  } catch (error) {
    if (error instanceof DocumentExtractionError) throw error;
    throw new DocumentExtractionError("malformed_docx", false);
  }
}

function extractText(bytes: Uint8Array): ExtractedDocument {
  try {
    const text = normalizeText(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    return {
      text,
      pageCount: null,
      detectedMimeType: "text/plain",
      extractor: "utf8-text-1",
      pages: [{ page: 1, start: 0, end: text.length }]
    };
  } catch (error) {
    if (error instanceof DocumentExtractionError) throw error;
    throw new DocumentExtractionError("invalid_text_encoding", false);
  }
}

function withPageOffsets(
  values: readonly string[],
  detectedMimeType: SupportedDocumentMime,
  extractor: string
): ExtractedDocument {
  const pages: { page: number; start: number; end: number }[] = [];
  const normalizedPages = values.map((value) => normalizeText(value, true));
  let text = "";
  for (const [index, value] of normalizedPages.entries()) {
    if (!value) continue;
    if (text) text += "\n\n";
    const start = text.length;
    text += value;
    pages.push({ page: index + 1, start, end: text.length });
  }
  text = normalizeText(text);
  return {
    text,
    pageCount: values.length,
    detectedMimeType,
    extractor,
    pages
  };
}

function validateDocxContainer(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let entries = 0;
  let uncompressedBytes = 0;
  let hasContentTypes = false;
  let hasDocument = false;
  const decoder = new TextDecoder();

  for (let offset = 0; offset + 46 <= view.byteLength; offset += 1) {
    if (view.getUint32(offset, true) !== 0x02014b50) continue;
    const uncompressed = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    if (offset + 46 + nameLength + extraLength + commentLength > view.byteLength) {
      throw new DocumentExtractionError("malformed_docx", false);
    }
    const name = decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength));
    entries += 1;
    uncompressedBytes += uncompressed;
    hasContentTypes ||= name === "[Content_Types].xml";
    hasDocument ||= name === "word/document.xml";
    if (entries > 2_000 || uncompressedBytes > 50 * 1024 * 1024) {
      throw new DocumentExtractionError("malformed_docx", true);
    }
    offset += 45 + nameLength + extraLength + commentLength;
  }
  if (entries === 0 || !hasContentTypes || !hasDocument) {
    throw new DocumentExtractionError("malformed_docx", false);
  }
}
