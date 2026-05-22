/* SPDX-License-Identifier: Apache-2.0 */
import type { Workspace } from "@mastra/core/workspace";
import { createTool } from "@mastra/core/tools";
import { z } from "zod";

const finalizeReportInputSchema = z.object({
  sql: z.string().describe("Final SQL used for the analysis"),
  csvResults: z.string().describe("CSV-formatted query results"),
  narrative: z.string().describe("Human-readable report narrative"),
});

export type FinalizeReportInput = z.infer<typeof finalizeReportInputSchema>;

export type FinalizeReportResult = FinalizeReportInput;

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
  return (
    filesystemKind(workspace) !== "local" && finalizeReport !== false
  );
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

export function finalizeReportTool() {
  return createTool({
    id: "finalize_report",
    description:
      "Finalize the analysis report with the SQL, CSV results, and narrative. Calling this tool ends the agent run.",
    inputSchema: finalizeReportInputSchema,
    execute: async (input): Promise<FinalizeReportResult> => input,
  });
}
