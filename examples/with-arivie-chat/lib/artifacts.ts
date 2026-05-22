/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Arivie artifact shapes. Adapted from vercel/chatbot's artifact subsystem
 * (code / sheet / text / image) into analytics-native kinds:
 *
 *   - query   — a SQL query the agent composed (read-only). Has dialect +
 *               optional explanation. Renders as a syntax-highlighted code
 *               block with a "Run again" affordance hook (parent app wires).
 *   - chart   — a Vega-Lite spec the agent produced from query results.
 *               The client renders inline; spec is the source of truth.
 *   - report  — a long-form markdown analysis the agent wrote to the
 *               workspace. Renders side-by-side with the chat.
 *   - entity  — a structured business object (customer, outlet, product,
 *               …) — rendered as a labelled field card.
 *
 * Wire path: the /api/chat route inspects each tool-output frame the agent
 * emits; if the tool's output matches one of these shapes, the route also
 * writes a `data-artifact-<kind>` part into the UI message stream via the
 * AI SDK 6 dataStream writer. The client picks them up and routes to the
 * matching renderer.
 */
import { z } from "zod";

export const QueryArtifactSchema = z.object({
  kind: z.literal("query"),
  id: z.string(),
  title: z.string().optional(),
  sql: z.string(),
  dialect: z.enum(["postgres", "mysql", "sqlite", "bigquery", "snowflake"]),
  explanation: z.string().optional(),
  /** Wall-clock ms the executor took, if known. */
  durationMs: z.number().optional(),
  /** Row count returned, if known. */
  rowCount: z.number().optional(),
});
export type QueryArtifact = z.infer<typeof QueryArtifactSchema>;

export const ChartArtifactSchema = z.object({
  kind: z.literal("chart"),
  id: z.string(),
  title: z.string().optional(),
  /** Vega-Lite v5 spec. Client renders inline. */
  spec: z.record(z.string(), z.unknown()),
  /** Source query artifact id, if this chart was built from a query. */
  fromQueryId: z.string().optional(),
});
export type ChartArtifact = z.infer<typeof ChartArtifactSchema>;

export const ReportArtifactSchema = z.object({
  kind: z.literal("report"),
  id: z.string(),
  title: z.string().optional(),
  /** Full markdown body. */
  markdown: z.string(),
  /** Workspace path where the report was saved, if persisted. */
  path: z.string().optional(),
});
export type ReportArtifact = z.infer<typeof ReportArtifactSchema>;

export const EntityArtifactSchema = z.object({
  kind: z.literal("entity"),
  id: z.string(),
  title: z.string().optional(),
  /** e.g. "customer", "outlet", "product" — domain noun. */
  entityKind: z.string(),
  /** Stable external id. */
  entityId: z.string(),
  /** Ordered, labeled fields the agent surfaced. */
  fields: z.array(
    z.object({
      label: z.string(),
      value: z.union([z.string(), z.number(), z.boolean(), z.null()]),
      /** Optional formatting hint for the renderer (currency, date, …). */
      format: z
        .enum(["text", "currency", "date", "datetime", "number", "percent"])
        .optional(),
    }),
  ),
});
export type EntityArtifact = z.infer<typeof EntityArtifactSchema>;

export const ArtifactSchema = z.discriminatedUnion("kind", [
  QueryArtifactSchema,
  ChartArtifactSchema,
  ReportArtifactSchema,
  EntityArtifactSchema,
]);
export type Artifact = z.infer<typeof ArtifactSchema>;

export type ArtifactKind = Artifact["kind"];

/**
 * Heuristic mapping from a tool's output payload to an artifact, when the
 * tool didn't explicitly tag its output as one. Used to upgrade existing
 * Arivie tools (`execute_<source>`, `write_report`, …) to artifacts
 * without forcing tool authors to change anything. Returns null if the
 * payload doesn't look like a known artifact shape.
 */
export function detectArtifact(
  toolName: string,
  output: unknown,
  idGen: () => string,
): Artifact | null {
  if (output == null || typeof output !== "object") return null;
  const o = output as Record<string, unknown>;

  // 1) Explicit kind tag wins (forward-compat — tools can set this).
  if (typeof o.kind === "string") {
    const parsed = ArtifactSchema.safeParse({ id: idGen(), ...o });
    if (parsed.success) return parsed.data;
  }

  // 2) execute_<source> → query artifact when the executor returns sql+rows.
  if (toolName.startsWith("execute_") && typeof o.sql === "string") {
    return {
      kind: "query",
      id: idGen(),
      sql: o.sql,
      dialect:
        (typeof o.dialect === "string" &&
          ["postgres", "mysql", "sqlite", "bigquery", "snowflake"].includes(
            o.dialect,
          ) &&
          (o.dialect as QueryArtifact["dialect"])) ||
        "postgres",
      title: typeof o.title === "string" ? o.title : undefined,
      explanation:
        typeof o.explanation === "string" ? o.explanation : undefined,
      rowCount:
        typeof o.rowCount === "number"
          ? o.rowCount
          : Array.isArray(o.rows)
            ? (o.rows as unknown[]).length
            : undefined,
      durationMs: typeof o.durationMs === "number" ? o.durationMs : undefined,
    };
  }

  // 3) write_report / write_markdown → report artifact.
  if (
    (toolName === "write_report" || toolName === "write_markdown") &&
    typeof o.markdown === "string"
  ) {
    return {
      kind: "report",
      id: idGen(),
      markdown: o.markdown,
      title: typeof o.title === "string" ? o.title : undefined,
      path: typeof o.path === "string" ? o.path : undefined,
    };
  }

  // 4) finalize_report → report artifact. This is the agent's terminal
  // tool — it ends the stream, so without lifting it into an artifact
  // the user sees a collapsed tool-call row and nothing else. The tool
  // args carry { narrative, sql, csvResults } which we render as a
  // markdown report with the SQL fenced and the CSV table formatted.
  if (toolName === "finalize_report") {
    const narrative = typeof o.narrative === "string" ? o.narrative : null;
    const sql = typeof o.sql === "string" ? o.sql : null;
    const csv = typeof o.csvResults === "string" ? o.csvResults : null;
    if (narrative || sql || csv) {
      const parts: string[] = [];
      if (narrative) parts.push(narrative);
      if (csv) parts.push("\n## Results\n\n" + csvToMarkdown(csv));
      if (sql) parts.push("\n## SQL\n\n```sql\n" + sql + "\n```");
      return {
        kind: "report",
        id: idGen(),
        title: typeof o.title === "string" ? o.title : "Report",
        markdown: parts.join("\n"),
      };
    }
  }

  return null;
}

/**
 * Render a CSV-shaped string as a markdown table. Best-effort — falls
 * back to a fenced code block if parsing produces an uneven row.
 */
function csvToMarkdown(csv: string): string {
  const rows = csv
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.split(","));
  if (rows.length === 0) return "```\n" + csv + "\n```";
  const header = rows[0];
  const widths = header.length;
  if (rows.some((r) => r.length !== widths)) {
    return "```\n" + csv + "\n```";
  }
  const sep = header.map(() => "---");
  return [header, sep, ...rows.slice(1)]
    .map((r) => `| ${r.join(" | ")} |`)
    .join("\n");
}
