/* SPDX-License-Identifier: Apache-2.0 */
import type { SourceAdapter } from "@arivie/core/types";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { postgresAdapter } from "../src/adapter.js";
import type { PostgresAdapter } from "../src/types.js";

function makeMockPostgresAdapter(): PostgresAdapter {
  return postgresAdapter({
    url: "postgres://user:secret@db.example.com:5432/mydb",
  });
}

const _conformance: SourceAdapter<string> = makeMockPostgresAdapter();

describe("PostgresAdapter SourceAdapter<string> conformance", () => {
  let adapter: PostgresAdapter;

  beforeAll(() => {
    adapter = makeMockPostgresAdapter();
  });

  afterAll(async () => {
    await adapter.sql.end();
  });

  it("exposes kind postgres and a credential-safe id", () => {
    expect(adapter.kind).toBe("postgres");
    expect(adapter.id).toMatch(/^postgres:/);
    expect(adapter.id).not.toContain("secret");
    expect(adapter.id).toContain("db.example.com");
    expect(adapter.id).toContain("mydb");
  });

  it("type-level assignment to SourceAdapter<string> compiles", () => {
    void _conformance;
    expect(adapter.execute).toBeTypeOf("function");
  });

  it("exposes compileMetric", () => {
    expect(adapter.compileMetric).toBeTypeOf("function");
  });
});
