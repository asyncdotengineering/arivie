/* SPDX-License-Identifier: Apache-2.0 */
import { createHash } from "node:crypto";

export interface ProvenanceRecord {
  sourceHash: string;
  loadedAt: string;
  validation: "passed" | "failed";
  adapterId?: string;
  adapterVersion?: string;
  generatedPath?: string;
  repairAttempts?: number;
  humanReviewRequired?: boolean;
}

export function hashSourceContent(raw: string | Buffer): string {
  return createHash("sha256").update(raw).digest("hex");
}

export function createProvenanceRecord(opts: {
  raw: string | Buffer;
  validation: "passed" | "failed";
  loadedAt?: string;
  adapterId?: string;
  adapterVersion?: string;
  generatedPath?: string;
  repairAttempts?: number;
  humanReviewRequired?: boolean;
}): ProvenanceRecord {
  const record: ProvenanceRecord = {
    sourceHash: hashSourceContent(opts.raw),
    loadedAt: opts.loadedAt ?? new Date().toISOString(),
    validation: opts.validation,
  };

  if (opts.adapterId !== undefined) record.adapterId = opts.adapterId;
  if (opts.adapterVersion !== undefined) record.adapterVersion = opts.adapterVersion;
  if (opts.generatedPath !== undefined) record.generatedPath = opts.generatedPath;
  if (opts.repairAttempts !== undefined) record.repairAttempts = opts.repairAttempts;
  if (opts.humanReviewRequired !== undefined) {
    record.humanReviewRequired = opts.humanReviewRequired;
  }

  return record;
}
