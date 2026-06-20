/* SPDX-License-Identifier: Apache-2.0 */
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { discoverChannels, discoverSubscriptions } from "../../src/server/discovery.js";

describe("discoverChannels", () => {
  it("discovers channel modules from channels/", async () => {
    const root = join(tmpdir(), `arivie-channels-${Date.now()}`);
    await mkdir(join(root, "channels"), { recursive: true });
    await writeFile(
      join(root, "channels", "github.ts"),
      `export const channel = {
  name: "github",
  trigger: { id: "github", configSchema: undefined, routes: [] },
  config: {},
};`,
    );

    const channels = await discoverChannels(root);
    expect(channels).toHaveLength(1);
    expect(channels[0].name).toBe("github");
  });

  it("returns an empty array when channels/ does not exist", async () => {
    const root = join(tmpdir(), `arivie-no-channels-${Date.now()}`);
    const channels = await discoverChannels(root);
    expect(channels).toEqual([]);
  });
});

describe("discoverSubscriptions", () => {
  it("discovers subscription modules from subscriptions/", async () => {
    const root = join(tmpdir(), `arivie-subs-${Date.now()}`);
    await mkdir(join(root, "subscriptions"), { recursive: true });
    await writeFile(
      join(root, "subscriptions", "github.ts"),
      `export const subscription = {
  source: "github",
  target: { kind: "agent", id: "arivie" },
};`,
    );

    const subs = await discoverSubscriptions(root);
    expect(subs).toHaveLength(1);
    expect(subs[0].target.kind).toBe("agent");
    expect(subs[0].target.id).toBe("arivie");
  });

  it("returns an empty array when subscriptions/ does not exist", async () => {
    const root = join(tmpdir(), `arivie-no-subs-${Date.now()}`);
    const subs = await discoverSubscriptions(root);
    expect(subs).toEqual([]);
  });
});
