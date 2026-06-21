/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ArivieConfigError } from "../../src/errors.js";
import { definePlugin } from "../../src/plugins/index.js";
import type { PluginRuntimeContribution } from "../../src/plugins/types.js";
import { assertManifestValid, buildManifest } from "../../src/manifest/index.js";

const APP = { id: "test-app", name: "Test App" };

function pluginWith(
  id: string,
  over: Parameters<typeof definePlugin>[0] = { id, version: "1.0.0" },
) {
  return definePlugin({ id, version: "1.0.0", ...over })(undefined);
}

function pluginWithSetup(id: string, contribution: PluginRuntimeContribution) {
  return definePlugin({
    id,
    version: "1.0.0",
    setup: () => contribution,
  })(undefined);
}

describe("buildManifest — happy path", () => {
  it("merges static metadata across plugins without diagnostics", async () => {
    const a = pluginWith("a", {
      id: "a",
      version: "1.0.0",
      permissions: [{ id: "database.read", description: "read" }],
      capabilities: [
        { id: "a.query", title: "Q", description: "d", requiredPermissions: ["database.read"] },
      ],
      contextSchemas: [{ id: "a.schema", kind: "knowledge" }],
    });
    const b = pluginWith("b", {
      id: "b",
      version: "2.0.0",
      capabilities: [{ id: "b.act", title: "A", description: "d" }],
    });

    const { manifest, diagnostics } = await buildManifest({ app: APP, plugins: [a, b] });
    expect(diagnostics).toHaveLength(0);
    expect(manifest.plugins.map((p) => p.id)).toEqual(["a", "b"]);
    expect(manifest.capabilities.get("a.query")?.pluginId).toBe("a");
    expect(manifest.capabilities.get("b.act")?.pluginId).toBe("b");
    expect(manifest.contextSchemas.get("a.schema")?.pluginId).toBe("a");
    expect(manifest.permissions.get("database.read")).toEqual(["a"]);
  });

  it("static-only build (runSetup=false) skips setup", async () => {
    let ran = false;
    const p = definePlugin({
      id: "p",
      version: "1.0.0",
      setup: () => {
        ran = true;
        return {};
      },
    })(undefined);
    const { manifest } = await buildManifest({ app: APP, plugins: [p], runSetup: false });
    expect(ran).toBe(false);
    expect(manifest.hasRuntime).toBe(false);
  });

  it("merges runtime contributions when setup runs", async () => {
    const p = pluginWithSetup("p", {
      schedules: [{ id: "s", cron: "0 9 * * *", prompt: "go" }],
      routes: [{ method: "POST", path: "/p/hook", handler: () => new Response("ok") }],
    });
    const { manifest } = await buildManifest({ app: APP, plugins: [p] });
    expect(manifest.hasRuntime).toBe(true);
    expect(manifest.schedules).toHaveLength(1);
    expect(manifest.routes.get("POST /p/hook")?.pluginId).toBe("p");
  });
});

describe("buildManifest — collision diagnostics", () => {
  it("flags duplicate plugin ids", async () => {
    const { diagnostics } = await buildManifest({
      app: APP,
      plugins: [pluginWith("dup"), pluginWith("dup")],
    });
    expect(diagnostics.some((d) => /Duplicate plugin id "dup"/.test(d.message))).toBe(true);
  });

  it("flags duplicate capability ids across plugins, naming both", async () => {
    const a = pluginWith("a", {
      id: "a",
      version: "1.0.0",
      capabilities: [{ id: "shared", title: "A", description: "d" }],
    });
    const b = pluginWith("b", {
      id: "b",
      version: "1.0.0",
      capabilities: [{ id: "shared", title: "B", description: "d" }],
    });
    const { diagnostics } = await buildManifest({ app: APP, plugins: [a, b] });
    const collision = diagnostics.find((d) => d.id === "collision.capability.shared");
    expect(collision?.message).toMatch(/"a" and "b"/);
  });

  it("flags duplicate context schema ids", async () => {
    const a = pluginWith("a", {
      id: "a",
      version: "1.0.0",
      contextSchemas: [{ id: "ctx", kind: "knowledge" }],
    });
    const b = pluginWith("b", {
      id: "b",
      version: "1.0.0",
      contextSchemas: [{ id: "ctx", kind: "knowledge" }],
    });
    const { diagnostics } = await buildManifest({ app: APP, plugins: [a, b] });
    expect(diagnostics.some((d) => d.id === "collision.context schema.ctx")).toBe(true);
  });

  it("flags duplicate tool names from setup", async () => {
    const tool = { id: "t" } as never;
    const a = pluginWithSetup("a", { tools: { execute: tool } });
    const b = pluginWithSetup("b", { tools: { execute: tool } });
    const { diagnostics } = await buildManifest({ app: APP, plugins: [a, b] });
    expect(diagnostics.some((d) => d.id === "collision.tool.execute")).toBe(true);
  });

  it("flags duplicate channel names from setup", async () => {
    const channel = { name: "gh", trigger: {} as never, config: {} } as never;
    const a = pluginWithSetup("a", { channels: [channel] });
    const b = pluginWithSetup("b", { channels: [channel] });
    const { diagnostics } = await buildManifest({ app: APP, plugins: [a, b] });
    expect(diagnostics.some((d) => d.id === "collision.channel.gh")).toBe(true);
  });

  it("flags duplicate route method+path from setup", async () => {
    const route = { method: "POST" as const, path: "/x", handler: () => new Response() };
    const a = pluginWithSetup("a", { routes: [route] });
    const b = pluginWithSetup("b", { routes: [route] });
    const { diagnostics } = await buildManifest({ app: APP, plugins: [a, b] });
    expect(diagnostics.some((d) => d.id === "collision.route.POST /x")).toBe(true);
  });
});

describe("assertManifestValid", () => {
  it("throws on fatal diagnostics", async () => {
    const { diagnostics } = await buildManifest({
      app: APP,
      plugins: [pluginWith("dup"), pluginWith("dup")],
    });
    expect(() => assertManifestValid(diagnostics)).toThrow(ArivieConfigError);
  });

  it("does not throw on a clean manifest", async () => {
    const { diagnostics } = await buildManifest({ app: APP, plugins: [pluginWith("a")] });
    expect(() => assertManifestValid(diagnostics)).not.toThrow();
  });
});
