/* SPDX-License-Identifier: Apache-2.0 */
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { InProcessSandboxFilesystem } from "@arivie/workspace";
import type { WorkspaceConfig } from "./types.js";

export interface LocalWorkspaceOptions {
  /** Directory the workspace is rooted at. Resolved against the cwd. */
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
export function localWorkspace(opts: LocalWorkspaceOptions): WorkspaceConfig {
  const rootDir = resolve(opts.at);
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
