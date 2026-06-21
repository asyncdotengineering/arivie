/* SPDX-License-Identifier: Apache-2.0 */
import { cp, mkdir, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "tsup";
import base from "../../tsup.base.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Copy registry + skills source into dist/templates/ at build time so the
 * published CLI tarball is self-contained. Consumers running `arivie add ui`
 * or `arivie add skill` resolve from the CLI's own install dir when neither
 * the dev monorepo nor an installed @arivie/skills package is found.
 */
async function bundleTemplates(): Promise<void> {
  const distTemplates = resolve(__dirname, "dist", "templates");
  await mkdir(distTemplates, { recursive: true });

  const sources = [
    { src: resolve(__dirname, "..", "registry"), name: "registry", marker: "registry-item.json" },
    { src: resolve(__dirname, "..", "skills"),   name: "skills",   marker: "SKILL.md" },
  ] as const;

  for (const { src, name, marker } of sources) {
    if (!existsSync(src)) continue;
    const dest = join(distTemplates, name);
    const entries = await readdir(src, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith(".") || entry.name === "node_modules" || entry.name === "dist" || entry.name === "test") continue;
      const subSrc = join(src, entry.name);
      if (!existsSync(join(subSrc, marker))) continue;
      const subDest = join(dest, entry.name);
      await cp(subSrc, subDest, {
        recursive: true,
        filter: (s) => {
          const segs = s.split("/");
          return !segs.some(
            (seg) => seg === "node_modules" || seg === "dist" || (seg.startsWith(".") && seg !== "."),
          );
        },
      });
    }
  }
}

export default defineConfig({
  ...base,
  entry: ["src/index.ts", "bin/arivie.ts"],
  external: [
    "citty",
    "@clack/prompts",
    "@arivie/core",
    "@arivie/agent",
    "@arivie/db-postgres",
    "@arivie/embeddings",
    "@arivie/semantic",
    "@mastra/pg",
    "ink",
    "react",
    "react/jsx-runtime",
    "ink-text-input",
    "jiti",
    "yaml",
    "zod",
  ],
  onSuccess: bundleTemplates,
});
