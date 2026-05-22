/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ArivieConfigSchema } from "../src/config.js";

const mockModel = { provider: "mock" };

function mockAdapter(kind = "mock") {
  return {
    kind,
    id: `${kind}:test`,
    execute: async () => ({
      rows: [],
      rowCount: 0,
      durationMs: 0,
      truncated: false,
    }),
    introspect: async () => [],
    verifyOwnerIdentity: async () => {},
  };
}

const mockPostgres = {
  ...mockAdapter("postgres"),
  url: "postgres://localhost/arivie",
  sql: {},
};

const baseConfig = {
  owner: { id: "owner-1", name: "Acme" },
  model: mockModel,
  workspace: { rootDir: "./semantic" },
  semantic: { path: "./semantic", mode: "auto" as const },
  resolveUser: async () => ({
    userId: "user-1",
    permissions: [] as string[],
    dbRole: "arivie_reader",
  }),
};

describe("ArivieConfigSchema sources shapes (REQ-44)", () => {
  it("accepts bare SourceAdapter entries", () => {
    const parsed = ArivieConfigSchema.parse({
      ...baseConfig,
      sources: { postgres: mockPostgres },
    });
    expect(parsed.sources.postgres).toBe(mockPostgres);
  });

  it("accepts { adapter: SourceAdapter } entries", () => {
    const parsed = ArivieConfigSchema.parse({
      ...baseConfig,
      sources: { postgres: { adapter: mockPostgres } },
    });
    expect(parsed.sources.postgres).toEqual({ adapter: mockPostgres });
  });

  it("accepts { mcp: stdio } entries", () => {
    const parsed = ArivieConfigSchema.parse({
      ...baseConfig,
      sources: {
        postgres: mockPostgres,
        mock: {
          mcp: {
            command: "tsx",
            args: ["./mock-server.ts"],
            env: { NODE_ENV: "test" },
          },
        },
      },
    });
    expect(parsed.sources.mock).toEqual({
      mcp: {
        command: "tsx",
        args: ["./mock-server.ts"],
        env: { NODE_ENV: "test" },
      },
    });
  });

  it("accepts { mcp: { url } } entries", () => {
    const parsed = ArivieConfigSchema.parse({
      ...baseConfig,
      sources: {
        postgres: mockPostgres,
        remote: { mcp: { url: "http://127.0.0.1:3000/mcp" } },
      },
    });
    expect(parsed.sources.remote).toEqual({
      mcp: { url: "http://127.0.0.1:3000/mcp" },
    });
  });

  it("rejects empty sources record", () => {
    expect(() =>
      ArivieConfigSchema.parse({
        ...baseConfig,
        sources: {},
      }),
    ).toThrow(z.ZodError);
  });
});

