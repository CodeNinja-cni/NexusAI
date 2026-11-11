import JSZip from "jszip";
import { describe, expect, it } from "vitest";

import {
  chunkDocument,
  createExtractiveSummary,
  extractDocument
} from "@/modules/documents/server/extraction";

describe("document extraction", () => {
  it("validates and chunks UTF-8 text", async () => {
    const extracted = await extractDocument(
      new TextEncoder().encode("NEXUS evidence starts here.\n\nA second section is searchable."),
      "text/plain"
    );
    expect(extracted.detectedMimeType).toBe("text/plain");
    expect(chunkDocument(extracted)[0]).toMatchObject({ ordinal: 0, pageStart: 1 });
    expect(createExtractiveSummary(extracted.text)).toContain("second section");
  });

  it("extracts a structurally valid DOCX container", async () => {
    const zip = new JSZip();
    zip.file(
      "[Content_Types].xml",
      '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
    );
    zip
      .folder("_rels")
      ?.file(
        ".rels",
        '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'
      );
    zip
      .folder("word")
      ?.file(
        "document.xml",
        '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Private DOCX evidence</w:t></w:r></w:p></w:body></w:document>'
      );
    const bytes = await zip.generateAsync({ type: "uint8array" });
    const extracted = await extractDocument(
      bytes,
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    );
    expect(extracted.text).toContain("Private DOCX evidence");
  });

  it("extracts text and page locators from a valid PDF", async () => {
    const extracted = await extractDocument(createPdf("Private PDF evidence"), "application/pdf");
    expect(extracted.text).toContain("Private PDF evidence");
    expect(extracted.pageCount).toBe(1);
    expect(extracted.pages).toEqual([{ page: 1, start: 0, end: 20 }]);
  });

  it("rejects malformed and mismatched files without parsing them", async () => {
    await expect(
      extractDocument(new TextEncoder().encode("not a pdf"), "application/pdf")
    ).rejects.toMatchObject({ code: "file_type_mismatch", quarantine: true });
    await expect(
      extractDocument(new Uint8Array([0xff, 0xfe, 0xfd]), "text/plain")
    ).rejects.toMatchObject({ code: "invalid_text_encoding" });
  });
});

function createPdf(text: string) {
  const stream = `BT /F1 12 Tf 72 720 Td (${text}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) {
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(pdf, "binary"));
}
