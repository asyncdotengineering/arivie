/* SPDX-License-Identifier: Apache-2.0 */
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  formatLintReport,
  lint,
  loadSemanticLayer,
} from "@arivie/semantic";
import { describe, expect, it, vi } from "vitest";
import { runLint } from "../src/commands/lint.js";
const LINT_SEMANTIC = join(
  import.meta.dirname,
  "fixtures",
  "lint-semantic",
);

describe("lint (dogfood semantic)", () => {
  it("formatLintReport matches fixture snapshot", async () => {
    const layer = await loadSemanticLayer(LINT_SEMANTIC);
    const report = lint(layer);
    expect(report.errors).toEqual([]);
    expect(report.stats.entityCount).toBe(1);
    expect(report.stats.suggestedMode).toBe("preload");
    expect(formatLintReport(report)).toMatchInlineSnapshot(`
      "Arivie semantic-layer lint
      ===========================
      entities:        1
      total tokens:    124
      suggested mode:  preload

      Warnings: none

      Errors: none"
    `);
  });

  it("runLint emits .generated/index.ts and exits 0", async () => {
    const workDir = await mkdtemp(join(tmpdir(), "arivie-lint-"));
    const semanticDir = join(workDir, "semantic");
    const { cp } = await import("node:fs/promises");
    await cp(LINT_SEMANTIC, semanticDir, { recursive: true });

    const configPath = join(workDir, "arivie.config.ts");
    await import("node:fs/promises").then(({ writeFile }) =>
      writeFile(
        configPath,
        `const stub = {
  kind: "postgres",
  id: "postgres:lint",
  url: "postgresql://localhost/x",
  execute: async () => ({ rows: [] }),
  introspect: async () => [],
  setupRole: async () => {},
  sql: { end: async () => {} },
  verifyOwnerIdentity: async () => {},
};
export const config = {
  owner: { id: "lint-test", name: "Lint" },
  model: {},
  storage: stub,
  workspace: { rootDir: "./semantic" },
  sources: {
    postgres: {
      kind: "adapter",
      adapter: stub,
      description: "Lint-test stub Postgres adapter.",
    },
  },
  semantic: { path: "./semantic", mode: "preload" },
  resolveUser: async () => ({ userId: "u", permissions: [], dbRole: "arivie_reader" }),
};
`,
        "utf8",
      ),
    );

    const prevCwd = process.cwd();
    process.chdir(workDir);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    try {
      const code = await runLint(configPath);
      expect(code).toBe(0);
      const generated = await readFile(
        join(semanticDir, ".generated", "index.ts"),
        "utf8",
      );
      expect(generated).toContain("export const entityNames");
      expect(generated).toContain("'orders'");
      expect(logSpy.mock.calls.some((c) => String(c[0]).includes("Emitted"))).toBe(
        true,
      );
    } finally {
      logSpy.mockRestore();
      process.chdir(prevCwd);
      await rm(workDir, { recursive: true, force: true });
    }
  });
});
