/* SPDX-License-Identifier: Apache-2.0 */
"use client";
import useSWR from "swr";
import { cn } from "@/lib/utils";

interface Thread {
  id: string;
  title?: string | null;
  createdAt?: string;
}

const fetcher = async (url: string): Promise<{ threads: Thread[] }> => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed: ${res.status}`);
  return res.json();
};

export function ThreadList({
  activeThreadId,
  onSelect,
}: {
  activeThreadId: string;
  onSelect: (threadId: string) => void;
}) {
  const { data, isLoading } = useSWR<{ threads: Thread[] }>(
    "/api/threads",
    fetcher,
    { refreshInterval: 5_000 },
  );

  if (isLoading) {
    return (
      <div className="text-xs text-muted-foreground px-2 py-2">Loading…</div>
    );
  }

  const threads = data?.threads ?? [];
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
