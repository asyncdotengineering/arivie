/* SPDX-License-Identifier: Apache-2.0 */
"use client";

import { useMemo } from "react";
import { Diff, Hunk, parseDiff } from "react-diff-view";
import "react-diff-view/style/index.css";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export interface EvalDiffProps {
  goldenSql: string;
  agentSql: string;
  className?: string;
}

function buildUnifiedDiff(left: string, right: string): string {
  const leftLines = left.split("\n");
  const rightLines = right.split("\n");
  const max = Math.max(leftLines.length, rightLines.length);
  const body: string[] = [
    "--- golden.sql",
    "+++ agent.sql",
    `@@ -1,${leftLines.length} +1,${rightLines.length} @@`,
  ];
  for (let i = 0; i < max; i += 1) {
    const l = leftLines[i];
    const r = rightLines[i];
    if (l === r) {
      if (l !== undefined) body.push(` ${l}`);
    } else {
      if (l !== undefined) body.push(`-${l}`);
      if (r !== undefined) body.push(`+${r}`);
    }
  }
  return body.join("\n");
}

export function EvalDiff({ goldenSql, agentSql, className }: EvalDiffProps) {
  const files = useMemo(() => {
    const patch = buildUnifiedDiff(goldenSql, agentSql);
    return parseDiff(patch);
  }, [goldenSql, agentSql]);

  const file = files[0];

  return (
    <Tabs defaultValue="split" className={className}>
      <TabsList>
        <TabsTrigger value="split">Side by side</TabsTrigger>
        <TabsTrigger value="golden">Golden only</TabsTrigger>
        <TabsTrigger value="agent">Agent only</TabsTrigger>
      </TabsList>
      <TabsContent value="split" className="mt-3 overflow-x-auto rounded-md border">
        {file ? (
          <Diff viewType="split" diffType="modify" hunks={file.hunks}>
            {(hunks) =>
              hunks.map((hunk) => <Hunk key={hunk.content} hunk={hunk} />)
            }
          </Diff>
        ) : (
          <p className="p-4 text-sm text-muted-foreground">No differences.</p>
        )}
      </TabsContent>
      <TabsContent value="golden" className="mt-3">
        <pre className="overflow-x-auto rounded-md border bg-muted p-3 text-xs">
          <code>{goldenSql}</code>
        </pre>
      </TabsContent>
      <TabsContent value="agent" className="mt-3">
        <pre className="overflow-x-auto rounded-md border bg-muted p-3 text-xs">
          <code>{agentSql}</code>
        </pre>
      </TabsContent>
    </Tabs>
  );
}
