/* SPDX-License-Identifier: Apache-2.0 */
import { act, renderHook, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { describe, expect, it, vi } from "vitest";
import { useAgent } from "../src/use-agent.js";
import { ENDPOINTS } from "./_msw-handlers.js";
import { server } from "./setup.js";

describe("useAgent", () => {
  it("submit streams deltas and merges final SSE payload", async () => {
    const statuses: string[] = [];
    const { result } = renderHook(() => {
      const hook = useAgent({ endpoint: ENDPOINTS.agent });
      statuses.push(hook.status);
      return hook;
    });

    act(() => {
      result.current.submit("hello");
    });

    await waitFor(() => {
      expect(result.current.status).toBe("idle");
    });

    expect(result.current.messages).toHaveLength(2);
    const assistant = result.current.messages[1];
    expect(assistant?.role).toBe("assistant");
    expect(assistant?.content).toBe("Hello world");
    expect(assistant?.sql).toBe("SELECT 1");
    expect(assistant?.rows).toEqual([{ n: 1 }]);
    expect(assistant?.timeline?.[0]?.tool).toBe("execute_postgres");

    expect(statuses).toContain("thinking");
    expect(statuses.at(-1)).toBe("idle");
  });

  it("abort mid-stream returns to idle", async () => {
    const { result } = renderHook(() =>
      useAgent({ endpoint: ENDPOINTS.agent }),
    );

    act(() => {
      result.current.submit("abort-me");
    });

    act(() => {
      result.current.abort();
    });

    await waitFor(() => {
      expect(result.current.status).toBe("idle");
    });
  });

  it("calls onError and returns idle on server 500", async () => {
    const onError = vi.fn();
    const { result } = renderHook(() =>
      useAgent({ endpoint: ENDPOINTS.agent, onError }),
    );

    act(() => {
      result.current.submit("fail");
    });

    await waitFor(() => {
      expect(result.current.status).toBe("idle");
    });

    expect(onError).toHaveBeenCalledOnce();
    expect(onError.mock.calls[0]?.[0]).toBeInstanceOf(Error);
  });

  it("timeline includes execute_ prefix tools and drops explore / bare execute", async () => {
    server.use(
      http.post(ENDPOINTS.agent, () => {
        const payload = JSON.stringify({
          text: "done",
          toolResults: [
            { toolName: "explore", args: {}, durationMs: 1 },
            { toolName: "execute", args: {}, durationMs: 2 },
            {
              toolName: "execute_postgres",
              args: { sql: "SELECT 1" },
              result: { rowCount: 0 },
              durationMs: 3,
            },
          ],
        });
        return new HttpResponse(`data: [DONE]\n\ndata: ${payload}\n\n`, {
          headers: { "Content-Type": "text/event-stream" },
        });
      }),
    );

    const { result } = renderHook(() =>
      useAgent({ endpoint: ENDPOINTS.agent }),
    );

    act(() => {
      result.current.submit("prefix-filter");
    });

    await waitFor(() => {
      expect(result.current.status).toBe("idle");
    });

    const assistant = result.current.messages[1];
    expect(assistant?.timeline?.map((e) => e.tool)).toEqual(["execute_postgres"]);
  });

  it("reset restores initialMessages", async () => {
    const initial = [
      { id: "seed", role: "assistant" as const, content: "seeded" },
    ];
    const { result } = renderHook(() =>
      useAgent({ endpoint: ENDPOINTS.agent, initialMessages: initial }),
    );

    act(() => {
      result.current.submit("hello");
    });

    await waitFor(() => {
      expect(result.current.status).toBe("idle");
    });

    act(() => {
      result.current.reset();
    });

    expect(result.current.messages).toEqual(initial);
    expect(result.current.status).toBe("idle");
  });
});
