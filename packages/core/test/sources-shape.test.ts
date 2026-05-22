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
  it("accepts { adapter, description } entries", () => {
    const parsed = ArivieConfigSchema.parse({
      ...baseConfig,
      sources: {
        postgres: {
          adapter: mockPostgres,
          description: "primary OLTP postgres",
        },
      },
    });
    expect(parsed.sources.postgres).toEqual({
      adapter: mockPostgres,
      description: "primary OLTP postgres",
    });
  });

  it("accepts { adapter, description, useWhen } entries", () => {
    const parsed = ArivieConfigSchema.parse({
      ...baseConfig,
      sources: {
        postgres: {
          adapter: mockPostgres,
          description: "primary OLTP postgres",
          useWhen: "any operational entity question",
        },
      },
    });
    expect(parsed.sources.postgres).toEqual({
      adapter: mockPostgres,
      description: "primary OLTP postgres",
      useWhen: "any operational entity question",
    });
  });

  it("accepts { mcp, description } (stdio) entries", () => {
    const parsed = ArivieConfigSchema.parse({
      ...baseConfig,
      sources: {
        postgres: {
          adapter: mockPostgres,
          description: "primary OLTP postgres",
        },
        mock: {
          mcp: {
            command: "tsx",
            args: ["./mock-server.ts"],
            env: { NODE_ENV: "test" },
          },
          description: "mock mcp source",
        },
      },
    });
    expect(parsed.sources.mock).toEqual({
      mcp: {
        command: "tsx",
        args: ["./mock-server.ts"],
        env: { NODE_ENV: "test" },
      },
      description: "mock mcp source",
    });
  });

  it("accepts { mcp: { url }, description } entries", () => {
    const parsed = ArivieConfigSchema.parse({
      ...baseConfig,
      sources: {
        postgres: {
          adapter: mockPostgres,
          description: "primary OLTP postgres",
        },
        remote: {
          mcp: { url: "http://127.0.0.1:3000/mcp" },
          description: "remote mcp",
        },
      },
    });
    expect(parsed.sources.remote).toEqual({
      mcp: { url: "http://127.0.0.1:3000/mcp" },
      description: "remote mcp",
    });
  });

  it("rejects a bare SourceAdapter (must be wrapped in { adapter, description })", () => {
    expect(() =>
      ArivieConfigSchema.parse({
        ...baseConfig,
        sources: { postgres: mockPostgres },
      }),
    ).toThrow(z.ZodError);
  });

  it("rejects { adapter } without description", () => {
    expect(() =>
      ArivieConfigSchema.parse({
        ...baseConfig,
        sources: { postgres: { adapter: mockPostgres } },
      }),
    ).toThrow(z.ZodError);
  });

  it("rejects { mcp } without description", () => {
    expect(() =>
      ArivieConfigSchema.parse({
        ...baseConfig,
        sources: {
          postgres: {
            adapter: mockPostgres,
            description: "primary OLTP postgres",
          },
          mock: { mcp: { command: "tsx" } },
        },
      }),
    ).toThrow(z.ZodError);
  });

  it("rejects empty description string", () => {
    expect(() =>
      ArivieConfigSchema.parse({
        ...baseConfig,
        sources: { postgres: { adapter: mockPostgres, description: "" } },
      }),
    ).toThrow(z.ZodError);
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
