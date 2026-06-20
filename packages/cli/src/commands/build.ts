/* SPDX-License-Identifier: Apache-2.0 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { defineCommand } from "citty";
import {
  buildCloudflareServer,
  generateCloudflareServerEntry,
} from "../lib/build-plugin-cloudflare.js";
import {
  buildNodeServer,
  generateNodeServerEntry,
} from "../lib/build-plugin-node.js";

export const buildCommand = defineCommand({
  meta: {
    name: "build",
    description: "Build Arivie project for a target runtime",
  },
  args: {
    target: {
      type: "string",
      required: true,
      description: "Deployment target: node | cloudflare",
    },
    output: {
      type: "string",
      default: "./dist",
      description: "Build output directory",
    },
    config: {
      type: "string",
      default: "./arivie.config.ts",
      description: "Path to arivie.config.ts",
    },
  },
  async run({ args }) {
    if (args.target !== "node" && args.target !== "cloudflare") {
      throw new Error(
        `Unknown target: ${args.target}. Supported targets: node, cloudflare`,
      );
    }

    const rootDir = process.cwd();
    const outputDir = isAbsolute(args.output)
      ? args.output
      : resolve(rootDir, args.output);
    const configPath = isAbsolute(args.config)
      ? args.config
      : resolve(rootDir, args.config);

    const intermediateDir = resolve(rootDir, ".arivie");
    await mkdir(intermediateDir, { recursive: true });

    if (args.target === "node") {
      const entryPath = resolve(intermediateDir, "server-entry.ts");
      const entrySource = generateNodeServerEntry({
        configPath,
        rootDir,
        outputDir,
      });
      await writeFile(entryPath, entrySource, "utf8");

      await buildNodeServer({ configPath, rootDir, outputDir, entryPath });
      console.log(`[arivie] Built Node server: ${resolve(outputDir, "server.mjs")}`);
      return 0;
    }

    if (args.target === "cloudflare") {
      const entryPath = resolve(intermediateDir, "worker-entry.ts");
      const entrySource = generateCloudflareServerEntry({
        configPath,
        rootDir,
        outputDir,
      });
      await writeFile(entryPath, entrySource, "utf8");

      await buildCloudflareServer({ configPath, rootDir, outputDir, entryPath });
      console.log(`[arivie] Built Cloudflare Worker: ${resolve(outputDir, "worker.mjs")}`);
      return 0;
    }

    throw new Error(
      `Unknown target: ${args.target}. Supported targets: node, cloudflare`,
    );
  },
});
