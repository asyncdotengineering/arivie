/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, it } from "vitest";
import { defineSchedule, defineSchedules } from "../src/schedules.js";

describe("schedules", () => {
  it("defineSchedule validates a valid schedule", () => {
    const schedule = defineSchedule({
      id: "weekly-flash",
      cron: "0 9 * * 1",
      prompt: "Weekly flash report",
    });
    expect(schedule.id).toBe("weekly-flash");
    expect(schedule.cron).toBe("0 9 * * 1");
    expect(schedule.prompt).toBe("Weekly flash report");
  });

  it("defineSchedule rejects empty id", () => {
    expect(() =>
      defineSchedule({
        id: "",
        cron: "0 9 * * 1",
        prompt: "x",
      }),
    ).toThrow();
  });

  it("defineSchedule rejects empty cron", () => {
    expect(() =>
      defineSchedule({
        id: "x",
        cron: "",
        prompt: "x",
      }),
    ).toThrow();
  });

  it("defineSchedule rejects empty prompt", () => {
    expect(() =>
      defineSchedule({
        id: "x",
        cron: "0 9 * * 1",
        prompt: "",
      }),
    ).toThrow();
  });

  it("defineSchedule accepts optional metadata", () => {
    const schedule = defineSchedule({
      id: "weekly-flash",
      cron: "0 9 * * 1",
      prompt: "Weekly flash report",
      metadata: { channel: "slack" },
    });
    expect(schedule.metadata).toEqual({ channel: "slack" });
  });

  it("defineSchedules validates an array", () => {
    const schedules = defineSchedules([
      { id: "a", cron: "0 9 * * 1", prompt: "A" },
      { id: "b", cron: "0 10 * * 1", prompt: "B" },
    ]);
    expect(schedules).toHaveLength(2);
  });

  it("defineSchedules rejects invalid entries", () => {
    expect(() =>
      defineSchedules([
        { id: "a", cron: "0 9 * * 1", prompt: "A" },
        { id: "", cron: "0 10 * * 1", prompt: "B" },
      ]),
    ).toThrow();
  });
});
