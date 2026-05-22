/* SPDX-License-Identifier: Apache-2.0 */
"use client";
import { useState } from "react";
import { Streamdown } from "streamdown";
import { Button } from "@/components/ui/button";
import type {
  Artifact,
  ChartArtifact,
  EntityArtifact,
  QueryArtifact,
  ReportArtifact,
} from "@/lib/artifacts";
import { cn } from "@/lib/utils";

/**
 * Side panel that appears when the active message contains artifacts.
 * Tabbed UI when there are multiple; single-pane when just one.
 */
export function ArtifactPane({
  artifacts,
  onClose,
}: {
  artifacts: Artifact[];
  onClose: () => void;
}) {
  const [activeId, setActiveId] = useState<string | null>(
    artifacts[0]?.id ?? null,
  );
  if (artifacts.length === 0) return null;
  const active = artifacts.find((a) => a.id === activeId) ?? artifacts[0];

  return (
    <aside
      className={cn(
        // Mobile: full-screen overlay above everything
        "fixed inset-0 z-50 bg-background flex flex-col",
        // md+: static side panel
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
        <Button size="sm" variant="ghost" onClick={onClose}>
          ×
        </Button>
      </header>
      <div className="flex-1 overflow-y-auto p-4">
        <ArtifactRenderer artifact={active} />
      </div>
    </aside>
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
      <div className="text-xs text-muted-foreground">
        Vega-Lite spec — render with your charting lib (this starter ships the
        spec; wire vega-embed or @observablehq/plot in the host app).
      </div>
      <pre className="text-xs p-3 bg-muted rounded-md overflow-x-auto">
        {JSON.stringify(a.spec, null, 2)}
      </pre>
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
