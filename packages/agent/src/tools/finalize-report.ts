/* SPDX-License-Identifier: Apache-2.0 */
import type { Workspace } from "@mastra/core/workspace";
import { createTool } from "@mastra/core/tools";
import { z } from "zod";

const finalizeReportInputSchema = z.object({
  sql: z.string().describe("Final SQL used for the analysis"),
  csvResults: z.string().describe("CSV-formatted query results"),
  narrative: z.string().describe("Human-readable report narrative"),
  title: z
    .string()
    .optional()
    .describe(
      "Optional short title for the report — appears as the file H1 and the UI tab label",
    ),
});

export type FinalizeReportInput = z.infer<typeof finalizeReportInputSchema>;

/**
 * Terminal tool output. Returns the original input PLUS a `path` to the
 * persisted markdown file in the workspace, so the UI can fetch the
 * durable artifact (survives session refresh, not just the in-memory
 * tool-call args).
 */
export type FinalizeReportResult = FinalizeReportInput & {
  /** Workspace-relative path of the persisted markdown report. */
  path: string;
};

function filesystemKind(workspace: Workspace): string {
  const filesystem = workspace.filesystem;
  if (
    filesystem != null &&
    typeof filesystem === "object" &&
    "kind" in filesystem &&
    typeof filesystem.kind === "string"
  ) {
    return filesystem.kind;
  }
  return "local";
}

/** REQ-53.c: register iff sandboxed filesystem and finalizeReport not opted out. */
export function shouldRegisterFinalizeReport(
  workspace: Workspace,
  finalizeReport?: boolean,
): boolean {
  return filesystemKind(workspace) !== "local" && finalizeReport !== false;
}

type MastraToolStepPart = {
  toolName?: string;
  payload?: { toolName?: string };
};

type StopWhenStep = {
  toolCalls?: MastraToolStepPart[];
  toolResults?: MastraToolStepPart[];
};

function stepPartToolName(part: MastraToolStepPart): string | undefined {
  return part.toolName ?? part.payload?.toolName;
}

/** Terminates the agent loop after `finalize_report` is invoked (Mastra stopWhen). */
export function finalizeReportStopWhen({
  steps,
}: {
  steps: StopWhenStep[];
}): boolean {
  for (const step of steps) {
    if (
      step.toolCalls?.some(
        (call) => stepPartToolName(call) === "finalize_report",
      )
    ) {
      return true;
    }
    if (
      step.toolResults?.some(
        (result) => stepPartToolName(result) === "finalize_report",
      )
    ) {
      return true;
    }
  }
  return false;
}

function reportFilename(): string {
  const stamp = new Date()
    .toISOString()
    .replace(/[:.]/g, "-")
    .slice(0, 19);
  const rand = Math.random().toString(36).slice(2, 8);
  return `reports/${stamp}-${rand}.md`;
}

function csvToMarkdownTable(csv: string): string {
  const rows: string[][] = csv
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.split(","));
  const header = rows[0];
  if (header == null) return "```\n" + csv + "\n```";
  const widths = header.length;
  for (const r of rows) {
    if (r.length !== widths) return "```\n" + csv + "\n```";
  }
  const sep = header.map(() => "---");
  return [header, sep, ...rows.slice(1)]
    .map((r) => `| ${r.join(" | ")} |`)
    .join("\n");
}

function composeReportMarkdown(input: FinalizeReportInput): string {
  const lines: string[] = [];
  if (input.title) {
    lines.push(`# ${input.title}`, "");
  }
  if (input.narrative) {
    lines.push(input.narrative, "");
  }
  if (input.csvResults) {
    lines.push("## Results", "", csvToMarkdownTable(input.csvResults), "");
  }
  if (input.sql) {
    lines.push("## SQL", "", "```sql", input.sql, "```", "");
  }
  return lines.join("\n");
}

/**
 * `finalize_report` — terminal analysis tool.
 *
 * Now actually writes the report to the workspace (was args-only until
 * the ZTD pass). The persisted file is the durable artifact; the
 * returned `path` lets the UI fetch it on demand and keeps the report
 * recoverable across session refreshes.
 */
export function finalizeReportTool(workspace?: Workspace) {
  return createTool({
    id: "finalize_report",
    description:
      "Finalize the analysis report with the SQL, CSV results, and narrative. Persists a markdown file to the workspace under reports/ and returns its path. Calling this tool ENDS the agent run — do not call other tools after it.",
    inputSchema: finalizeReportInputSchema,
    execute: async (raw): Promise<FinalizeReportResult> => {
      // Mastra's createTool signature wraps the validated input in
      // `{ context: ... }` on newer versions and passes it inline on
      // older ones — accept both shapes so this works across versions.
      const input =
        (raw as { context?: FinalizeReportInput }).context ??
        (raw as unknown as FinalizeReportInput);
      const markdown = composeReportMarkdown(input);
      const filename = reportFilename();

      // Persist when we have a workspace filesystem; otherwise fall back
      // to args-only mode (the client's heuristic detector still lifts
      // the report into an artifact card from the tool args).
      const fs = workspace?.filesystem as
        | { write?: (path: string, contents: string) => Promise<void> }
        | undefined;
      if (fs?.write != null) {
        try {
          await fs.write(filename, markdown);
        } catch {
          // Workspace write failures shouldn't sink the tool — the
          // in-memory tool args still carry the full report.
        }
      }

      return {
        ...input,
        path: filename,
      };
    },
  });
}
