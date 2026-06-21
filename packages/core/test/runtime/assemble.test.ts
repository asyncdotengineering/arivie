/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, it } from "vitest";
import { ArivieConfigError } from "../../src/errors.js";
import { buildManifest } from "../../src/manifest/index.js";
import { definePlugin } from "../../src/plugins/index.js";
import { assembleAgentContext } from "../../src/runtime/assemble.js";
import { defineAgent } from "../../src/runtime/index.js";

const APP = { id: "app", name: "App" };

function analyticsLikePlugin() {
  return definePlugin({
    id: "analytics",
    version: "1.0.0",
    permissions: [{ id: "analytics.sql.read", description: "read sql" }],
    capabilities: [
      {
        id: "analytics.query",
        title: "Query",
        description: "Query analytics.",
        requiredPermissions: ["analytics.sql.read"],
      },
    ],
    setup: () => ({
      tools: { execute_warehouse: { id: "execute_warehouse" } as never },
      instructions: "You can query the warehouse.",
    }),
  })(undefined);
}

function workspacePlugin() {
  return definePlugin({
    id: "workspace",
    version: "1.0.0",
    capabilities: [{ id: "workspace.files", title: "Files", description: "Edit files." }],
    setup: () => ({
      tools: { write_file: { id: "write_file" } as never },
      instructions: "You can write files.",
    }),
  })(undefined);
}

async function manifestWith() {
  const { manifest } = await buildManifest({
    app: APP,
    plugins: [analyticsLikePlugin(), workspacePlugin()],
  });
  return manifest;
}

describe("assembleAgentContext", () => {
  it("gives an agent only the tools+instructions of its declared capabilities", async () => {
    const manifest = await manifestWith();
    const ctx = assembleAgentContext(
      "analyst",
      defineAgent({ instructions: "Be helpful.", capabilities: ["analytics.query"] }),
      manifest,
    );
    expect(Object.keys(ctx.tools)).toEqual(["execute_warehouse"]);
    expect(ctx.instructions).toContain("Be helpful.");
    expect(ctx.instructions).toContain("You can query the warehouse.");
    expect(ctx.instructions).not.toContain("write files");
    expect(ctx.pluginIds).toEqual(["analytics"]);
  });

  it("unions tools across multiple capabilities", async () => {
    const manifest = await manifestWith();
    const ctx = assembleAgentContext(
      "power",
      defineAgent({
        instructions: "x",
        capabilities: ["analytics.query", "workspace.files"],
      }),
      manifest,
    );
    expect(Object.keys(ctx.tools).sort()).toEqual(["execute_warehouse", "write_file"]);
    expect(ctx.pluginIds.sort()).toEqual(["analytics", "workspace"]);
  });

  it("gives a no-capability agent no plugin tools", async () => {
    const manifest = await manifestWith();
    const ctx = assembleAgentContext("plain", defineAgent({ instructions: "x" }), manifest);
    expect(Object.keys(ctx.tools)).toEqual([]);
    expect(ctx.instructions).toBe("x");
  });

  it("throws on an unknown capability", async () => {
    const manifest = await manifestWith();
    expect(() =>
      assembleAgentContext(
        "bad",
        defineAgent({ instructions: "x", capabilities: ["does.not.exist"] }),
        manifest,
      ),
    ).toThrow(ArivieConfigError);
  });
});
