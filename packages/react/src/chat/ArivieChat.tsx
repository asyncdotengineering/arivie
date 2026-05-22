/* SPDX-License-Identifier: Apache-2.0 */
"use client";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Streamdown } from "streamdown";
import { ArtifactPane } from "./ArtifactPane.js";
import { ThreadList } from "./ThreadList.js";
import { type Artifact, detectArtifact } from "./artifacts.js";

export interface ArivieChatProps {
  /** Authenticated user id — used as the Mastra Memory resourceId. */
  userId: string;
  /** Display email in the sidebar footer. */
  userEmail?: string | null;
  /** Chat API endpoint. Default `/api/chat`. */
  endpoint?: string;
  /** Threads list endpoint. Default `/api/threads`. */
  threadsEndpoint?: string;
  /** Sign-out handler. The default reloads `/login`. */
  onSignOut?: () => void | Promise<void>;
  /** Optional welcome content shown when the message list is empty. */
  welcome?: ReactNode;
}

const cn = (...parts: (string | false | undefined)[]) =>
  parts.filter(Boolean).join(" ");

/**
 * Drop-in chat surface for Arivie agents. One component, full layout —
 * sidebar (threads + sign-out), main message stream with Send + auto-
 * scroll, and an artifact pane that auto-opens when the agent returns
 * its first artifact (query / chart / report / entity, or anything
 * that targets the @arivie/ui-catalog via json-render).
 *
 * ```tsx
 * import { ArivieChat } from "@arivie/react/chat";
 *
 * <ArivieChat
 *   userId={session.user.id}
 *   userEmail={session.user.email}
 *   onSignOut={() => authClient.signOut().then(() => location.assign("/login"))}
 * />
 * ```
 *
 * Bring your own auth (Better Auth, Auth.js, Clerk, etc.) — the only
 * contract is `userId` + an `/api/chat` route that hosts
 * `handleChatStream` with `version: "v6"`.
 */
export function ArivieChat({
  userId,
  userEmail,
  endpoint = "/api/chat",
  threadsEndpoint = "/api/threads",
  onSignOut,
  welcome,
}: ArivieChatProps) {
  const [threadId, setThreadId] = useState<string>(
    () => `chat-${new Date().toISOString().replace(/[:.]/g, "").slice(0, 17)}`,
  );

  const transport = new DefaultChatTransport({
    api: endpoint,
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
  const [paneOpen, setPaneOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Aggregate artifacts from message parts. `data-artifact-*` parts
  // (server-pushed) win; `tool-*` parts fall back to the detector that
  // inspects both input and output (terminal tools like finalize_report
  // carry payload in the call args).
  const artifacts: Artifact[] = useMemo(() => {
    const seen = new Map<string, Artifact>();
    let cursor = 0;
    const nextId = () => `inline-${cursor++}`;

    for (const m of messages) {
      if (m.role !== "assistant") continue;
      for (const p of m.parts) {
        if (p.type.startsWith("data-artifact-")) {
          const tp = p as unknown as { id?: string; data?: unknown };
          const data = tp.data as Artifact | undefined;
          if (data?.kind && data.id && !seen.has(data.id)) {
            seen.set(data.id, data);
          }
        }
        if (p.type.startsWith("tool-")) {
          const tp = p as unknown as {
            type: string;
            input?: unknown;
            output?: unknown;
          };
          const toolName = tp.type.replace(/^tool-/, "");
          const a =
            detectArtifact(toolName, tp.output, nextId) ??
            detectArtifact(toolName, tp.input, nextId);
          if (a && !seen.has(a.id)) seen.set(a.id, a);
        }
      }
    }
    return [...seen.values()];
  }, [messages]);

  // Auto-scroll
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-run on streamed parts
  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages]);

  // Auto-open pane on first artifact arrival
  const lastArtifactCount = useRef(0);
  useEffect(() => {
    if (artifacts.length > lastArtifactCount.current && artifacts.length > 0) {
      setPaneOpen(true);
    }
    lastArtifactCount.current = artifacts.length;
  }, [artifacts]);

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
    if (onSignOut) {
      await onSignOut();
    } else if (typeof window !== "undefined") {
      window.location.href = "/login";
    }
  }, [onSignOut]);

  const sidebar = (
    <aside
      className={cn(
        "border-r border-border p-3 flex flex-col gap-2",
        "fixed inset-y-0 left-0 z-40 w-72 bg-background transition-transform",
        sidebarOpen ? "translate-x-0" : "-translate-x-full",
        "md:static md:translate-x-0 md:w-64 md:z-0 md:bg-muted/30",
      )}
    >
      <div className="px-2 pt-2 pb-3 flex items-center justify-between">
        <div>
          <div className="text-sm font-semibold">Arivie</div>
          <div className="text-xs text-muted-foreground">analytics chat</div>
        </div>
        <button
          type="button"
          onClick={() => setSidebarOpen(false)}
          aria-label="Close menu"
          className="md:hidden px-2 py-1 text-sm text-muted-foreground hover:text-foreground"
        >
          ×
        </button>
      </div>
      <button
        type="button"
        onClick={onNewChat}
        className="w-full bg-primary text-primary-foreground hover:bg-primary/90 px-3 py-2 text-sm rounded-md font-medium"
      >
        + New chat
      </button>
      <ThreadList
        endpoint={threadsEndpoint}
        activeThreadId={threadId}
        onSelect={(t) => {
          setThreadId(t);
          setSidebarOpen(false);
        }}
      />
      <div className="mt-auto px-2 pt-2 border-t border-border space-y-1">
        {userEmail && (
          <div className="text-xs text-muted-foreground truncate">
            {userEmail}
          </div>
        )}
        <button
          type="button"
          onClick={handleSignOut}
          className="w-full text-left px-2 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-muted rounded-sm"
        >
          Sign out
        </button>
      </div>
    </aside>
  );

  return (
    <div className="flex h-dvh bg-background text-foreground overflow-hidden">
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
        <header className="md:hidden flex items-center gap-2 border-b border-border px-3 py-2">
          <button
            type="button"
            onClick={() => setSidebarOpen(true)}
            aria-label="Open menu"
            className="px-2 py-1 text-sm hover:bg-muted rounded-sm"
          >
            ☰
          </button>
          <div className="text-sm font-semibold">Arivie</div>
          {artifacts.length > 0 && (
            <button
              type="button"
              onClick={() => setPaneOpen(true)}
              className="ml-auto text-xs px-2 py-1 rounded-sm hover:bg-muted"
            >
              {artifacts.length} artifact{artifacts.length === 1 ? "" : "s"}
            </button>
          )}
        </header>
        <div
          ref={scrollRef}
          className="flex-1 overflow-y-auto px-4 py-6 sm:px-6 sm:py-8"
        >
          <div className="max-w-3xl mx-auto space-y-6">
            {messages.length === 0 &&
              (welcome ?? (
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
              ))}
            {messages.map((m) => (
              <div key={m.id} className="flex flex-col gap-2">
                <div className="text-xs text-muted-foreground">
                  {m.role === "user" ? "you" : "arivie"}
                </div>
                <div className="prose prose-sm dark:prose-invert max-w-none break-words">
                  {m.parts.map((p, i) => {
                    const partKey = `${m.id}-${i}-${p.type}`;
                    if (p.type === "text") {
                      return (
                        <Streamdown key={partKey}>
                          {(p as { text: string }).text}
                        </Streamdown>
                      );
                    }
                    if (p.type.startsWith("tool-")) {
                      // biome-ignore lint/suspicious/noExplicitAny: tool parts vary by tool
                      const tp: any = p;
                      const toolName = tp.type.replace(/^tool-/, "");
                      if (toolName === "finalize_report") {
                        return (
                          <button
                            key={partKey}
                            type="button"
                            onClick={() => setPaneOpen(true)}
                            className="my-2 inline-flex items-center gap-2 px-3 py-1.5 text-sm rounded-md bg-primary/10 text-foreground hover:bg-primary/20"
                          >
                            📄 Report ready — open →
                          </button>
                        );
                      }
                      return (
                        <details key={partKey} className="my-2 text-xs">
                          <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                            🔧 {toolName}
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
        <form
          onSubmit={onSubmit}
          className="border-t border-border p-3 sm:p-4"
        >
          <div className="max-w-3xl mx-auto flex gap-2">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask about your data…"
              className="flex-1 min-w-0 px-3 py-2 bg-background border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
              disabled={status === "streaming" || status === "submitted"}
            />
            {artifacts.length > 0 && !paneOpen && (
              <button
                type="button"
                onClick={() => setPaneOpen(true)}
                className="hidden md:inline-flex px-3 py-2 text-sm text-muted-foreground hover:text-foreground hover:bg-muted rounded-md"
              >
                {artifacts.length} artifact{artifacts.length === 1 ? "" : "s"}
              </button>
            )}
            <button
              type="submit"
              disabled={!input.trim() || status === "streaming"}
              className="bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed px-4 py-2 text-sm rounded-md font-medium"
            >
              Send
            </button>
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
