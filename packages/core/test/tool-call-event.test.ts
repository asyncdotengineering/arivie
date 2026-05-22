/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, it } from "vitest";
import type {
  ExecutePostgresToolEvent,
  ToolCallEvent,
  WorkspaceBashToolEvent,
  WorkspaceWriteFileToolEvent,
} from "../src/types.js";

describe("ToolCallEvent discriminated union", () => {
  it("narrows args by tool name when switching", () => {
    // The point of this test is the TypeScript narrowing, not the runtime
    // assertion. If this file compiles, narrowing works.
    const events: ToolCallEvent[] = [
      { tool: "execute_postgres", args: { sql: "SELECT 1" } },
      {
        tool: "mastra_workspace_write_file",
        args: { path: "reports/eod.md", content: "# Hello", overwrite: true },
      },
      { tool: "workspace_bash", args: { argv: ["python3", "scratch/x.py"] } },
    ];

    function handle(event: ToolCallEvent): string {
      switch (event.tool) {
        case "execute_postgres": {
          const e: ExecutePostgresToolEvent = event;
          return `sql:${e.args.sql.length}`;
        }
        case "mastra_workspace_write_file": {
          const e: WorkspaceWriteFileToolEvent = event;
          return `write:${e.args.path}`;
        }
        case "workspace_bash": {
          const e: WorkspaceBashToolEvent = event;
          return `bash:${e.args.argv.join(" ")}`;
        }
        default:
          return `other:${event.tool}`;
      }
    }

    expect(events.map(handle)).toEqual([
      "sql:8",
      "write:reports/eod.md",
      "bash:python3 scratch/x.py",
    ]);
  });
});
