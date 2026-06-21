/* SPDX-License-Identifier: Apache-2.0 */
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadDotEnv } from "../src/lib/load-env.js";

const KEYS = ["ARIVIE_TEST_ROOT", "ARIVIE_TEST_LOCAL", "ARIVIE_TEST_REAL"];

describe("loadDotEnv", () => {
  beforeEach(() => {
    for (const k of KEYS) delete process.env[k];
  });
  afterEach(() => {
    for (const k of KEYS) delete process.env[k];
  });

  it("loads .env from parent dirs and .env.local from the config dir, without overriding real env", async () => {
    const root = await mkdtemp(join(tmpdir(), "arivie-env-"));
    const sub = join(root, "example");
    await mkdir(sub, { recursive: true });
    // repo-root style .env (a parent of the config dir)
    await writeFile(join(root, ".env"), "ARIVIE_TEST_ROOT=from-root\nARIVIE_TEST_REAL=from-file\n");
    // example .env.local (the config dir)
    await writeFile(join(sub, ".env.local"), "ARIVIE_TEST_LOCAL=from-local\n");

    // A real env var must win over the file.
    process.env.ARIVIE_TEST_REAL = "from-real-env";

    loadDotEnv(join(sub, "arivie.config.ts"));

    expect(process.env.ARIVIE_TEST_ROOT).toBe("from-root"); // walked up to parent
    expect(process.env.ARIVIE_TEST_LOCAL).toBe("from-local"); // config dir .env.local
    expect(process.env.ARIVIE_TEST_REAL).toBe("from-real-env"); // not overridden
  });

  it("is a no-op when no env files exist", async () => {
    const dir = await mkdtemp(join(tmpdir(), "arivie-noenv-"));
    expect(() => loadDotEnv(join(dir, "arivie.config.ts"))).not.toThrow();
    expect(process.env.ARIVIE_TEST_ROOT).toBeUndefined();
  });
});
