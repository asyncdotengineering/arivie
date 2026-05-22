/* SPDX-License-Identifier: Apache-2.0 */

// ArivieBoundaryError is owned by core (not db-postgres) — it represents an
// owner-identity boundary violation, which is a core concept. Previously it
// was defined in db-postgres and re-exported from core; that created a real
// circular dep at the type layer (core → db-postgres → core/types). Moving
// the definition here breaks the cycle. db-postgres imports it back via
// `@arivie/core/errors` subpath.
export class ArivieBoundaryError extends Error {
  readonly code = "ARIVIE_BOUNDARY_ERROR" as const;

  constructor(
    readonly detail: Record<string, unknown>,
    message: string,
  ) {
    super(message);
    this.name = "ArivieBoundaryError";
  }
}

export class ArivieConfigError extends Error {
  readonly code = "ARIVIE_CONFIG_ERROR" as const;

  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "ArivieConfigError";
  }
}

export class ArivieInternalError extends Error {
  readonly code = "ARIVIE_INTERNAL_ERROR" as const;

  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "ArivieInternalError";
  }
}

// [S1-fix r1-m2] Typed "not implemented" error for stubbed-but-typed surfaces
// (e.g., compile_metric in Sprint 1; replaced by real impl in Sprint 2 C20).
export class ArivieNotImplementedError extends Error {
  readonly code = "ARIVIE_NOT_IMPLEMENTED" as const;

  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "ArivieNotImplementedError";
  }
}
