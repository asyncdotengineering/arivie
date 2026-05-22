/* SPDX-License-Identifier: Apache-2.0 */

export class ParseError extends Error {
  readonly code: string;
  readonly filePath: string;

  constructor(opts: { code: string; filePath: string; message: string }) {
    super(opts.message);
    this.name = "ParseError";
    this.code = opts.code;
    this.filePath = opts.filePath;
  }
}

export class LoadError extends Error {
  readonly code: string;
  readonly filePath: string;
  readonly errors: ParseError[];

  constructor(opts: {
    code: string;
    filePath: string;
    message: string;
    errors: ParseError[];
  }) {
    super(opts.message);
    this.name = "LoadError";
    this.code = opts.code;
    this.filePath = opts.filePath;
    this.errors = opts.errors;
  }
}
