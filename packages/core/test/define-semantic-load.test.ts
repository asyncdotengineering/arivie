/* SPDX-License-Identifier: Apache-2.0 */
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("@mastra/pg", () => ({
  PostgresStore: class MockPostgresStore {
    __setLogger = (): void => {};
    init = async (): Promise<void> => {};
    close = async (): Promise<void> => {};
  },
}));

import { LoadError } from "@arivie/semantic";
import { defineArivie } from "../src/define.js";

const mockModel = { provider: "mock" };
const mockSource = {
  kind: "postgres",
  id: "postgres:mock",
  url: "postgres://localhost/arivie",
  sql: {},
  execute: async () => ({
    rows: [],
    rowCount: 0,
    durationMs: 0,
    truncated: false,
  }),
  introspect: async () => [],
  verifyOwnerIdentity: async () => {},
  setupRole: async () => {},
};
const resolveUser = async () => ({
  userId: "user-1",
  permissions: [] as string[],
  dbRole: "arivie_reader",
});

describe("defineArivie semantic load (KI-1-01)", () => {
  it("warns and uses an empty layer when the semantic root is missing", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const missingRoot = join(
      tmpdir(),
      `arivie-missing-semantic-${Date.now()}`,
    );

    const instance = await defineArivie({
      owner: { id: "owner-1", name: "Acme" },
      model: mockModel,
      workspace: { rootDir: missingRoot },
      sources: {
        postgres: { adapter: mockSource, description: "Test source." },
      },
      semantic: { path: missingRoot, mode: "auto" },
      resolveUser,
    });

    expect(instance.agent).toBeDefined();
    expect(instance.workspace).toBeDefined();
    expect(
      warn.mock.calls.some((call) =>
        String(call[0]).includes("semantic layer dir not found"),
      ),
    ).toBe(true);
    warn.mockRestore();
  });

  it("rethrows LoadError when entity YAML is malformed", async () => {
    const root = await mkdtemp(join(tmpdir(), "arivie-bad-semantic-"));
    const entitiesDir = join(root, "entities");
    await mkdir(entitiesDir, { recursive: true });
    await writeFile(
      join(entitiesDir, "bad.yml"),
      "name: orders\n  badly_indented:\n",
      "utf8",
    );

    await expect(
      defineArivie({
        owner: { id: "owner-1", name: "Acme" },
        model: mockModel,
        workspace: { rootDir: root },
        sources: {
          postgres: { adapter: mockSource, description: "Test source." },
        },
        semantic: { path: root, mode: "auto" },
        resolveUser,
      }),
    ).rejects.toThrow(LoadError);
  });
});
