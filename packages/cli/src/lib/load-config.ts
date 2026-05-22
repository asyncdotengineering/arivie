/* SPDX-License-Identifier: Apache-2.0 */
import { readFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { ArivieConfig } from "@arivie/core/types";
import type { LanguageModel } from "ai";
import { ArivieConfigError } from "@arivie/core";
import { postgresAdapter } from "@arivie/db-postgres";
import { createJiti } from "jiti";

function isArivieConfig(value: unknown): value is ArivieConfig {
  if (value == null || typeof value !== "object") {
    return false;
  }
  const v = value as Record<string, unknown>;
  return (
    typeof v.owner === "object" &&
    v.owner != null &&
    typeof (v.owner as { id?: unknown }).id === "string" &&
    "sources" in v &&
    typeof v.sources === "object" &&
    v.sources != null &&
    "workspace" in v &&
    typeof v.workspace === "object" &&
    "semantic" in v &&
    typeof v.semantic === "object"
  );
}

function isArivieInstance(value: unknown): boolean {
  if (value == null || typeof value !== "object") {
    return false;
  }
  const v = value as Record<string, unknown>;
  return (
    typeof v.handler === "function" &&
    v.agent != null &&
    typeof v.agent === "object" &&
    v.mastra != null
  );
}

function ownerIdFromAgent(agent: { id?: string }): string {
  const id = agent.id ?? "";
  if (id.startsWith("arivie-")) {
    return id.slice("arivie-".length);
  }
  throw new ArivieConfigError(
    `Cannot derive owner id from agent id "${id}"; export a raw config object for CLI commands`,
  );
}

async function semanticModeFromSource(configPath: string): Promise<ArivieConfig["semantic"]["mode"]> {
  const source = await readFile(configPath, "utf8");
  const match = /mode:\s*["'](auto|preload|indexed)["']/.exec(source);
  return (match?.[1] ?? "auto") as ArivieConfig["semantic"]["mode"];
}

async function configFromInstance(
  instance: {
    agent: { id?: string };
    mastra: { getStorage: () => unknown };
  },
  configPath: string,
): Promise<ArivieConfig> {
  const ownerId = ownerIdFromAgent(instance.agent);
  const dbUrl = process.env.DATABASE_URL;
  if (dbUrl == null || dbUrl.length === 0) {
    throw new ArivieConfigError(
      "DATABASE_URL is required when arivie.config.ts exports defineArivie() instance only",
    );
  }

  const mode = await semanticModeFromSource(configPath);
  const semantic: ArivieConfig["semantic"] = {
    path: "./semantic",
    mode,
  };

  if (mode === "indexed") {
    throw new ArivieConfigError(
      "semantic.mode 'indexed' requires exporting the raw config object (with embeddings) for `arivie setup`",
    );
  }

  return {
    owner: { id: ownerId, name: ownerId },
    model: {} as LanguageModel,
    workspace: { rootDir: "./semantic" },
    sources: { postgres: postgresAdapter({ url: dbUrl }) },
    semantic,
    resolveUser: async () => ({
      userId: "cli",
      permissions: [],
      dbRole: "arivie_reader",
    }),
  };
}

function pickConfigExport(mod: Record<string, unknown>): unknown {
  const candidates = [
    mod.config,
    mod.arivieConfig,
    mod.default,
    mod.arivie,
  ];
  for (const candidate of candidates) {
    if (candidate !== undefined) {
      return candidate;
    }
  }
  return undefined;
}

/**
 * Load and normalise `arivie.config.ts` (default or named export).
 * @see RFC-002 §4.12
 */
export async function loadArivieConfig(configPath: string): Promise<ArivieConfig> {
  const absPath = isAbsolute(configPath)
    ? configPath
    : resolve(process.cwd(), configPath);

  const jiti = createJiti(dirname(absPath), {
    interopDefault: true,
    moduleCache: false,
  });

  let loaded: unknown;
  try {
    loaded = await jiti.import(pathToFileURL(absPath).href);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new ArivieConfigError(`Failed to load ${configPath}: ${message}`);
  }

  const mod =
    loaded != null && typeof loaded === "object"
      ? (loaded as Record<string, unknown>)
      : { default: loaded };

  const picked = pickConfigExport(mod);
  if (picked === undefined) {
    throw new ArivieConfigError(
      `No config export found in ${configPath} (expected default, config, arivieConfig, or arivie)`,
    );
  }

  if (isArivieConfig(picked)) {
    return picked;
  }

  if (isArivieInstance(picked)) {
    return configFromInstance(
      picked as { agent: { id?: string }; mastra: { getStorage: () => unknown } },
      absPath,
    );
  }

  throw new ArivieConfigError(
    `Export from ${configPath} is not a recognised Arivie config or instance`,
  );
}
