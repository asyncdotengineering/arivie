/* SPDX-License-Identifier: Apache-2.0 */
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { InProcessSandboxFilesystem } from "@arivie/workspace";
import type { WorkspaceConfig } from "./types.js";

export interface LocalWorkspaceOptions {
  /**
   * Directory the workspace is rooted at. Resolved against the cwd.
   *
   * **Serverless note** — on Vercel, AWS Lambda, and other read-only-fs
   * runtimes, the path you pass here MUST live under `/tmp`. To save you
   * the env check, this helper auto-routes to `/tmp/arivie/workspace`
   * when it detects a serverless runtime (`process.env.VERCEL === "1"`
   * or `process.env.AWS_LAMBDA_FUNCTION_NAME`), so the `at` you pass in
   * code can stay as `./workspace` and it'll do the right thing in prod.
   * Set `at` to an explicit absolute path under `/tmp/...` to override.
   */
  at: string;
  /**
   * Opt into the `workspace_bash` tool. Requires the sandboxed filesystem
   * we construct (which always qualifies), so this is just a UX flag.
   */
  bash?: boolean;
  /**
   * If `true`, every write/mutate operation rejects with `ReadOnlyError`.
   * Use for mounts you want the agent to navigate but not modify (e.g. a
   * shared `/docs` directory). Default `false` — writable.
   */
  readOnly?: boolean;
  /** Index workspace + skills for BM25-backed search. */
  bm25?: boolean;
  /**
   * Register the `finalize_report` tool. Defaults to `true`; set `false`
   * to omit it.
   */
  finalizeReport?: boolean;
}

/**
 * One-line writable local workspace.
 *
 * ```ts
 * import { defineArivie, localWorkspace } from "@arivie/core";
 *
 * const instance = await defineArivie({
 *   ...,
 *   workspace: localWorkspace({ at: "./workspace", bash: true }),
 * });
 * ```
 *
 * Equivalent to manually constructing an `InProcessSandboxFilesystem` at
 * the given path and wiring it into a `WorkspaceConfig` — but reads as a
 * single sentence at the call site. The directory is created if missing
 * (so callers don't need their own `mkdirSync` boilerplate).
 */
/**
 * Detect serverless runtimes whose root filesystem is read-only outside
 * `/tmp` — currently Vercel and AWS Lambda. Other Node hosts behave
 * normally. Override via `ARIVIE_FORCE_TMP_WORKSPACE=1`.
 */
function isServerlessReadOnlyFs(): boolean {
  return (
    process.env.ARIVIE_FORCE_TMP_WORKSPACE === "1" ||
    process.env.VERCEL === "1" ||
    process.env.AWS_LAMBDA_FUNCTION_NAME != null
  );
}

function resolveWorkspaceRoot(at: string): string {
  if (at.startsWith("/tmp/") || at.startsWith("/var/")) return resolve(at);
  if (isServerlessReadOnlyFs()) {
    return "/tmp/arivie/workspace";
  }
  return resolve(at);
}

export function localWorkspace(opts: LocalWorkspaceOptions): WorkspaceConfig {
  const rootDir = resolveWorkspaceRoot(opts.at);
  mkdirSync(rootDir, { recursive: true });
  const filesystem = new InProcessSandboxFilesystem({
    rootDir,
    readOnly: opts.readOnly ?? false,
  });
  const cfg: WorkspaceConfig = {
    rootDir,
    filesystem,
  };
  if (opts.bash !== undefined) cfg.bash = opts.bash;
  if (opts.bm25 !== undefined) cfg.bm25 = opts.bm25;
  if (opts.finalizeReport !== undefined) cfg.finalizeReport = opts.finalizeReport;
  return cfg;
}
