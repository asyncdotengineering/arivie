/* SPDX-License-Identifier: Apache-2.0 */
import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Arivie + Next.js",
  description: "Minimal Next.js example using @arivie/react and the registry AgentChat surface",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
