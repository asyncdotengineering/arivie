/* SPDX-License-Identifier: Apache-2.0 */

/**
 * Per-turn temporal grounding (REQ-4). Delivered after the cached governance
 * core prefix — not in agent instructions.
 */
export function temporalGrounding(now: Date): string {
  const iso = now.toISOString();
  return (
    `## Current time\nNow is ${iso} (UTC); today is ${iso.slice(0, 10)}. ` +
    "Use this as \"now\" for ALL relative dates (today, yesterday, this/last week, " +
    "this/last month, this/last year, year-to-date) — never assume a date from training data. " +
    "When the data declares a store timezone, convert to it for date boundaries."
  );
}