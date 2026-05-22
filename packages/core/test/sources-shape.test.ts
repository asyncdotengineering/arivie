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
  setupRole: async () => {},
};

const baseConfig = {
  owner: { id: "owner-1", name: "Acme" },
  model: mockModel,
  storage: mockPostgres,
  workspace: { rootDir: "./semantic" },
  semantic: { path: "./semantic", mode: "auto" as const },
  resolveUser: async () => ({
    userId: "user-1",
    permissions: [] as string[],
    dbRole: "arivie_reader",
  }),
};

describe("ArivieConfigSchema sources shapes", () => {
  it('accepts { kind: "adapter", adapter, description }', () => {
    const parsed = ArivieConfigSchema.parse({
      ...baseConfig,
      sources: {
        commerce: {
          kind: "adapter" as const,
          adapter: mockPostgres,
          description: "primary OLTP postgres",
        },
      },
    });
    expect(parsed.sources.commerce).toEqual({
      kind: "adapter",
      adapter: mockPostgres,
      description: "primary OLTP postgres",
    });
  });

  it('accepts { kind: "adapter", adapter, description, useWhen }', () => {
    const parsed = ArivieConfigSchema.parse({
      ...baseConfig,
      sources: {
        commerce: {
          kind: "adapter" as const,
          adapter: mockPostgres,
          description: "primary OLTP postgres",
          useWhen: "any operational entity question",
        },
      },
    });
    expect(parsed.sources.commerce).toEqual({
      kind: "adapter",
      adapter: mockPostgres,
      description: "primary OLTP postgres",
      useWhen: "any operational entity question",
    });
  });

  it('accepts { kind: "mcp", mcp, description } (stdio)', () => {
    const parsed = ArivieConfigSchema.parse({
      ...baseConfig,
      sources: {
        commerce: {
          kind: "adapter" as const,
          adapter: mockPostgres,
          description: "primary",
        },
        mock: {
          kind: "mcp" as const,
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
      kind: "mcp",
      mcp: {
        command: "tsx",
        args: ["./mock-server.ts"],
        env: { NODE_ENV: "test" },
      },
      description: "mock mcp source",
    });
  });

  it('accepts { kind: "mcp", mcp: { url }, description }', () => {
    const parsed = ArivieConfigSchema.parse({
      ...baseConfig,
      sources: {
        commerce: {
          kind: "adapter" as const,
          adapter: mockPostgres,
          description: "primary",
        },
        remote: {
          kind: "mcp" as const,
          mcp: { url: "http://127.0.0.1:3000/mcp" },
          description: "remote mcp",
        },
      },
    });
    expect(parsed.sources.remote).toEqual({
      kind: "mcp",
      mcp: { url: "http://127.0.0.1:3000/mcp" },
      description: "remote mcp",
    });
  });

  it("rejects a bare SourceAdapter (must use the kind-tagged wrap)", () => {
    expect(() =>
      ArivieConfigSchema.parse({
        ...baseConfig,
        sources: { postgres: mockPostgres },
      }),
    ).toThrow(z.ZodError);
  });

  it("rejects { adapter } without kind", () => {
    expect(() =>
      ArivieConfigSchema.parse({
        ...baseConfig,
        sources: {
          postgres: { adapter: mockPostgres, description: "x" },
        },
      }),
    ).toThrow(z.ZodError);
  });

  it("rejects { adapter, kind } without description", () => {
    expect(() =>
      ArivieConfigSchema.parse({
        ...baseConfig,
        sources: {
          postgres: { kind: "adapter", adapter: mockPostgres },
        },
      }),
    ).toThrow(z.ZodError);
  });

  it("rejects { kind: 'mcp', mcp } without description", () => {
    expect(() =>
      ArivieConfigSchema.parse({
        ...baseConfig,
        sources: {
          commerce: {
            kind: "adapter",
            adapter: mockPostgres,
            description: "primary",
          },
          mock: { kind: "mcp", mcp: { command: "tsx" } },
        },
      }),
    ).toThrow(z.ZodError);
  });

  it("rejects empty description string", () => {
    expect(() =>
      ArivieConfigSchema.parse({
        ...baseConfig,
        sources: {
          postgres: {
            kind: "adapter",
            adapter: mockPostgres,
            description: "",
          },
        },
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

  it("rejects missing storage slot", () => {
    const { storage: _storage, ...withoutStorage } = baseConfig;
    expect(() =>
      ArivieConfigSchema.parse({
        ...withoutStorage,
        sources: {
          postgres: {
            kind: "adapter",
            adapter: mockPostgres,
            description: "x",
          },
        },
      }),
    ).toThrow(z.ZodError);
  });
});
