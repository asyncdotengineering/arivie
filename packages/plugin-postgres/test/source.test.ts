/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, it } from "vitest";
import { postgresSource } from "../src/source.js";

describe("postgresSource", () => {
  it("constructs a postgres source adapter without connecting", async () => {
    const source = postgresSource({
      url: "postgres://user:pass@localhost:5432/db",
      readOnlyRole: "arivie_reader",
    });
    expect(source.kind).toBe("postgres");
    expect(typeof source.id).toBe("string");
    expect(typeof source.execute).toBe("function");
    expect(typeof source.setupRole).toBe("function");
    // Construction is lazy — no connection opened until a query runs.
    await source.close?.();
  });
});
