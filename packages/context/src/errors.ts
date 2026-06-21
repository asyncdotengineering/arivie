/* SPDX-License-Identifier: Apache-2.0 */

export class ContextError extends Error {
  readonly code: string;
  readonly path?: string;

  constructor(opts: { code: string; message: string; path?: string }) {
    super(opts.message);
    this.name = "ContextError";
    this.code = opts.code;
    this.path = opts.path;
  }
}

export class ContextLoadError extends Error {
  readonly code: string;
  readonly root: string;
  readonly issues: readonly ContextError[];

  constructor(opts: {
    code: string;
    root: string;
    message: string;
    issues: readonly ContextError[];
  }) {
    super(opts.message);
    this.name = "ContextLoadError";
    this.code = opts.code;
    this.root = opts.root;
    this.issues = opts.issues;
  }
}
