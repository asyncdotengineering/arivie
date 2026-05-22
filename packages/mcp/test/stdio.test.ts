/* SPDX-License-Identifier: Apache-2.0 */
import type { MCPServer } from "@mastra/mcp";
import { describe, expect, it, vi } from "vitest";
import { startStdioServer } from "../src/stdio.js";

describe("startStdioServer", () => {
  it("calls mcp.startStdio once and resolves", async () => {
    const startStdio = vi.fn().mockResolvedValue(undefined);
    const mcp = { startStdio } as unknown as MCPServer;

    await startStdioServer({ mcp });

    expect(startStdio).toHaveBeenCalledOnce();
  });
});
