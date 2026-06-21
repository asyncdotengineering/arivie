/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ArivieConfigError } from "../../src/errors.js";
import {
  assertUniquePluginIds,
  definePlugin,
  parsePluginConfig,
} from "../../src/plugins/index.js";
import type { PluginDefinition } from "../../src/plugins/types.js";

function base<T = unknown>(
  over: Partial<PluginDefinition<T>> = {},
): PluginDefinition<T> {
  return { id: "demo", version: "1.0.0", ...over };
}

describe("definePlugin — factory + config typing", () => {
  it("returns a factory that binds config to the definition", () => {
    const factory = definePlugin<{ url: string }>({
      id: "demo",
      version: "2.3.1",
    });
    const instance = factory({ url: "postgres://x" });
    expect(instance.definition.id).toBe("demo");
    expect(instance.config.url).toBe("postgres://x");
  });

  it("accepts a fully-formed plugin", () => {
    expect(() =>
      definePlugin(
        base({
          permissions: [{ id: "analytics.sql.read", description: "read-only SQL" }],
          capabilities: [
            {
              id: "analytics.query",
              title: "Query",
              description: "Answer analytics questions.",
              requiredPermissions: ["analytics.sql.read"],
            },
          ],
          contextSchemas: [
            { id: "analytics.entity", kind: "executable", schema: z.object({}) },
          ],
          blueprints: [
            { id: "bp", title: "BP", version: "1.0.0", appliesTo: ["analytics"], files: [] },
          ],
        }),
      ),
    ).not.toThrow();
  });
});

describe("definePlugin — id + version validation", () => {
  it.each(["Demo", "", "-bad", "has space", "UPPER"])(
    "rejects invalid id %j",
    (id) => {
      expect(() => definePlugin(base({ id }))).toThrow(ArivieConfigError);
    },
  );

  it.each(["1.0", "v1.0.0", "1.0.0.0", "abc", ""])(
    "rejects invalid semver %j",
    (version) => {
      expect(() => definePlugin(base({ version }))).toThrow(ArivieConfigError);
    },
  );

  it.each(["1.0.0", "0.0.0", "2.3.1-rc.1", "1.2.3+build.5"])(
    "accepts valid semver %j",
    (version) => {
      expect(() => definePlugin(base({ version }))).not.toThrow();
    },
  );
});

describe("definePlugin — permission + capability validation", () => {
  it("rejects a permission with no description", () => {
    expect(() =>
      definePlugin(base({ permissions: [{ id: "x", description: "" }] })),
    ).toThrow(/non-empty description/);
  });

  it("rejects duplicate permission ids", () => {
    expect(() =>
      definePlugin(
        base({
          permissions: [
            { id: "x", description: "a" },
            { id: "x", description: "b" },
          ],
        }),
      ),
    ).toThrow(/duplicate permission/);
  });

  it("rejects a capability requiring an undeclared permission", () => {
    expect(() =>
      definePlugin(
        base({
          capabilities: [
            {
              id: "cap",
              title: "Cap",
              description: "d",
              requiredPermissions: ["network.outbound"],
            },
          ],
        }),
      ),
    ).toThrow(/undeclared permission "network.outbound"/);
  });

  it("rejects duplicate capability ids", () => {
    expect(() =>
      definePlugin(
        base({
          capabilities: [
            { id: "cap", title: "A", description: "d" },
            { id: "cap", title: "B", description: "d" },
          ],
        }),
      ),
    ).toThrow(/duplicate capability/);
  });
});

describe("definePlugin — context schema validation", () => {
  it("rejects an executable schema with no validation schema", () => {
    expect(() =>
      definePlugin(base({ contextSchemas: [{ id: "s", kind: "executable" }] })),
    ).toThrow(/must provide a validation schema/);
  });

  it("accepts a knowledge schema with no validation schema", () => {
    expect(() =>
      definePlugin(base({ contextSchemas: [{ id: "s", kind: "knowledge" }] })),
    ).not.toThrow();
  });
});

describe("registry helpers", () => {
  it("assertUniquePluginIds throws on a duplicate", () => {
    const a = definePlugin(base({ id: "a" }))(undefined);
    const a2 = definePlugin(base({ id: "a" }))(undefined);
    expect(() => assertUniquePluginIds([a, a2])).toThrow(/Duplicate plugin id "a"/);
  });

  it("parsePluginConfig validates against a Standard Schema", async () => {
    const factory = definePlugin<{ url: string }>({
      id: "pg",
      version: "1.0.0",
      configSchema: z.object({ url: z.string().url() }),
    });
    await expect(
      parsePluginConfig(factory({ url: "not-a-url" })),
    ).rejects.toThrow(ArivieConfigError);
    const ok = await parsePluginConfig(factory({ url: "https://db.example" }));
    expect(ok.config.url).toBe("https://db.example");
  });
});
