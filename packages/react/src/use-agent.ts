/* SPDX-License-Identifier: Apache-2.0 */
import { useCallback, useReducer, useRef } from "react";
import { flushSync } from "react-dom";
import { readSseStream } from "./sse.js";
import type { Message, ToolEvent, UseAgentOptions, UseAgentReturn } from "./types.js";

type AgentStatus = UseAgentReturn["status"];

interface AgentState {
  messages: Message[];
  status: AgentStatus;
}

type AgentAction =
  | { type: "submit_start"; userMessage: Message; assistantMessage: Message }
  | { type: "set_status"; status: AgentStatus }
  | { type: "append_delta"; assistantId: string; delta: string }
  | { type: "merge_final"; assistantId: string; patch: Partial<Message> }
  | { type: "set_idle" }
  | { type: "reset"; messages: Message[] }
  | { type: "error_idle" };

function nextMessageId(): string {
  return crypto.randomUUID();
}

function toolResultsToTimeline(toolResults: unknown): ToolEvent[] | undefined {
  if (!Array.isArray(toolResults)) {
    return undefined;
  }
  const timeline: ToolEvent[] = [];
  for (const item of toolResults) {
    if (item == null || typeof item !== "object") {
      continue;
    }
    const record = item as {
      toolName?: unknown;
      args?: unknown;
      result?: unknown;
      durationMs?: unknown;
    };
    const toolName = typeof record.toolName === "string" ? record.toolName : "";
    if (
      !toolName.startsWith("execute_") &&
      toolName !== "compile_metric"
    ) {
      continue;
    }
    const args =
      record.args != null && typeof record.args === "object"
        ? (record.args as Record<string, unknown>)
        : {};
    const durationMs =
      typeof record.durationMs === "number" ? record.durationMs : 0;
    let resultSummary = "";
    if (record.result != null && typeof record.result === "object") {
      const rowCount = (record.result as { rowCount?: unknown }).rowCount;
      if (typeof rowCount === "number") {
        resultSummary = `${rowCount} rows`;
      }
    }
    timeline.push({
      tool: toolName,
      args,
      durationMs,
      result_summary: resultSummary,
    });
  }
  return timeline.length > 0 ? timeline : undefined;
}

function finalPayloadToPatch(payload: Record<string, unknown>): Partial<Message> {
  const patch: Partial<Message> = {};
  if (typeof payload.text === "string" && payload.text.length > 0) {
    patch.content = payload.text;
  }
  if (typeof payload.sql === "string") {
    patch.sql = payload.sql;
  }
  if (Array.isArray(payload.rows)) {
    patch.rows = payload.rows as Record<string, unknown>[];
  }
  if (Array.isArray(payload.assumptions)) {
    patch.assumptions = payload.assumptions as { key: string; value: string }[];
  }
  const timeline = toolResultsToTimeline(payload.toolResults);
  if (timeline) {
    patch.timeline = timeline;
  }
  return patch;
}

function agentReducer(state: AgentState, action: AgentAction): AgentState {
  switch (action.type) {
    case "submit_start":
      return {
        status: "thinking",
        messages: [
          ...state.messages,
          action.userMessage,
          action.assistantMessage,
        ],
      };
    case "set_status":
      return { ...state, status: action.status };
    case "append_delta": {
      let updated = false;
      const messages = [...state.messages];
      for (let i = messages.length - 1; i >= 0; i -= 1) {
        const message = messages[i];
        if (message?.role === "assistant") {
          messages[i] = {
            ...message,
            content: message.content + action.delta,
          };
          updated = true;
          break;
        }
      }
      return {
        ...state,
        status: "streaming",
        messages: updated ? messages : state.messages,
      };
    }
    case "merge_final": {
      const messages = [...state.messages];
      for (let i = messages.length - 1; i >= 0; i -= 1) {
        const message = messages[i];
        if (message?.role === "assistant") {
          messages[i] = { ...message, ...action.patch };
          break;
        }
      }
      return { ...state, messages };
    }
    case "set_idle":
      return { ...state, status: "idle" };
    case "reset":
      return { messages: action.messages, status: "idle" };
    case "error_idle":
      return { ...state, status: "idle" };
    default:
      return state;
  }
}

export function useAgent(opts: UseAgentOptions): UseAgentReturn {
  const initial = opts.initialMessages ?? [];
  const [state, dispatch] = useReducer(agentReducer, {
    messages: initial,
    status: "idle",
  });
  const abortRef = useRef<AbortController | null>(null);
  const onErrorRef = useRef(opts.onError);
  onErrorRef.current = opts.onError;

  const abort = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    dispatch({ type: "set_idle" });
  }, []);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    dispatch({ type: "reset", messages: opts.initialMessages ?? [] });
  }, [opts.initialMessages]);

  const submit = useCallback(
    (question: string) => {
      if (state.status !== "idle") {
        return;
      }

      const userMessage: Message = {
        id: nextMessageId(),
        role: "user",
        content: question,
      };
      const assistantMessage: Message = {
        id: nextMessageId(),
        role: "assistant",
        content: "",
      };

      flushSync(() => {
        dispatch({
          type: "submit_start",
          userMessage,
          assistantMessage,
        });
      });

      const controller = new AbortController();
      abortRef.current = controller;

      void (async () => {
        try {
          const response = await fetch(opts.endpoint, {
            method: "POST",
            headers: {
              Accept: "text/event-stream",
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ prompt: question }),
            signal: controller.signal,
          });

          if (!response.ok) {
            throw new Error(`Request failed with status ${response.status}`);
          }
          if (response.body == null) {
            throw new Error("Response body is not readable");
          }

          dispatch({ type: "set_status", status: "querying" });

          let sawStream = false;
          await readSseStream(
            response.body,
            (data) => {
              if (data === "[DONE]") {
                return;
              }
              if (data.startsWith("{")) {
                try {
                  const payload = JSON.parse(data) as Record<string, unknown>;
                  dispatch({
                    type: "merge_final",
                    assistantId: assistantMessage.id,
                    patch: finalPayloadToPatch(payload),
                  });
                } catch (err) {
                  const message =
                    err instanceof Error ? err.message : String(err);
                  onErrorRef.current?.(new Error(`Invalid SSE JSON: ${message}`));
                }
                return;
              }
              if (!sawStream) {
                sawStream = true;
                dispatch({ type: "set_status", status: "streaming" });
              }
              dispatch({
                type: "append_delta",
                assistantId: assistantMessage.id,
                delta: data,
              });
            },
            controller.signal,
          );

          dispatch({ type: "set_idle" });
        } catch (err) {
          if (controller.signal.aborted) {
            dispatch({ type: "set_idle" });
            return;
          }
          const error = err instanceof Error ? err : new Error(String(err));
          onErrorRef.current?.(error);
          dispatch({ type: "error_idle" });
        } finally {
          if (abortRef.current === controller) {
            abortRef.current = null;
          }
        }
      })();
    },
    [opts.endpoint, state.status],
  );

  return {
    messages: state.messages,
    status: state.status,
    submit,
    abort,
    reset,
  };
}
