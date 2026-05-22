/* SPDX-License-Identifier: Apache-2.0 */
"use client";

import { useSchema } from "@arivie/react";
import { ChevronRight, Database, Loader2 } from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

export interface SemanticBrowserProps {
  endpoint?: string;
  className?: string;
}

function entityLabel(entity: Record<string, unknown>): string {
  if (typeof entity.name === "string") return entity.name;
  if (typeof entity.table === "string") return entity.table;
  return "entity";
}

function entityDescription(entity: Record<string, unknown>): string | null {
  if (typeof entity.description === "string") return entity.description;
  return null;
}

function columnEntries(
  entity: Record<string, unknown>,
): { name: string; description: string | null }[] {
  const columns = entity.columns;
  if (!Array.isArray(columns)) return [];
  return columns.flatMap((col) => {
    if (typeof col !== "object" || col === null) return [];
    const record = col as Record<string, unknown>;
    const name =
      typeof record.name === "string"
        ? record.name
        : typeof record.column === "string"
          ? record.column
          : null;
    if (!name) return [];
    const description =
      typeof record.description === "string" ? record.description : null;
    return [{ name, description }];
  });
}

export function SemanticBrowser({
  endpoint = "/api/arivie/schema",
  className,
}: SemanticBrowserProps) {
  const { entities, status } = useSchema({ endpoint });

  if (status === "loading") {
    return (
      <p className={`flex items-center gap-2 text-sm text-muted-foreground ${className ?? ""}`}>
        <Loader2 className="size-4 animate-spin" aria-hidden />
        Loading semantic layer…
      </p>
    );
  }

  if (status === "error") {
    return (
      <p className={`text-sm text-destructive ${className ?? ""}`}>
        Failed to load schema.
      </p>
    );
  }

  if (entities.length === 0) {
    return (
      <p className={`text-sm text-muted-foreground ${className ?? ""}`}>
        No entities in the semantic catalog.
      </p>
    );
  }

  return (
    <nav
      className={`space-y-1 ${className ?? ""}`}
      aria-label="Semantic entities"
    >
      {entities.map((entity) => {
        const label = entityLabel(entity);
        const description = entityDescription(entity);
        const columns = columnEntries(entity);
        return (
          <Collapsible key={label} className="rounded-md border px-2 py-1">
            <CollapsibleTrigger className="flex w-full items-center gap-2 py-2 text-left text-sm font-medium">
              <ChevronRight className="size-4 shrink-0 transition-transform [[data-state=open]_&]:rotate-90" />
              <Database className="size-4 text-muted-foreground" aria-hidden />
              <span>{label}</span>
            </CollapsibleTrigger>
            <CollapsibleContent className="pb-2 pl-8">
              {description ? (
                <p className="mb-2 text-xs text-muted-foreground">
                  {description}
                </p>
              ) : null}
              <ul className="space-y-1 text-xs">
                {columns.map((col) => (
                  <li key={col.name}>
                    <span className="font-mono">{col.name}</span>
                    {col.description ? (
                      <span className="text-muted-foreground">
                        {" "}
                        — {col.description}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </CollapsibleContent>
          </Collapsible>
        );
      })}
    </nav>
  );
}
