/* SPDX-License-Identifier: Apache-2.0 */
import { ToolError } from "@arivie/db-postgres";
import type { Entity } from "@arivie/semantic";
import { describe, expect, it } from "vitest";
import { crossSourceHashJoin } from "../src/cross-source.js";

function mockEntity(
  name: string,
  columns?: { name: string; pii?: boolean }[],
): Entity {
  return {
    name,
    description: name,
    grain: "one row",
    primary_key: "id",
    columns: columns?.map((column) => ({
      name: column.name,
      type: "text",
      description: column.name,
      pii: column.pii ?? false,
    })),
  };
}

describe("crossSourceHashJoin", () => {
  const leftEntity = mockEntity("orders");
  const rightEntity = mockEntity("page_views");

  it("inner-joins 5×3 rows into 15 output rows", () => {
    const leftRows = Array.from({ length: 5 }, (_, i) => ({
      order_id: i + 1,
      join_key: "shared",
    }));
    const rightRows = Array.from({ length: 3 }, (_, i) => ({
      view_id: i + 1,
      join_key: "shared",
    }));

    const result = crossSourceHashJoin({
      leftRows,
      rightRows,
      leftEntity,
      rightEntity,
      joinOn: { left: "join_key", right: "join_key" },
    });

    expect(result.rows).toHaveLength(15);
    expect(result.droppedPii).toEqual([]);
    expect(result.droppedRows).toBe(0);
    expect(result.rows[0]).toMatchObject({
      order_id: 1,
      view_id: 1,
      join_key: "shared",
    });
  });

  it("throws cross-source-too-large when left exceeds 10k rows", () => {
    const leftRows = Array.from({ length: 10_001 }, (_, i) => ({
      join_key: i,
    }));
    const rightRows = [{ join_key: 0 }];

    expect(() =>
      crossSourceHashJoin({
        leftRows,
        rightRows,
        leftEntity,
        rightEntity,
        joinOn: { left: "join_key", right: "join_key" },
      }),
    ).toThrow(ToolError);

    try {
      crossSourceHashJoin({
        leftRows,
        rightRows,
        leftEntity,
        rightEntity,
        joinOn: { left: "join_key", right: "join_key" },
      });
    } catch (err) {
      expect(err).toMatchObject({ kind: "cross-source-too-large" });
      expect((err as ToolError).message).toMatch(/left=10001/);
      expect((err as ToolError).message).toMatch(/right=1/);
    }
  });

  it("drops PII columns by default and preserves them with includePii", () => {
    const leftWithPii = mockEntity("users", [{ name: "email", pii: true }]);
    const leftRows = [{ user_id: 1, email: "a@example.com", join_key: "k" }];
    const rightRows = [{ event_id: 1, join_key: "k" }];

    const dropped = crossSourceHashJoin({
      leftRows,
      rightRows,
      leftEntity: leftWithPii,
      rightEntity,
      joinOn: { left: "join_key", right: "join_key" },
    });

    expect(dropped.rows).toHaveLength(1);
    expect(dropped.rows[0]).not.toHaveProperty("email");
    expect(dropped.rows[0]).toMatchObject({ user_id: 1, event_id: 1 });
    expect(dropped.droppedPii).toEqual(["email"]);

    const kept = crossSourceHashJoin({
      leftRows,
      rightRows,
      leftEntity: leftWithPii,
      rightEntity,
      joinOn: { left: "join_key", right: "join_key" },
      includePii: true,
    });

    expect(kept.rows[0]).toHaveProperty("email", "a@example.com");
    expect(kept.droppedPii).toEqual([]);
  });

  it("throws cross-source-output-too-large when inner join exceeds maxOutputRows", () => {
    const leftRows = Array.from({ length: 10 }, (_, i) => ({
      join_key: "shared",
      left_id: i,
    }));
    const rightRows = Array.from({ length: 100 }, (_, i) => ({
      join_key: "shared",
      right_id: i,
    }));

    expect(() =>
      crossSourceHashJoin({
        leftRows,
        rightRows,
        leftEntity,
        rightEntity,
        joinOn: { left: "join_key", right: "join_key" },
        maxOutputRows: 500,
      }),
    ).toThrow(ToolError);

    try {
      crossSourceHashJoin({
        leftRows,
        rightRows,
        leftEntity,
        rightEntity,
        joinOn: { left: "join_key", right: "join_key" },
        maxOutputRows: 500,
      });
    } catch (err) {
      expect(err).toMatchObject({ kind: "cross-source-output-too-large" });
      expect((err as ToolError).message).toMatch(/actual=1000/);
      expect((err as ToolError).message).toMatch(/cap=500/);
    }
  });

  it("drops PII columns case-insensitively (entity email vs row Email)", () => {
    const leftWithPii = mockEntity("users", [{ name: "email", pii: true }]);
    const leftRows = [
      { user_id: 1, Email: "secret@example.com", join_key: "k" },
    ];
    const rightRows = [{ event_id: 1, join_key: "k" }];

    const result = crossSourceHashJoin({
      leftRows,
      rightRows,
      leftEntity: leftWithPii,
      rightEntity,
      joinOn: { left: "join_key", right: "join_key" },
    });

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).not.toHaveProperty("Email");
    expect(result.rows[0]).not.toHaveProperty("email");
    expect(result.rows[0]).toMatchObject({ user_id: 1, event_id: 1 });
  });

  it("returns empty rows when join keys do not match", () => {
    const result = crossSourceHashJoin({
      leftRows: [{ join_key: "a" }],
      rightRows: [{ join_key: "b" }],
      leftEntity,
      rightEntity,
      joinOn: { left: "join_key", right: "join_key" },
    });

    expect(result.rows).toEqual([]);
    expect(result.droppedRows).toBe(2);
    expect(result.droppedPii).toEqual([]);
  });
});
