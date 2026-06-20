/* SPDX-License-Identifier: Apache-2.0 */
import { z } from "zod";

export interface ArivieSchedule {
  /** Stable schedule identifier. Must be unique within the Arivie instance. */
  id: string;
  /** Cron expression (5-, 6-, or 7-part). */
  cron: string;
  /** Optional IANA timezone (defaults to host timezone). */
  timezone?: string;
  /** Prompt sent to the Arivie agent on each scheduled run. */
  prompt: string;
  /** Optional metadata stored on the Mastra schedule row. */
  metadata?: Record<string, unknown>;
}

export const scheduleSchema: z.ZodType<ArivieSchedule> = z.object({
  id: z.string().min(1),
  cron: z.string().min(1),
  timezone: z.string().optional(),
  prompt: z.string().min(1),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const schedulesSchema = z.array(scheduleSchema).optional();

/**
 * Declare a recurring Arivie schedule.
 *
 * A schedule is operational runtime config — it says *when* to run a
 * recurring analytical prompt against the agent. It does NOT live in
 * `SKILL.md` frontmatter; skills are reusable expertise, while schedules
 * are owner-specific cadences.
 */
export function defineSchedule(schedule: ArivieSchedule): ArivieSchedule {
  return scheduleSchema.parse(schedule);
}

export function defineSchedules(
  schedules: ArivieSchedule[],
): ArivieSchedule[] {
  return schedulesSchema.parse(schedules) ?? [];
}
