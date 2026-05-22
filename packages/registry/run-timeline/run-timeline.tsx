/* SPDX-License-Identifier: Apache-2.0 */
"use client";

import type { Message, ToolEvent } from "@arivie/react";
import { Clock, Database, Sigma } from "lucide-react";
import { Separator } from "@/components/ui/separator";

export interface RunTimelineProps {
  messages: Message[];
  className?: string;
}

function toolIcon(tool: ToolEvent["tool"]) {
  if (tool.startsWith("execute_")) {
    return Database;
  }
  if (tool === "compile_metric") {
    return Sigma;
  }
  return Clock;
}

function formatUsd(usd: number): string {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 4,
  }).format(usd);
}

export function RunTimeline({ messages, className }: RunTimelineProps) {
  const events = messages.flatMap((message) => message.timeline ?? []);

  if (events.length === 0) {
    return (
      <p className={`text-sm text-muted-foreground ${className ?? ""}`}>
        No tool activity yet.
      </p>
    );
  }

  return (
    <ol className={`relative space-y-4 border-l pl-6 ${className ?? ""}`}>
      {events.map((event, index) => {
        const Icon = toolIcon(event.tool);
        const key = `${event.tool}-${index}-${event.durationMs}`;
        return (
          <li key={key} className="relative">
            <span className="absolute -left-[1.65rem] flex size-6 items-center justify-center rounded-full border bg-background">
              <Icon className="size-3.5 text-muted-foreground" aria-hidden />
            </span>
            <div className="flex flex-wrap items-baseline gap-2">
              <span className="font-medium capitalize">{event.tool}</span>
              <span className="text-xs text-muted-foreground">
                {event.durationMs}ms
              </span>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {event.result_summary}
            </p>
            {index < events.length - 1 ? (
              <Separator className="mt-4" />
            ) : null}
          </li>
        );
      })}
      {messages.some((m) => m.cost) ? (
        <li className="text-xs text-muted-foreground">
          Total cost:{" "}
          {formatUsd(
            messages
              .map((m) => m.cost?.usd ?? 0)
              .reduce((a, b) => a + b, 0),
          )}
        </li>
      ) : null}
    </ol>
  );
}
