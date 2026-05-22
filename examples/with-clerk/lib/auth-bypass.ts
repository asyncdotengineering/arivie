/* SPDX-License-Identifier: Apache-2.0 */

export const BYPASS_OWNER_ID = "bypass-user";
export const BYPASS_BEARER = "arivie-bypass-token";

/** Refuse test-only bypass in production unless explicitly forced. */
export function assertAuthBypassAllowed(): void {
  if (process.env.ARIVIE_AUTH_BYPASS !== "1") {
    return;
  }
  if (
    process.env.NODE_ENV === "production" &&
    process.env.ARIVIE_AUTH_BYPASS_FORCE !== "1"
  ) {
    console.error(
      "ARIVIE_AUTH_BYPASS refused in production (set ARIVIE_AUTH_BYPASS_FORCE=1 to override)",
    );
    process.exit(1);
  }
}

export function isAuthBypassRequest(req: Request): boolean {
  if (process.env.ARIVIE_AUTH_BYPASS !== "1") {
    return false;
  }
  const header = req.headers.get("authorization") ?? "";
  return header === `Bearer ${BYPASS_BEARER}`;
}
