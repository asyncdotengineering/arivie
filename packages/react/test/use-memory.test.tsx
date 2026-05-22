/* SPDX-License-Identifier: Apache-2.0 */
import { act, renderHook, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { useMemory } from "../src/use-memory.js";
import { ENDPOINTS } from "./_msw-handlers.js";
import { server } from "./setup.js";

describe("useMemory", () => {
  it("loads memories on mount", async () => {
    const { result } = renderHook(() =>
      useMemory({ endpoint: ENDPOINTS.memory }),
    );

    await waitFor(() => {
      expect(result.current.status).toBe("idle");
    });

    expect(result.current.memories).toEqual([
      { key: "revenue", value: "net of refunds" },
    ]);
  });

  it("save POSTs and updates state", async () => {
    const { result } = renderHook(() =>
      useMemory({ endpoint: ENDPOINTS.memory }),
    );

    await waitFor(() => {
      expect(result.current.status).toBe("idle");
    });

    await act(async () => {
      await result.current.save("correction", "use net revenue");
    });

    expect(result.current.memories).toEqual([
      { key: "correction", value: "use net revenue" },
    ]);
    expect(result.current.status).toBe("idle");
  });

  it("remove DELETEs and updates state", async () => {
    const { result } = renderHook(() =>
      useMemory({ endpoint: ENDPOINTS.memory }),
    );

    await waitFor(() => {
      expect(result.current.status).toBe("idle");
    });

    await act(async () => {
      await result.current.remove("revenue");
    });

    expect(result.current.memories).toEqual([]);
  });

  it("sets error status on failed save", async () => {
    server.use(
      http.post("http://localhost/api/arivie/memory", () =>
        HttpResponse.json({ error: "boom" }, { status: 500 }),
      ),
    );

    const { result } = renderHook(() =>
      useMemory({ endpoint: ENDPOINTS.memory }),
    );

    await waitFor(() => {
      expect(result.current.status).toBe("idle");
    });

    await act(async () => {
      await result.current.save("x", "y");
    });

    expect(result.current.status).toBe("error");
  });
});
