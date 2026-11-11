import "server-only";

import { connect } from "node:net";

import { getServerEnvironment } from "@/platform/env/server";

export interface ScanResult {
  readonly clean: boolean;
  readonly engine: "structural" | "clamav";
  readonly signature?: string | undefined;
}

export async function scanDocument(bytes: Uint8Array): Promise<ScanResult> {
  const environment = getServerEnvironment();
  if (environment.documents.scanner === "structural") {
    return { clean: true, engine: "structural" };
  }
  return scanWithClamAv(bytes, environment.documents.clamavHost, environment.documents.clamavPort);
}

function scanWithClamAv(bytes: Uint8Array, host: string, port: number) {
  return new Promise<ScanResult>((resolve, reject) => {
    const socket = connect({ host, port });
    const chunks: Buffer[] = [];
    const timeout = setTimeout(() => socket.destroy(new Error("scanner_timeout")), 30_000);

    socket.once("connect", () => {
      socket.write("zINSTREAM\0");
      const blockSize = 64 * 1024;
      for (let offset = 0; offset < bytes.byteLength; offset += blockSize) {
        const chunk = Buffer.from(
          bytes.subarray(offset, Math.min(offset + blockSize, bytes.length))
        );
        const length = Buffer.allocUnsafe(4);
        length.writeUInt32BE(chunk.length);
        socket.write(length);
        socket.write(chunk);
      }
      socket.write(Buffer.alloc(4));
    });
    socket.on("data", (chunk: Buffer) => chunks.push(chunk));
    socket.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    socket.once("end", () => {
      clearTimeout(timeout);
      const response = Buffer.concat(chunks).toString("utf8").replaceAll("\0", "").trim();
      if (response.endsWith("OK")) {
        resolve({ clean: true, engine: "clamav" });
        return;
      }
      const found = response.match(/: (.+) FOUND$/u);
      if (found?.[1]) {
        resolve({ clean: false, engine: "clamav", signature: found[1].slice(0, 80) });
        return;
      }
      reject(new Error("scanner_invalid_response"));
    });
  });
}
