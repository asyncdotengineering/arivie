/* SPDX-License-Identifier: Apache-2.0 */
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let cached: string | null | undefined;

/**
 * Resolve a WRITABLE base directory for Arivie's zero-config local stores
 * (default conversation memory, default context vector index) — multi-cloud safe.
 *
 * Probes, in order:
 *  1. `./.arivie` — project-local, durable in development.
 *  2. `<os.tmpdir()>/arivie` — writable on most serverless runtimes (Vercel,
 *     AWS Lambda, Netlify), durable within a warm instance.
 *
 * Returns `null` when no filesystem is writable (e.g. Cloudflare Workers), so
 * callers degrade to in-memory rather than crashing on a read-only FS. The
 * historical behavior was an unconditional `mkdirSync(".arivie")` that threw
 * `ENOENT`/`EROFS` and 500'd the first serverless deploy. Result is cached.
 */
export function resolveArivieDir(): string | null {
  if (cached !== undefined) return cached;
  for (const base of [".arivie", join(tmpdir(), "arivie")]) {
    try {
      mkdirSync(base, { recursive: true });
      cached = base;
      return base;
    } catch {
      // Read-only / unavailable at this location — try the next candidate.
    }
  }
  cached = null;
  return null;
}

/** Reset the cached dir (tests only). */
export function _resetArivieDirCache(): void {
  cached = undefined;
}
