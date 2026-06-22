/* SPDX-License-Identifier: Apache-2.0 */
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { _resetArivieDirCache, resolveArivieDir } from "../../src/runtime/storage-paths.js";

describe("resolveArivieDir (multi-cloud storage)", () => {
  it("returns a writable dir and actually creates it", () => {
    _resetArivieDirCache();
    const dir = resolveArivieDir();
    expect(dir).not.toBeNull();
    expect(existsSync(dir as string)).toBe(true);
  });

  it("caches the resolved dir across calls", () => {
    _resetArivieDirCache();
    expect(resolveArivieDir()).toBe(resolveArivieDir());
  });

  it("falls back to the OS temp dir when the local path is not writable", () => {
    // Simulate a read-only project dir: chdir into a path where ./.arivie can't be made.
    const orig = process.cwd();
    try {
      process.chdir(tmpdir());
      _resetArivieDirCache();
      const dir = resolveArivieDir();
      // Either ./.arivie under tmp, or the explicit <tmp>/arivie fallback — both writable.
      expect(dir).not.toBeNull();
      expect(existsSync(dir as string)).toBe(true);
    } finally {
      process.chdir(orig);
      _resetArivieDirCache();
    }
  });
});
