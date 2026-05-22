/* SPDX-License-Identifier: Apache-2.0 */
"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export interface WorkflowListProps {
  className?: string;
}

export function WorkflowList({ className }: WorkflowListProps) {
  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="text-base">Workflows</CardTitle>
        <CardDescription>
          v0.1 placeholder — full saved-question workflows ship in v1.x
        </CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">
          Use <code className="rounded bg-muted px-1">useWorkflows</code> in v1.x
          to list saved questions with run and edit affordances. For now, pin
          frequent questions in your app navigation or memory corrections via{" "}
          <code className="rounded bg-muted px-1">MemoryEditor</code>.
        </p>
      </CardContent>
    </Card>
  );
}
