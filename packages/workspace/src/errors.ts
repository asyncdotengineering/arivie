/* SPDX-License-Identifier: Apache-2.0 */

export class ReadOnlyError extends Error {
  readonly code = "ARIVIE_READ_ONLY" as const;
  readonly path?: string;

  constructor(opts?: { path?: string; message?: string }) {
    super(opts?.message ?? "Semantic layer filesystem is read-only");
    this.name = "ReadOnlyError";
    if (opts?.path !== undefined) {
      this.path = opts.path;
    }
  }
}
