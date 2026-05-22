/* SPDX-License-Identifier: Apache-2.0 */
import { act, renderHook, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { useSchema } from "../src/use-schema.js";
import { ENDPOINTS } from "./_msw-handlers.js";
import { server } from "./setup.js";

describe("useSchema", () => {
  it("loads catalog, entities, and owner on mount", async () => {
    const { result } = renderHook(() =>
      useSchema({ endpoint: ENDPOINTS.schema }),
    );

    await waitFor(() => {
      expect(result.current.status).toBe("idle");
    });

    expect(result.current.catalog).toEqual({ version: "0.1" });
    expect(result.current.entities).toHaveLength(1);
    expect(result.current.owner).toEqual({ id: "owner-1", name: "Acme" });
  });

  it("refetch updates state", async () => {
    const { result } = renderHook(() =>
      useSchema({ endpoint: ENDPOINTS.schemaV2 }),
    );

    await waitFor(() => {
      expect(result.current.status).toBe("idle");
    });

    expect(result.current.entities).toHaveLength(1);

    server.use(
      http.get("http://localhost/api/arivie-v2/schema", () =>
        HttpResponse.json({
          catalog: { version: "0.2" },
          entities: [{ name: "orders" }, { name: "customers" }],
          owner: { id: "owner-1", name: "Acme" },
        }),
      ),
    );

    act(() => {
      result.current.refetch();
    });

    await waitFor(() => {
      expect(result.current.entities).toHaveLength(2);
    });
  });

  it("sets error status on failed fetch", async () => {
    server.use(
      http.get("http://localhost/api/arivie/schema", () =>
        HttpResponse.json({ error: "boom" }, { status: 500 }),
      ),
    );

    const { result } = renderHook(() =>
      useSchema({ endpoint: ENDPOINTS.schema }),
    );

    await waitFor(() => {
      expect(result.current.status).toBe("error");
    });
  });
});
