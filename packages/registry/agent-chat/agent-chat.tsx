/* SPDX-License-Identifier: Apache-2.0 */
"use client";

import { useAgent, type Message } from "@arivie/react";
import { Loader2, Send } from "lucide-react";
import { useCallback, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import styles from "./agent-chat.module.css";

export interface AgentChatProps {
  endpoint?: string;
  title?: string;
  className?: string;
}

function messageClass(role: Message["role"]): string {
  return role === "user" ? styles.messageUser : styles.messageAssistant;
}

export function AgentChat({
  endpoint = "/api/arivie",
  title = "Ask your data",
  className,
}: AgentChatProps) {
  const { messages, status, submit, abort } = useAgent({ endpoint });
  const [draft, setDraft] = useState("");

  const handleSubmit = useCallback(
    (value: string) => {
      const trimmed = value.trim();
      if (!trimmed || status !== "idle") return;
      submit(trimmed);
      setDraft("");
    },
    [status, submit],
  );

  const busy = status !== "idle";

  return (
    <Card className={className}>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{title}</CardTitle>
        {busy ? (
          <p className={styles.status} aria-live="polite">
            <Loader2 className="inline size-3 animate-spin" aria-hidden />{" "}
            {status}
          </p>
        ) : null}
      </CardHeader>
      <CardContent className={styles.root}>
        <ScrollArea className={styles.messages}>
          <div className={styles.conversation} role="log" aria-live="polite">
            {messages.map((message) => (
              <div
                key={message.id}
                className={[styles.message, messageClass(message.role)].join(" ")}
              >
                <p>{message.content}</p>
                {message.sql ? (
                  <pre className={styles.sql}>{message.sql}</pre>
                ) : null}
              </div>
            ))}
          </div>
        </ScrollArea>
        <form
          className={styles.inputRow}
          onSubmit={(event) => {
            event.preventDefault();
            handleSubmit(draft);
          }}
        >
          <input
            type="text"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Ask a question about your data…"
            disabled={busy}
            className={styles.promptInput}
          />
          <Button type="submit" size="icon" disabled={busy} aria-label="Send">
            <Send className="size-4" />
          </Button>
          {busy ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => abort()}
            >
              Stop
            </Button>
          ) : null}
        </form>
      </CardContent>
    </Card>
  );
}
