/* SPDX-License-Identifier: Apache-2.0 */
import { access, copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runAddUi } from "../src/commands/add-ui.js";
import {
  findMonorepoRoot,
  registryNotFoundMessage,
  resolveRegistryComponent,
} from "../src/lib/registry-resolve.js";

const CONSUMER_FIXTURE = join(
  fileURLToPath(new URL(".", import.meta.url)),
  "fixtures/consumer-fixture",
);

describe("registry-resolve", () => {
  it("finds agent-chat in the local monorepo", () => {
    const root = findMonorepoRoot(CONSUMER_FIXTURE);
    expect(root).not.toBeNull();
    const resolved = resolveRegistryComponent("agent-chat", CONSUMER_FIXTURE);
    expect(resolved).not.toBeNull();
    expect(resolved?.item.name).toBe("agent-chat");
    expect(resolved?.fileSources.size).toBe(2);
  });

  it("returns null for unknown components", () => {
    const resolved = resolveRegistryComponent("not-a-component", CONSUMER_FIXTURE);
    expect(resolved).toBeNull();
  });

  it("rejects registry-item.json with traversal in files[].path", async () => {
    const badDir = join(CONSUMER_FIXTURE, "bad-registry-item");
    await mkdir(badDir, { recursive: true });
    await writeFile(
      join(badDir, "registry-item.json"),
      JSON.stringify({
        name: "bad-registry-item",
        type: "registry:ui",
        version: "0.0.0",
        files: [{ path: "../../etc/passwd", type: "registry:component" }],
        dependencies: [],
        shadcnDependencies: [],
        description: "bad",
      }),
      "utf8",
    );
    const resolved = resolveRegistryComponent("bad-registry-item", CONSUMER_FIXTURE);
    expect(resolved).toBeNull();
    await rm(badDir, { recursive: true, force: true });
  });

  it("rejects invalid dependency names in registry-item.json", async () => {
    const badDir = join(CONSUMER_FIXTURE, "bad-deps");
    await mkdir(badDir, { recursive: true });
    await writeFile(
      join(badDir, "registry-item.json"),
      JSON.stringify({
        name: "bad-deps",
        type: "registry:ui",
        version: "0.0.0",
        files: [{ path: "components/arivie/x.tsx", type: "registry:component" }],
        dependencies: ["$(rm -rf /)"],
        shadcnDependencies: [],
        description: "bad deps",
      }),
      "utf8",
    );
    await writeFile(join(badDir, "x.tsx"), "export {};\n", "utf8");
    const resolved = resolveRegistryComponent("bad-deps", CONSUMER_FIXTURE);
    expect(resolved).toBeNull();
    await rm(badDir, { recursive: true, force: true });
  });
});

describe("runAddUi", () => {
  let errSpy: ReturnType<typeof vi.spyOn>;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let shadcnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    const addUi = await import("../src/commands/add-ui.js");
    shadcnSpy = vi.spyOn(addUi, "shadcnOnPath").mockReturnValue(true);
    errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(async () => {
    shadcnSpy.mockRestore();
    errSpy.mockRestore();
    logSpy.mockRestore();
    await rm(join(CONSUMER_FIXTURE, "components"), { recursive: true, force: true });
  });

  it("copies agent-chat files when shadcn is ready", async () => {
    const code = await runAddUi("agent-chat", CONSUMER_FIXTURE);
    expect(code).toBe(0);

    await access(join(CONSUMER_FIXTURE, "components/arivie/agent-chat.tsx"));
    const tsx = await readFile(
      join(CONSUMER_FIXTURE, "components/arivie/agent-chat.tsx"),
      "utf8",
    );
    expect(tsx.length).toBeGreaterThan(0);
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining("components/arivie/agent-chat.tsx"),
    );
  });

  it("prints shadcn init hint without components.json", async () => {
    const fixtureNoShadcn = join(CONSUMER_FIXTURE, "no-shadcn");
    const code = await runAddUi("agent-chat", fixtureNoShadcn);
    expect(code).toBe(1);
    expect(errSpy).toHaveBeenCalledWith(
      expect.stringContaining("pnpm dlx shadcn@latest init"),
    );
  });

  it("exits 1 when registry component is missing", async () => {
    const code = await runAddUi("not-a-real-component", CONSUMER_FIXTURE);
    expect(code).toBe(1);
    expect(errSpy).toHaveBeenCalledWith(registryNotFoundMessage());
  });

  it("refuses to overwrite without --force", async () => {
    const first = await runAddUi("agent-chat", CONSUMER_FIXTURE);
    expect(first).toBe(0);

    const code = await runAddUi("agent-chat", CONSUMER_FIXTURE);
    expect(code).toBe(1);
    expect(errSpy).toHaveBeenCalledWith(
      expect.stringContaining("use --force to overwrite"),
    );
  });

  it("overwrites when --force is set", async () => {
    const dest = join(CONSUMER_FIXTURE, "components/arivie/agent-chat.tsx");
    await mkdir(join(CONSUMER_FIXTURE, "components/arivie"), { recursive: true });
    await writeFile(dest, "// stale\n", "utf8");

    const code = await runAddUi("agent-chat", CONSUMER_FIXTURE, { force: true });
    expect(code).toBe(0);
    const tsx = await readFile(dest, "utf8");
    expect(tsx).not.toContain("// stale");
  });
});
