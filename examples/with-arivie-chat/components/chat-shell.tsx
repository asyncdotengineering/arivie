/* SPDX-License-Identifier: Apache-2.0 */
"use client";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useCallback, useEffect, useRef, useState } from "react";
import { Streamdown } from "streamdown";
import { ThreadList } from "@/components/thread-list";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";

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
  const scrollRef = useRef<HTMLDivElement>(null);

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
  }, []);

  const handleSignOut = useCallback(async () => {
    await authClient.signOut();
    window.location.href = "/login";
  }, []);

  return (
    <div className="flex h-screen bg-background text-foreground">
      <aside className="w-64 border-r border-border bg-muted/30 p-3 flex flex-col gap-2">
        <div className="px-2 pt-2 pb-3">
          <div className="text-sm font-semibold">Arivie</div>
          <div className="text-xs text-muted-foreground">analytics chat</div>
        </div>
        <Button onClick={onNewChat} className="w-full" variant="default">
          + New chat
        </Button>
        <ThreadList
          activeThreadId={threadId}
          onSelect={(t) => setThreadId(t)}
        />
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
      <main className="flex-1 flex flex-col">
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-6 py-8">
          <div className="max-w-3xl mx-auto space-y-6">
            {messages.length === 0 && (
              <div className="text-center py-20 text-muted-foreground">
                <div className="text-2xl mb-2">🦉</div>
                <h1 className="text-xl font-semibold mb-2 text-foreground">
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
                <div className="prose prose-sm dark:prose-invert max-w-none">
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
        <form onSubmit={onSubmit} className="border-t border-border p-4">
          <div className="max-w-3xl mx-auto flex gap-2">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask about your data…"
              className="flex-1 px-3 py-2 bg-background border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
              disabled={status === "streaming" || status === "submitted"}
            />
            <Button
              type="submit"
              disabled={!input.trim() || status === "streaming"}
            >
              Send
            </Button>
          </div>
        </form>
      </main>
    </div>
  );
}
