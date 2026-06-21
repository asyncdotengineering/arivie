/* SPDX-License-Identifier: Apache-2.0 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, parse } from "node:path";

function parseEnvFile(path: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed
      .slice(eq + 1)
      .trim()
      .replace(/^["']|["']$/g, "");
    if (key.length > 0 && value.length > 0) out[key] = value;
  }
  return out;
}

/**
 * Load `.env` / `.env.local` for a config, so `arivie <cmd> --config <path>`
 * "just works" without exporting env by hand. Looks in the config file's
 * directory and every parent up to the filesystem root, plus the current
 * working directory — so an example config finds the repo-root `.env`. Never
 * overrides values already set in `process.env` (real env wins).
 */
export function loadDotEnv(configPath: string): void {
  const candidates: string[] = [];
  let dir = dirname(configPath);
  const root = parse(dir).root;
  for (;;) {
    candidates.push(join(dir, ".env.local"), join(dir, ".env"));
    if (dir === root) break;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  candidates.push(join(process.cwd(), ".env.local"), join(process.cwd(), ".env"));

  for (const file of candidates) {
    if (!existsSync(file)) continue;
    for (const [key, value] of Object.entries(parseEnvFile(file))) {
      if (process.env[key] === undefined) process.env[key] = value;
    }
  }
}
