/* SPDX-License-Identifier: Apache-2.0 */
import { randomUUID } from "node:crypto";
import type { ArivieApp, ConversationSummary } from "@arivie/core";
import { listConversations } from "@arivie/core";
import { Box, Text, render, useApp, useInput } from "ink";
import TextInput from "ink-text-input";
import React, { useCallback, useEffect, useState } from "react";
import { chatTurn, type ChatTurnOptions } from "./chat.js";

export interface ChatTuiProps {
  app: ArivieApp;
  agent: string;
  user: ChatTurnOptions["user"];
  initialConversationId?: string;
}

type ChatMessage =
  | { kind: "user"; text: string }
  | { kind: "assistant"; text: string }
  | { kind: "tool"; tool: string };

type PickerItem = { id: string; label: string; hint?: string };

function formatRelativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function pickerItems(threads: ConversationSummary[]): PickerItem[] {
  const items: PickerItem[] = [{ id: "__new__", label: "＋ New conversation" }];
  for (const thread of threads) {
    const title = thread.title ?? thread.id;
    items.push({
      id: thread.id,
      label: title,
      hint: formatRelativeTime(thread.updatedAt),
    });
  }
  return items;
}

function ThreadPicker({
  items,
  onPick,
}: {
  items: PickerItem[];
  onPick: (id: string) => void;
}): React.JSX.Element {
  const { exit } = useApp();
  const [selected, setSelected] = useState(0);
  const index = Math.min(selected, Math.max(0, items.length - 1));

  useInput((input, key) => {
    if (key.escape || (key.ctrl && input === "c")) {
      exit();
      return;
    }
    if (key.upArrow) setSelected((s) => Math.max(0, s - 1));
    if (key.downArrow) setSelected((s) => Math.min(items.length - 1, s + 1));
    if (key.return) onPick(items[index]!.id);
  });

  return (
    <Box flexDirection="column">
      <Text dimColor>Select a conversation (↑↓ Enter · Esc to quit)</Text>
      {items.map((item, i) => {
        const active = i === index;
        return (
          <Text key={item.id} inverse={active}>
            {active ? "› " : "  "}
            {item.label}
            {item.hint !== undefined ? ` (${item.hint})` : ""}
          </Text>
        );
      })}
    </Box>
  );
}

function ChatView({
  app,
  agent,
  user,
  conversationId,
}: {
  app: ArivieApp;
  agent: string;
  user: ChatTurnOptions["user"];
  conversationId: string;
}): React.JSX.Element {
  const { exit } = useApp();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = useCallback(
    async (line: string) => {
      const prompt = line.trim();
      if (prompt.length === 0) return;
      if (prompt === "/exit" || prompt === "/quit") {
        exit();
        return;
      }

      setMessages((prev) => [
        ...prev,
        { kind: "user", text: prompt },
        { kind: "assistant", text: "" },
      ]);
      setInput("");
      setBusy(true);

      try {
        await chatTurn(app, {
          agent,
          prompt,
          user,
          conversationId,
          write: (chunk) => {
            setMessages((prev) => {
              const next = [...prev];
              for (let i = next.length - 1; i >= 0; i--) {
                const msg = next[i];
                if (msg?.kind === "assistant") {
                  next[i] = { kind: "assistant", text: msg.text + chunk };
                  break;
                }
              }
              return next;
            });
          },
          onTool: (tool) => {
            setMessages((prev) => [...prev, { kind: "tool", tool }]);
          },
        });
      } finally {
        setBusy(false);
      }
    },
    [agent, app, conversationId, exit, user],
  );

  useInput((_, key) => {
    if (busy) return;
    if (key.escape || (key.ctrl && _ === "c")) exit();
  });

  return (
    <Box flexDirection="column">
      <Box flexDirection="column" marginBottom={1}>
        {messages.map((msg, i) => {
          if (msg.kind === "user") {
            return (
              <Box key={i} flexDirection="column" marginBottom={1}>
                <Text color="cyan">› {msg.text}</Text>
              </Box>
            );
          }
          if (msg.kind === "tool") {
            return (
              <Text key={i} dimColor>
                ⚙ {msg.tool}
              </Text>
            );
          }
          return (
            <Text key={i} wrap="wrap">
              {msg.text}
            </Text>
          );
        })}
        {busy ? <Text dimColor>…</Text> : null}
      </Box>
      {!busy ? (
        <Box>
          <Text color="green">› </Text>
          <TextInput
            value={input}
            onChange={setInput}
            onSubmit={submit}
            placeholder="Message (/exit to quit)"
          />
        </Box>
      ) : null}
    </Box>
  );
}

export function ChatTui({
  app,
  agent,
  user,
  initialConversationId,
}: ChatTuiProps): React.JSX.Element {
  const [phase, setPhase] = useState<"picker" | "chat">(
    initialConversationId !== undefined ? "chat" : "picker",
  );
  const [conversationId, setConversationId] = useState(
    initialConversationId ?? "",
  );
  const [threads, setThreads] = useState<ConversationSummary[]>([]);
  const [loadingThreads, setLoadingThreads] = useState(initialConversationId === undefined);

  useEffect(() => {
    if (initialConversationId !== undefined) return;
    let cancelled = false;
    void listConversations(app, user.userId).then((list) => {
      if (!cancelled) {
        setThreads(list);
        setLoadingThreads(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [app, initialConversationId, user.userId]);

  const items = pickerItems(threads);

  const pickThread = useCallback(
    (id: string) => {
      if (id === "__new__") {
        setConversationId(randomUUID());
      } else {
        setConversationId(id);
      }
      setPhase("chat");
    },
    [],
  );

  const header = `${app.app.name} · ${agent} · ${phase === "chat" ? conversationId : "…"}`;

  return (
    <Box flexDirection="column">
      <Text dimColor>{header}</Text>
      {phase === "picker" ? (
        loadingThreads ? (
          <Text dimColor>Loading conversations…</Text>
        ) : (
          <ThreadPicker items={items} onPick={pickThread} />
        )
      ) : (
        <ChatView app={app} agent={agent} user={user} conversationId={conversationId} />
      )}
    </Box>
  );
}

export async function runChatTui(props: ChatTuiProps): Promise<void> {
  const instance = render(<ChatTui {...props} />);
  await instance.waitUntilExit();
}
