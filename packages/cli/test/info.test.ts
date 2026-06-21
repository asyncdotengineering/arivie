/* SPDX-License-Identifier: Apache-2.0 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { runInfo, type ManifestInfo } from "../src/commands/info.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixture = join(__dirname, "fixtures", "info-app.config.ts");

function capture() {
  const lines: string[] = [];
  return { log: (l: string) => lines.push(l), text: () => lines.join("\n") };
}

describe("arivie info", () => {
  it("exits 0 and emits the plugin/capability/context graph as JSON", async () => {
    const out = capture();
    const code = await runInfo(fixture, { json: true, log: out.log });
    expect(code).toBe(0);
    const info = JSON.parse(out.text()) as ManifestInfo;
    expect(info.app.id).toBe("info-test");
    expect(info.plugins.map((p) => p.id)).toContain("demo");
    expect(info.capabilities.map((c) => c.id)).toContain("demo.help");
    expect(info.capabilities.find((c) => c.id === "demo.help")?.plugin).toBe("demo");
    expect(info.contextSchemas.map((s) => s.id)).toContain("demo.note");
    expect(info.permissions).toContain("database.read");
    expect(info.diagnostics.filter((d) => d.severity === "error")).toHaveLength(0);
  });

  it("prints a human summary by default", async () => {
    const out = capture();
    const code = await runInfo(fixture, { log: out.log });
    expect(code).toBe(0);
    const text = out.text();
    expect(text).toContain("Info Test App");
    expect(text).toContain("demo.help");
    expect(text).toContain("Diagnostics: 0 error(s)");
  });

  it("exits 1 when the config cannot be loaded", async () => {
    const out = capture();
    const code = await runInfo(join(__dirname, "fixtures", "does-not-exist.config.ts"), {
      json: true,
      log: out.log,
    });
    expect(code).toBe(1);
    expect(JSON.parse(out.text())).toHaveProperty("error");
  });
});
