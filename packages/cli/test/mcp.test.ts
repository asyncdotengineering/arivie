/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, it } from "vitest";
import { mcpCommand, runMcpCommand } from "../src/commands/mcp.js";

describe("arivie mcp command shape", () => {
  it("exposes a citty subcommand with the documented args", () => {
    expect(mcpCommand.meta).toBeDefined();
    const meta = mcpCommand.meta as { name?: string; description?: string };
    expect(meta.name).toBe("mcp");
    expect(meta.description).toMatch(/MCP server/);
    expect(meta.description).toMatch(/Multi-MCP/);

    const args = mcpCommand.args as Record<string, unknown>;
    expect(args.config).toBeDefined();
    expect(args.http).toBeDefined();
    expect(args.port).toBeDefined();
    expect(args.host).toBeDefined();
    expect(args.path).toBeDefined();
  });

  it("returns non-zero when the config path doesn't exist", async () => {
    const exit = await runMcpCommand({
      configPath: "/tmp/arivie-nope-does-not-exist.ts",
    });
    expect(exit).toBe(1);
  });
});
