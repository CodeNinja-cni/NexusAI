"use client";

import { useEffect } from "react";

interface GlobalErrorProps {
  readonly error: Error & { digest?: string };
  readonly retry: () => void;
}

export default function GlobalError({ error, retry }: GlobalErrorProps) {
  useEffect(() => {
    console.error(`A root error was contained${error.digest ? ` (${error.digest})` : ""}.`);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          minHeight: "100vh",
          margin: 0,
          display: "grid",
          placeItems: "center",
          padding: "1.5rem",
          background: "#08090d",
          color: "#f5f5f7",
          fontFamily: "system-ui, sans-serif"
        }}
      >
        <title>Application error · NEXUS AI</title>
        <main style={{ maxWidth: "38rem" }}>
          <p style={{ color: "#9297a5" }}>Root application error</p>
          <h1 style={{ fontSize: "clamp(2rem, 8vw, 4rem)", lineHeight: 1.05 }}>
            NEXUS AI needs a fresh start.
          </h1>
          <p style={{ color: "#c3c6d0", lineHeight: 1.65 }}>
            The top-level application shell could not be rendered. Retry once; persistent failures
            should be investigated through server logs.
          </p>
          <button
            type="button"
            onClick={retry}
            style={{
              border: 0,
              borderRadius: "999px",
              padding: "0.75rem 1rem",
              background: "#2457ff",
              color: "#f5f5f7",
              cursor: "pointer",
              fontWeight: 700
            }}
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
