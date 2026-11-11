import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

import { ToastProvider } from "@/components/feedback/toast";
import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import { getServerEnvironment } from "@/platform/env/server";
import "@/styles/globals.css";

const environment = getServerEnvironment();

export const metadata: Metadata = {
  metadataBase: new URL(environment.appBaseUrl),
  title: {
    default: "NEXUS AI",
    template: "%s · NEXUS AI"
  },
  description:
    "A private workspace for connected conversations, documents, durable knowledge, and governed workflows.",
  applicationName: "NEXUS AI",
  openGraph: {
    type: "website",
    url: "/",
    siteName: "NEXUS AI",
    title: "NEXUS AI — Your work deserves a memory",
    description:
      "One private workspace for context, evidence, durable knowledge, and deliberate intelligence.",
    images: [
      {
        url: "/og.png",
        width: 1731,
        height: 909,
        alt: "NEXUS AI — Your work deserves a memory, not another tab."
      }
    ]
  },
  twitter: {
    card: "summary_large_image",
    title: "NEXUS AI — Your work deserves a memory",
    description: "One private workspace for context, evidence, and deliberate intelligence.",
    images: ["/og.png"]
  }
};

export const viewport: Viewport = {
  colorScheme: "dark",
  themeColor: "#08090d"
};

interface RootLayoutProps {
  readonly children: ReactNode;
}

export default function RootLayout({ children }: RootLayoutProps) {
  return (
    <html lang="en">
      <body>
        <a className="skip-link" href="#main-content">
          Skip to content
        </a>
        <SiteHeader />
        <ToastProvider>
          <main id="main-content">{children}</main>
        </ToastProvider>
        <SiteFooter />
      </body>
    </html>
  );
}
