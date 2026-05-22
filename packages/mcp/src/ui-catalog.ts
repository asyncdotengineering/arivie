/* SPDX-License-Identifier: Apache-2.0 */
import { defineCatalog } from "@json-render/core";
import { schema } from "@json-render/react/schema";
import { shadcnComponentDefinitions } from "@json-render/shadcn/catalog";
import { z } from "zod";

/**
 * The Arivie UI catalog — components a json-render-aware MCP client
 * (Claude Desktop, Cursor, ChatGPT UI mode) can render when our agent
 * returns a spec instead of plain text.
 *
 * Shape: shadcn defaults (Card, Table, Badge, Accordion, BarChart,
 * LineChart, PieChart, Metric, etc. — 36 components) PLUS Arivie-specific
 * analytics components for the things our agent actually emits:
 *
 *   - `ArivieMetric` — a single KPI tile with optional delta direction
 *   - `ArivieQueryResult` — SQL + rows + timing, ready to render
 *   - `ArivieVerdict` — skill-style status pill (healthy/watch/breached)
 *   - `ArivieSemanticEntity` — show what's available in the semantic layer
 *
 * The catalog is also exposed to the model via the tool description, so
 * Gemini/OpenAI/Anthropic can target it correctly without hallucinating
 * components that don't exist.
 */
export const arivieUiCatalog = defineCatalog(schema, {
  components: {
    ...shadcnComponentDefinitions,

    ArivieMetric: {
      props: z.object({
        label: z.string().describe("KPI label, e.g. 'Revenue (yesterday)'"),
        value: z.string().describe("Pre-formatted value, e.g. '$4,449.38'"),
        format: z
          .enum(["currency", "percent", "number", "text"])
          .nullable()
          .describe("Optional render hint for the value"),
        delta: z
          .string()
          .nullable()
          .describe("Optional change indicator, e.g. '+12.3%'"),
        deltaDirection: z
          .enum(["up", "down", "flat"])
          .nullable()
          .describe("Direction the delta points"),
      }),
      description:
        "A single KPI tile. Use for headline numbers (revenue, ticket count, comp%). " +
        "Use ArivieQueryResult for the underlying rows + SQL, and Card+Grid for layouts.",
    },

    ArivieQueryResult: {
      props: z.object({
        sql: z.string().describe("The SQL that ran"),
        rows: z
          .array(z.record(z.string(), z.unknown()))
          .describe("Result rows verbatim from the database"),
        truncated: z
          .boolean()
          .nullable()
          .describe("True if the result was capped by rowsPerQuery"),
        durationMs: z
          .number()
          .nullable()
          .describe("Query execution time in milliseconds"),
        source: z
          .string()
          .nullable()
          .describe("Which source ran it, e.g. 'postgres'"),
      }),
      description:
        "Renders a SQL execution result — SQL block, rows table, timing badge. " +
        "Use whenever you ran execute_<source> and want the user to see the underlying query.",
    },

    ArivieVerdict: {
      props: z.object({
        status: z
          .enum(["healthy", "watch", "breached", "info"])
          .describe("Verdict category"),
        message: z.string().describe("One-line message, e.g. 'Comp% breached'"),
        threshold: z
          .string()
          .nullable()
          .describe("Optional threshold string, e.g. '> 3%'"),
      }),
      description:
        "A skill-style verdict pill. Emit one when a threshold was breached or " +
        "a quality flag fires. Pair with ArivieMetric for the headline.",
    },

    ArivieSemanticEntity: {
      props: z.object({
        entityName: z.string(),
        description: z.string().nullable(),
        measures: z
          .array(
            z.object({
              name: z.string(),
              description: z.string().nullable(),
            }),
          )
          .nullable(),
        dimensions: z
          .array(
            z.object({
              name: z.string(),
              description: z.string().nullable(),
            }),
          )
          .nullable(),
        segments: z
          .array(
            z.object({
              name: z.string(),
              description: z.string().nullable(),
            }),
          )
          .nullable(),
      }),
      description:
        "Renders one entity from the semantic layer — useful when the user asks " +
        "'what can I query for X?' or wants to see available measures.",
    },
  },
  actions: {
    refine_query: {
      description:
        "User wants to refine the SQL (different filter, different group-by). Re-run the agent.",
    },
    explain_measure: {
      description:
        "User wants to see how a measure is defined in the semantic layer. Open the entity card.",
    },
    export_result: {
      description:
        "User wants to export the current result (CSV / Markdown). Trigger the export tool.",
    },
  },
});
