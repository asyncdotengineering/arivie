/* SPDX-License-Identifier: Apache-2.0 */
"use client";
import { useMemo, useState } from "react";
import { Streamdown } from "streamdown";
import {
  defineRegistry,
  JSONUIProvider,
  Renderer,
  type Spec,
} from "@json-render/react";
import { shadcnComponents } from "@json-render/shadcn";
import { arivieUiCatalog } from "@arivie/ui-catalog";
import type {
  Artifact,
  ChartArtifact,
  EntityArtifact,
  QueryArtifact,
  ReportArtifact,
} from "./artifacts.js";

export interface ArtifactPaneProps {
  artifacts: Artifact[];
  onClose: () => void;
}

const cn = (...parts: (string | false | undefined)[]) =>
  parts.filter(Boolean).join(" ");

// Shared json-render registry — one source of truth for what the agent
// can render. Same catalog the MCP server exposes, so a spec the model
// emits via tool output renders identically in both surfaces.
//
// Custom Arivie components (ArivieMetric, ArivieQueryResult, etc.) fall
// back to a minimal renderer here — host apps that want custom visuals
// can re-export ArtifactPane with their own registry. The shadcn
// components carry the heavy lifting (Card, Table, Charts, Badge, ...).
const arivieFallback = (label: string) =>
  ({ props }: { props: Record<string, unknown> }) =>
    (
      <div className="my-2 p-3 bg-muted rounded-md">
        <div className="text-xs text-muted-foreground mb-1">{label}</div>
        <pre className="text-xs overflow-x-auto">
          {JSON.stringify(props, null, 2)}
        </pre>
      </div>
    );

const { registry } = (defineRegistry as unknown as (
  c: unknown,
  opts: unknown,
) => { registry: unknown })(arivieUiCatalog, {
  components: {
    ...shadcnComponents,
    ArivieMetric: arivieFallback("ArivieMetric"),
    ArivieQueryResult: arivieFallback("ArivieQueryResult"),
    ArivieVerdict: arivieFallback("ArivieVerdict"),
    ArivieSemanticEntity: arivieFallback("ArivieSemanticEntity"),
  },
});

/**
 * Side panel for agent artifacts. Mobile = full-screen overlay; md+ =
 * 480px right-hand panel. Tabs across the top when there are 2+
 * artifacts. Per-kind rendering:
 *
 *   - query    → hand-rolled SQL view (Streamdown-free, lightweight)
 *   - report   → Streamdown for markdown + path header
 *   - entity   → labelled field card
 *   - chart    → json-render `<Renderer />` for the Vega-Lite spec OR
 *                falls through to a JSON view when the spec doesn't
 *                target our catalog. Specs that DO target the catalog
 *                (e.g. an agent that emits a full Card layout) render
 *                via the same Renderer.
 */
export function ArtifactPane({ artifacts, onClose }: ArtifactPaneProps) {
  const [activeId, setActiveId] = useState<string | null>(
    artifacts[0]?.id ?? null,
  );
  if (artifacts.length === 0) return null;
  const active = artifacts.find((a) => a.id === activeId) ?? artifacts[0]!;

  return (
    <JSONUIProvider registry={registry as never}>
      <aside
        className={cn(
          "fixed inset-0 z-50 bg-background flex flex-col",
          "md:static md:inset-auto md:z-0 md:w-[480px] md:border-l md:border-border",
        )}
      >
        <header className="flex items-center justify-between px-4 py-2 border-b border-border">
          <div className="flex gap-1 overflow-x-auto">
            {artifacts.map((a) => (
              <button
                key={a.id}
                type="button"
                onClick={() => setActiveId(a.id)}
                className={cn(
                  "px-2 py-1 text-xs rounded-sm whitespace-nowrap transition-colors",
                  a.id === active.id
                    ? "bg-primary/10 text-foreground"
                    : "text-muted-foreground hover:bg-muted",
                )}
              >
                {a.title ?? `${a.kind} ${a.id.slice(0, 6)}`}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="px-2 py-1 text-sm text-muted-foreground hover:text-foreground"
          >
            ×
          </button>
        </header>
        <div className="flex-1 overflow-y-auto p-4">
          <ArtifactRenderer artifact={active} />
        </div>
      </aside>
    </JSONUIProvider>
  );
}

function ArtifactRenderer({ artifact }: { artifact: Artifact }) {
  switch (artifact.kind) {
    case "query":
      return <QueryView a={artifact} />;
    case "chart":
      return <ChartView a={artifact} />;
    case "report":
      return <ReportView a={artifact} />;
    case "entity":
      return <EntityView a={artifact} />;
  }
}

function QueryView({ a }: { a: QueryArtifact }) {
  return (
    <div className="space-y-3">
      <div>
        <div className="text-xs uppercase tracking-wide text-muted-foreground">
          {a.dialect} query
        </div>
        {a.title && (
          <h2 className="text-base font-semibold mt-0.5">{a.title}</h2>
        )}
      </div>
      <pre className="text-xs p-3 bg-muted rounded-md overflow-x-auto whitespace-pre-wrap break-words">
        {a.sql}
      </pre>
      {(a.rowCount != null || a.durationMs != null) && (
        <div className="text-xs text-muted-foreground flex gap-3">
          {a.rowCount != null && <span>{a.rowCount} rows</span>}
          {a.durationMs != null && <span>{a.durationMs} ms</span>}
        </div>
      )}
      {a.explanation && (
        <div className="text-sm text-muted-foreground border-l-2 border-border pl-3">
          {a.explanation}
        </div>
      )}
    </div>
  );
}

function ChartView({ a }: { a: ChartArtifact }) {
  // If the spec is a json-render Spec (has `elements:`), route through
  // <Renderer />. Otherwise fall back to a JSON view (the consumer will
  // wire vega-embed or @observablehq/plot for raw Vega-Lite specs).
  const isJsonRenderSpec =
    typeof a.spec === "object" &&
    a.spec != null &&
    "elements" in a.spec;
  return (
    <div className="space-y-3">
      <div>
        <div className="text-xs uppercase tracking-wide text-muted-foreground">
          Chart
        </div>
        {a.title && (
          <h2 className="text-base font-semibold mt-0.5">{a.title}</h2>
        )}
      </div>
      {isJsonRenderSpec ? (
        <Renderer
          registry={registry as never}
          spec={a.spec as unknown as Spec}
        />
      ) : (
        <>
          <div className="text-xs text-muted-foreground">
            Vega-Lite spec — render with your charting lib (this starter ships
            the spec; wire vega-embed or @observablehq/plot in the host app).
          </div>
          <pre className="text-xs p-3 bg-muted rounded-md overflow-x-auto">
            {JSON.stringify(a.spec, null, 2)}
          </pre>
        </>
      )}
    </div>
  );
}

function ReportView({ a }: { a: ReportArtifact }) {
  return (
    <div className="space-y-3">
      <div>
        <div className="text-xs uppercase tracking-wide text-muted-foreground">
          Report
          {a.path && <span className="ml-2 font-mono">{a.path}</span>}
        </div>
        {a.title && (
          <h2 className="text-base font-semibold mt-0.5">{a.title}</h2>
        )}
      </div>
      <div className="prose prose-sm dark:prose-invert max-w-none">
        <Streamdown>{a.markdown}</Streamdown>
      </div>
    </div>
  );
}

function EntityView({ a }: { a: EntityArtifact }) {
  return (
    <div className="space-y-3">
      <div>
        <div className="text-xs uppercase tracking-wide text-muted-foreground">
          {a.entityKind} · {a.entityId}
        </div>
        {a.title && (
          <h2 className="text-base font-semibold mt-0.5">{a.title}</h2>
        )}
      </div>
      <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-2 text-sm">
        {a.fields.map((f) => (
          <div
            key={`${a.id}-${f.label}`}
            className="contents [&>*]:py-1 [&>*]:border-b [&>*]:border-border/40"
          >
            <dt className="text-muted-foreground">{f.label}</dt>
            <dd className="font-medium">{formatField(f.value, f.format)}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function formatField(
  v: string | number | boolean | null,
  format?: EntityArtifact["fields"][number]["format"],
): string {
  if (v === null) return "—";
  if (format === "currency" && typeof v === "number") {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: "USD",
    }).format(v);
  }
  if (format === "percent" && typeof v === "number") {
    return `${(v * 100).toFixed(1)}%`;
  }
  if (format === "number" && typeof v === "number") {
    return new Intl.NumberFormat().format(v);
  }
  if (format === "date" && typeof v === "string") {
    return new Date(v).toLocaleDateString();
  }
  if (format === "datetime" && typeof v === "string") {
    return new Date(v).toLocaleString();
  }
  return String(v);
}
