/* SPDX-License-Identifier: Apache-2.0 */
/**
 * HS-3 live bench for VercelSandboxFilesystem (RFC-003 v2 §11.1).
 * Run: pnpm --filter @arivie/workspace vitest run test/filesystems/vercel.bench.ts
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import {
  VercelSandboxFilesystem,
  hasVercelBenchCreds,
} from "../../src/filesystems/vercel.js";

const BUDGET_MS = {
  spinUpP95: 3_000,
  upload: 1_000,
  readFileP95: 200,
} as const;

const READ_ITERATIONS = 20;

const sem5FixtureDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../agent/test/fixtures/sem-5",
);

function percentile(values: number[], p: number): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(rank, sorted.length - 1))]!;
}

function formatMs(ms: number): string {
  return `${ms.toFixed(1)}ms`;
}

const lines: string[] = [];

function log(line: string): void {
  lines.push(line);
  console.log(line);
}

describe("HS-3 Vercel Sandbox bench", () => {
  it(
    "measures spin-up, sem-5 upload, readFile round-trip",
    async () => {
      if (!hasVercelBenchCreds()) {
        log(
          "[HS-3] Vercel creds missing — skipping live bench; structural code-path tested with mock",
        );
        return;
      }

      let spinUpMs = 0;
      let uploadMs = 0;
      const readMs: number[] = [];

      const filesystem = new VercelSandboxFilesystem({
        network: { egress: false },
        bench: {
          onSpinUpComplete: (ms) => {
            spinUpMs = ms;
          },
          onUploadComplete: (ms) => {
            uploadMs = ms;
          },
          onReadFileComplete: (ms) => {
            readMs.push(ms);
          },
        },
      });

      try {
        await filesystem.uploadFromHost(sem5FixtureDir, "semantic");

        for (let i = 0; i < READ_ITERATIONS; i++) {
          await filesystem.readFile("semantic/catalog.yml", { encoding: "utf8" });
        }

        const readP50 = percentile(readMs, 50);
        const readP95 = percentile(readMs, 95);

        log("=== HS-3 Vercel Sandbox bench ===");
        log(`spin-up: ${formatMs(spinUpMs)} (budget p95 < ${formatMs(BUDGET_MS.spinUpP95)})`);
        log(
          `sem-5 upload: ${formatMs(uploadMs)} (budget < ${formatMs(BUDGET_MS.upload)})`,
        );
        log(
          `readFile round-trip (${READ_ITERATIONS} iterations): p50=${formatMs(readP50)} p95=${formatMs(readP95)} (budget p95 < ${formatMs(BUDGET_MS.readFileP95)})`,
        );
        log(`network.egress: false (networkPolicy: deny-all)`);

        const failures: string[] = [];
        if (spinUpMs > BUDGET_MS.spinUpP95) {
          failures.push(
            `[HS-3] fired: spin-up = ${formatMs(spinUpMs)} exceeds ${formatMs(BUDGET_MS.spinUpP95)}`,
          );
        }
        if (uploadMs > BUDGET_MS.upload) {
          failures.push(
            `[HS-3] fired: sem-5 upload = ${formatMs(uploadMs)} exceeds ${formatMs(BUDGET_MS.upload)}`,
          );
        }
        if (readP95 > BUDGET_MS.readFileP95) {
          failures.push(
            `[HS-3] fired: readFile p95 = ${formatMs(readP95)} exceeds ${formatMs(BUDGET_MS.readFileP95)}`,
          );
        }

        for (const failure of failures) {
          log(failure);
        }

        expect(failures, failures.join("\n")).toHaveLength(0);
      } finally {
        await filesystem.stop().catch(() => undefined);
      }
    },
    300_000,
  );

  afterAll(async () => {
    const artifactDir = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../../../../../.research/sprints-v0.2/sprint-2/artifacts",
    );
    await fs.mkdir(artifactDir, { recursive: true });
    await fs.writeFile(
      path.join(artifactDir, "c49-vercel-bench.txt"),
      `${lines.join("\n")}\n`,
      "utf8",
    );
  });
});
