/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, it } from "vitest";
import { generateCloudflareServerEntry } from "../src/lib/build-plugin-cloudflare.js";

describe("generateCloudflareServerEntry", () => {
  it("generates a Cloudflare Worker entry", () => {
    const source = generateCloudflareServerEntry({
      configPath: "/project/arivie.config.ts",
      rootDir: "/project",
      outputDir: "/project/dist",
    });
    expect(source).toContain(`import arivieConfig from "/project/arivie.config.ts"`);
    expect(source).toContain("createArivieServer");
    expect(source).toContain("export default");
    expect(source).toContain("fetch(request, env, executionCtx)");
  });
});
