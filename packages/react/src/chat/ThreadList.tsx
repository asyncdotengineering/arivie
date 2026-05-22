/* SPDX-License-Identifier: Apache-2.0 */
"use client";
import { useEffect, useState } from "react";

export interface Thread {
  id: string;
  title?: string | null;
  createdAt?: string;
}

export interface ThreadListProps {
  /** Currently selected thread id. */
  activeThreadId: string;
  /** Called when the user picks a thread. */
  onSelect: (threadId: string) => void;
  /** Endpoint that returns `{ threads: Thread[] }`. Default `/api/threads`. */
  endpoint?: string;
  /** Poll interval (ms). Default 5000; set to 0 to disable. */
  refreshInterval?: number;
}

const cn = (...parts: (string | false | undefined)[]) =>
  parts.filter(Boolean).join(" ");

/**
 * SWR-free thread picker — polls the threads endpoint on `refreshInterval`
 * and renders a vertical list. Active thread is highlighted.
 */
export function ThreadList({
  activeThreadId,
  onSelect,
  endpoint = "/api/threads",
  refreshInterval = 5000,
}: ThreadListProps) {
  const [threads, setThreads] = useState<Thread[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const load = async () => {
      try {
        const res = await fetch(endpoint);
        if (!res.ok) throw new Error(`Failed: ${res.status}`);
        const data = (await res.json()) as { threads: Thread[] };
        if (!alive) return;
        setThreads(data.threads ?? []);
        setError(null);
      } catch (err) {
        if (!alive) return;
        setError(err instanceof Error ? err.message : "unknown");
      }
      if (alive && refreshInterval > 0) {
        timer = setTimeout(load, refreshInterval);
      }
    };
    load();
    return () => {
      alive = false;
      if (timer != null) clearTimeout(timer);
    };
  }, [endpoint, refreshInterval]);

  if (threads == null) {
    return (
      <div className="text-xs text-muted-foreground px-2 py-2">Loading…</div>
    );
  }
  if (error != null) {
    return (
      <div className="text-xs text-destructive px-2 py-2">{error}</div>
    );
  }
  if (threads.length === 0) {
    return (
      <div className="text-xs text-muted-foreground px-2 py-2">
        No threads yet.
      </div>
    );
  }
  return (
    <div className="flex-1 overflow-y-auto space-y-1 mt-2">
      {threads.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => onSelect(t.id)}
          className={cn(
            "w-full text-left px-2 py-1.5 text-xs rounded-sm truncate transition-colors",
            t.id === activeThreadId
              ? "bg-primary/10 text-foreground"
              : "text-muted-foreground hover:bg-muted hover:text-foreground",
          )}
        >
          {t.title ?? t.id}
        </button>
      ))}
    </div>
  );
}
