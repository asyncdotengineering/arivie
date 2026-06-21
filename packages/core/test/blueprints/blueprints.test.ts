/* SPDX-License-Identifier: Apache-2.0 */
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { ArivieConfigError } from "../../src/errors.js";
import {
  installBlueprint,
  isBlueprintInstalled,
  readInstalledBlueprints,
} from "../../src/blueprints/index.js";
import type { BlueprintDefinition } from "../../src/plugins/types.js";

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function sampleBlueprint(over: Partial<BlueprintDefinition> = {}): BlueprintDefinition {
  return {
    id: "analytics-setup",
    title: "Analytics Setup",
    version: "1.0.0",
    appliesTo: ["analytics"],
    files: [
      { path: "docs/analytics/guide.md", contents: "# Analytics guide\n" },
      { path: "docs/analytics/checklist.md", contents: "- [ ] Connect source\n" },
    ],
    markers: [{ id: "analytics-root", description: "Root marker" }],
    ...over,
  };
}

describe("blueprint install/read", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  function makeDestRoot(): string {
    const dir = mkdtempSync(join(tmpdir(), "arivie-blueprint-"));
    tempDirs.push(dir);
    return dir;
  }

  it("installs files, writes manifest, and reads the record back", () => {
    const destRoot = makeDestRoot();
    const blueprint = sampleBlueprint();

    const result = installBlueprint(blueprint, { destRoot });

    expect(result.written).toEqual([
      "docs/analytics/guide.md",
      "docs/analytics/checklist.md",
    ]);
    expect(result.skipped).toEqual([]);
    expect(result.record.id).toBe("analytics-setup");
    expect(result.record.version).toBe("1.0.0");
    expect(result.record.markers).toEqual(["analytics-root"]);
    expect(result.record.files).toEqual([
      {
        path: "docs/analytics/guide.md",
        sha256: sha256("# Analytics guide\n"),
      },
      {
        path: "docs/analytics/checklist.md",
        sha256: sha256("- [ ] Connect source\n"),
      },
    ]);

    expect(
      readFileSync(join(destRoot, "docs/analytics/guide.md"), "utf8"),
    ).toBe("# Analytics guide\n");
    expect(
      readFileSync(join(destRoot, "docs/analytics/checklist.md"), "utf8"),
    ).toBe("- [ ] Connect source\n");

    const records = readInstalledBlueprints(destRoot);
    expect(records).toHaveLength(1);
    expect(records[0]?.id).toBe("analytics-setup");
    expect(isBlueprintInstalled(destRoot, "analytics-setup")).toBe(true);
    expect(isBlueprintInstalled(destRoot, "missing")).toBe(false);
  });

  it("re-installing the same id replaces the manifest record", () => {
    const destRoot = makeDestRoot();
    const blueprint = sampleBlueprint();

    installBlueprint(blueprint, { destRoot });
    installBlueprint(
      { ...blueprint, version: "1.0.1", title: "Analytics Setup v2" },
      { destRoot, overwrite: true },
    );

    const records = readInstalledBlueprints(destRoot);
    expect(records).toHaveLength(1);
    expect(records[0]?.id).toBe("analytics-setup");
    expect(records[0]?.version).toBe("1.0.1");
  });

  it("skips existing files when overwrite is false", () => {
    const destRoot = makeDestRoot();
    const blueprint = sampleBlueprint();
    const target = join(destRoot, "docs/analytics/guide.md");
    mkdirSync(join(destRoot, "docs/analytics"), { recursive: true });
    writeFileSync(target, "existing content", "utf8");

    const result = installBlueprint(blueprint, { destRoot });

    expect(result.skipped).toEqual(["docs/analytics/guide.md"]);
    expect(result.written).toEqual(["docs/analytics/checklist.md"]);
    expect(readFileSync(target, "utf8")).toBe("existing content");
  });

  it("throws ArivieConfigError for duplicate marker ids", () => {
    const destRoot = makeDestRoot();
    const blueprint = sampleBlueprint({
      markers: [
        { id: "dup" },
        { id: "dup" },
      ],
    });

    expect(() => installBlueprint(blueprint, { destRoot })).toThrow(ArivieConfigError);
    expect(() => installBlueprint(blueprint, { destRoot })).toThrow(
      /duplicate marker "dup"/,
    );
  });

  it("throws when a file path escapes destRoot", () => {
    const destRoot = makeDestRoot();
    const blueprint = sampleBlueprint({
      files: [{ path: "../escape.md", contents: "nope" }],
    });

    expect(() => installBlueprint(blueprint, { destRoot })).toThrow(ArivieConfigError);
    expect(() => installBlueprint(blueprint, { destRoot })).toThrow(/escapes destRoot/);
  });
});
