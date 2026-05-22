/* SPDX-License-Identifier: Apache-2.0 */
"use client";

import { ChevronDown } from "lucide-react";
import { useEffect, useId, useState } from "react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Button } from "@/components/ui/button";

export interface SqlInspectorProps {
  sql: string;
  language?: string;
  defaultOpen?: boolean;
  className?: string;
}

interface ShikiHighlighter {
  codeToHtml: (
    code: string,
    options: { lang: string; theme: string },
  ) => Promise<string>;
}

type ShikiModule = {
  codeToHtml: ShikiHighlighter["codeToHtml"];
  createHighlighter?: (options: {
    themes: string[];
    langs: string[];
  }) => Promise<ShikiHighlighter>;
};

async function highlightSql(
  sql: string,
  language: string,
): Promise<string | null> {
  try {
    const shiki = (await import("shiki")) as ShikiModule;
    if (typeof shiki.createHighlighter === "function") {
      const highlighter = await shiki.createHighlighter({
        themes: ["github-dark"],
        langs: [language],
      });
      return highlighter.codeToHtml(sql, {
        lang: language,
        theme: "github-dark",
      });
    }
    if (typeof shiki.codeToHtml === "function") {
      return shiki.codeToHtml(sql, { lang: language, theme: "github-dark" });
    }
    return null;
  } catch {
    return null;
  }
}

export function SqlInspector({
  sql,
  language = "sql",
  defaultOpen = false,
  className,
}: SqlInspectorProps) {
  const [open, setOpen] = useState(defaultOpen);
  const [html, setHtml] = useState<string | null>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void highlightSql(sql, language).then((result) => {
      if (!cancelled) setHtml(result);
    });
    return () => {
      cancelled = true;
    };
  }, [open, sql, language]);

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className={className}
    >
      <CollapsibleTrigger asChild>
        <Button variant="ghost" size="sm" className="gap-1">
          Show SQL
          <ChevronDown
            className={`size-4 transition-transform ${open ? "rotate-180" : ""}`}
            aria-hidden
          />
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent id={panelId} className="mt-2">
        {html ? (
          <article
            className="overflow-x-auto rounded-md border bg-muted/40 p-3 text-sm [&_pre]:m-0"
            dangerouslySetInnerHTML={{ __html: html }}
          />
        ) : (
          <pre className="overflow-x-auto rounded-md border bg-muted p-3 text-xs">
            <code>{sql}</code>
          </pre>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}
