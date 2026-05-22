/* SPDX-License-Identifier: Apache-2.0 */
"use client";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Streamdown } from "streamdown";
import { ArtifactPane } from "@/components/artifact-pane";
import { ThreadList } from "@/components/thread-list";
import { Button } from "@/components/ui/button";
import { type Artifact, detectArtifact } from "@/lib/artifacts";
import { authClient } from "@/lib/auth-client";
import { cn } from "@/lib/utils";

export function ChatShell({
  userId,
  userEmail,
}: {
  userId: string;
  userEmail: string | null;
}) {
  const [threadId, setThreadId] = useState<string>(
    () => `chat-${new Date().toISOString().replace(/[:.]/g, "").slice(0, 17)}`,
  );

  const transport = new DefaultChatTransport({
    api: "/api/chat",
    prepareSendMessagesRequest({ messages }) {
      return {
        body: {
          // Mastra Memory loads history server-side; only send the new message.
          messages: messages.slice(-1),
          memory: { thread: threadId, resource: userId },
        },
      };
    },
  });

  const { messages, sendMessage, status } = useChat({ transport });
  const [input, setInput] = useState("");
  const [demoArtifacts, setDemoArtifacts] = useState<Artifact[]>([]);
  const [paneOpen, setPaneOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Aggregate artifacts from (a) data-artifact-* stream parts the server
  // emits, (b) heuristic detection over tool outputs the agent produces,
  // (c) demo artifacts injected via the /demo button. Sorted by
  // appearance order; same id deduped.
  const artifacts: Artifact[] = useMemo(() => {
    const seen = new Map<string, Artifact>();
    let cursor = 0;
    const nextId = () => `inline-${cursor++}`;

    for (const m of messages) {
      if (m.role !== "assistant") continue;
      for (const p of m.parts) {
        // (a) data-artifact-* part
        if (p.type.startsWith("data-artifact-")) {
          const tp = p as unknown as { id?: string; data?: unknown };
          const data = tp.data as Artifact | undefined;
          if (data?.kind && data.id && !seen.has(data.id)) {
            seen.set(data.id, data);
          }
        }
        // (b) tool-<name> part → detect from output
        if (p.type.startsWith("tool-")) {
          const tp = p as unknown as { type: string; output?: unknown };
          const toolName = tp.type.replace(/^tool-/, "");
          const a = detectArtifact(toolName, tp.output, nextId);
          if (a && !seen.has(a.id)) seen.set(a.id, a);
        }
      }
    }
    for (const a of demoArtifacts) {
      if (!seen.has(a.id)) seen.set(a.id, a);
    }
    return [...seen.values()];
  }, [messages, demoArtifacts]);

  // Scroll to bottom on every message-list change (incl. streamed deltas).
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-run on every messages change including streamed parts
  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages]);

  const onSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      const text = input.trim();
      if (!text || status === "streaming" || status === "submitted") return;
      sendMessage({ text });
      setInput("");
    },
    [input, sendMessage, status],
  );

  const onNewChat = useCallback(() => {
    setThreadId(
      `chat-${new Date().toISOString().replace(/[:.]/g, "").slice(0, 17)}`,
    );
    setSidebarOpen(false);
  }, []);

  const handleSignOut = useCallback(async () => {
    await authClient.signOut();
    window.location.href = "/login";
  }, []);

  /**
   * Drop one of each artifact kind into local state — proves the
   * renderer pipeline end-to-end without needing a real tool to fire.
   * Real artifacts arrive automatically via the message-parts path above.
   */
  const triggerDemoArtifacts = useCallback(() => {
    setDemoArtifacts([
      {
        kind: "query",
        id: `demo-q-${Date.now()}`,
        title: "Last week revenue per outlet",
        dialect: "postgres",
        sql: "SELECT outlet_id,\n       SUM(net_amount) AS revenue\nFROM orders\nWHERE created_at >= now() - INTERVAL '7 days'\nGROUP BY outlet_id\nORDER BY revenue DESC;",
        rowCount: 12,
        durationMs: 187,
        explanation: "Aggregated net_amount over the last 7 days by outlet.",
      },
      {
        kind: "chart",
        id: `demo-c-${Date.now()}`,
        title: "Revenue by outlet (bar)",
        spec: {
          $schema: "https://vega.github.io/schema/vega-lite/v5.json",
          data: { values: [{ outlet: "A", revenue: 12400 }] },
          mark: "bar",
          encoding: {
            x: { field: "outlet", type: "nominal" },
            y: { field: "revenue", type: "quantitative" },
          },
        },
      },
      {
        kind: "report",
        id: `demo-r-${Date.now()}`,
        title: "Weekly revenue brief",
        path: ".arivie/workspace/reports/weekly-revenue.md",
        markdown:
          "# Weekly revenue brief\n\nThe top outlet drove **38%** of revenue last week. " +
          "Outlets D and E underperformed against their 4-week trailing average.\n\n" +
          "- Total revenue: $128,400\n- Outlet count: 12\n- WoW change: +7.4%",
      },
      {
        kind: "entity",
        id: `demo-e-${Date.now()}`,
        entityKind: "outlet",
        entityId: "outlet_42",
        title: "Outlet 42 — Brickyard",
        fields: [
          { label: "Status", value: "active" },
          { label: "Opened", value: "2024-03-18", format: "date" },
          { label: "Revenue (last 7d)", value: 24800, format: "currency" },
          { label: "Margin", value: 0.317, format: "percent" },
          { label: "Headcount", value: 14, format: "number" },
        ],
      },
    ]);
    setPaneOpen(true);
    setSidebarOpen(false);
  }, []);

  const sidebar = (
    <aside
      className={cn(
        "border-r border-border p-3 flex flex-col gap-2",
        // Mobile: fixed overlay drawer with solid bg, slides in from left
        "fixed inset-y-0 left-0 z-40 w-72 bg-background transition-transform",
        sidebarOpen ? "translate-x-0" : "-translate-x-full",
        // md+: static column with subtle bg, always visible
        "md:static md:translate-x-0 md:w-64 md:z-0 md:bg-muted/30",
      )}
    >
      <div className="px-2 pt-2 pb-3 flex items-center justify-between">
        <div>
          <div className="text-sm font-semibold">Arivie</div>
          <div className="text-xs text-muted-foreground">analytics chat</div>
        </div>
        <Button
          onClick={() => setSidebarOpen(false)}
          variant="ghost"
          size="sm"
          className="md:hidden"
          aria-label="Close menu"
        >
          ×
        </Button>
      </div>
      <Button onClick={onNewChat} className="w-full" variant="default">
        + New chat
      </Button>
      <ThreadList
        activeThreadId={threadId}
        onSelect={(t) => {
          setThreadId(t);
          setSidebarOpen(false);
        }}
      />
      <Button
        onClick={triggerDemoArtifacts}
        variant="ghost"
        size="sm"
        className="w-full justify-start text-xs"
      >
        Demo artifacts
      </Button>
      <div className="mt-auto px-2 pt-2 border-t border-border space-y-1">
        <div className="text-xs text-muted-foreground truncate">
          {userEmail}
        </div>
        <Button
          onClick={handleSignOut}
          variant="ghost"
          size="sm"
          className="w-full justify-start"
        >
          Sign out
        </Button>
      </div>
    </aside>
  );

  return (
    <div className="flex h-dvh bg-background text-foreground overflow-hidden">
      {/* Backdrop for mobile drawer */}
      {sidebarOpen && (
        <button
          type="button"
          aria-label="Close menu backdrop"
          onClick={() => setSidebarOpen(false)}
          className="fixed inset-0 z-30 bg-black/40 md:hidden"
        />
      )}
      {sidebar}
      <main className="flex-1 flex flex-col min-w-0">
        {/* Mobile top bar — hamburger + title; hidden on md+ */}
        <header className="md:hidden flex items-center gap-2 border-b border-border px-3 py-2">
          <Button
            onClick={() => setSidebarOpen(true)}
            variant="ghost"
            size="sm"
            aria-label="Open menu"
            className="px-2"
          >
            ☰
          </Button>
          <div className="text-sm font-semibold">Arivie</div>
          {artifacts.length > 0 && (
            <Button
              onClick={() => setPaneOpen(true)}
              variant="ghost"
              size="sm"
              className="ml-auto text-xs"
            >
              {artifacts.length} artifact{artifacts.length === 1 ? "" : "s"}
            </Button>
          )}
        </header>
        <div
          ref={scrollRef}
          className="flex-1 overflow-y-auto px-4 py-6 sm:px-6 sm:py-8"
        >
          <div className="max-w-3xl mx-auto space-y-6">
            {messages.length === 0 && (
              <div className="text-center py-12 sm:py-20 text-muted-foreground">
                <div className="text-2xl mb-2">🦉</div>
                <h1 className="text-lg sm:text-xl font-semibold mb-2 text-foreground">
                  Ask Arivie about your data
                </h1>
                <p className="text-sm">
                  Try:{" "}
                  <em>
                    &ldquo;What was last week&rsquo;s revenue per outlet?&rdquo;
                  </em>
                </p>
              </div>
            )}
            {messages.map((m) => (
              <div key={m.id} className="flex flex-col gap-2">
                <div className="text-xs text-muted-foreground">
                  {m.role === "user" ? "you" : "arivie"}
                </div>
                <div className="prose prose-sm dark:prose-invert max-w-none break-words">
                  {m.parts.map((p, i) => {
                    const partKey = `${m.id}-${i}-${p.type}`;
                    if (p.type === "text") {
                      return <Streamdown key={partKey}>{p.text}</Streamdown>;
                    }
                    if (p.type.startsWith("tool-")) {
                      const tp: any = p;
                      return (
                        <details key={partKey} className="my-2 text-xs">
                          <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                            {tp.type.replace(/^tool-/, "🔧 ")}
                          </summary>
                          <pre className="mt-1 p-2 bg-muted rounded overflow-x-auto">
                            {JSON.stringify(
                              tp.input ?? tp.output ?? tp,
                              null,
                              2,
                            ).slice(0, 1500)}
                          </pre>
                        </details>
                      );
                    }
                    return null;
                  })}
                </div>
              </div>
            ))}
            {status === "streaming" && (
              <div className="text-xs text-muted-foreground">streaming…</div>
            )}
          </div>
        </div>
        <form onSubmit={onSubmit} className="border-t border-border p-3 sm:p-4">
          <div className="max-w-3xl mx-auto flex gap-2">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask about your data…"
              className="flex-1 min-w-0 px-3 py-2 bg-background border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
              disabled={status === "streaming" || status === "submitted"}
            />
            {/* Desktop-only artifact badge (mobile shows it in the header) */}
            {artifacts.length > 0 && !paneOpen && (
              <Button
                type="button"
                variant="ghost"
                onClick={() => setPaneOpen(true)}
                className="hidden md:inline-flex"
              >
                {artifacts.length} artifact{artifacts.length === 1 ? "" : "s"}
              </Button>
            )}
            <Button
              type="submit"
              disabled={!input.trim() || status === "streaming"}
            >
              Send
            </Button>
          </div>
        </form>
      </main>
      {paneOpen && artifacts.length > 0 && (
        <ArtifactPane
          artifacts={artifacts}
          onClose={() => setPaneOpen(false)}
        />
      )}
    </div>
  );
}
