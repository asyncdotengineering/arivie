/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, it } from "vitest";
import { ToolError } from "../src/errors.js";
import { validateExecuteSql } from "../src/sql-guard.js";

describe("validateExecuteSql", () => {
  describe("accepts", () => {
    it("a plain SELECT", () => {
      expect(() => validateExecuteSql("SELECT * FROM orders")).not.toThrow();
    });
    it("WITH ... SELECT (CTE)", () => {
      expect(() =>
        validateExecuteSql(
          "WITH recent AS (SELECT * FROM orders WHERE id > 0) SELECT * FROM recent",
        ),
      ).not.toThrow();
    });
    it("SELECT with DML keyword in string literal", () => {
      expect(() =>
        validateExecuteSql("SELECT 'DELETE FROM x' AS lbl"),
      ).not.toThrow();
    });
    it("SELECT with DML keyword in line comment", () => {
      expect(() =>
        validateExecuteSql("SELECT 1 -- DELETE FROM foo\nFROM orders"),
      ).not.toThrow();
    });
    it("SELECT with DML keyword in block comment", () => {
      expect(() =>
        validateExecuteSql("SELECT 1 /* DROP TABLE foo */ FROM orders"),
      ).not.toThrow();
    });
    it("SELECT with trailing semicolon (single)", () => {
      expect(() =>
        validateExecuteSql("SELECT * FROM orders;"),
      ).not.toThrow();
    });
    it("WITH with double-quoted identifier containing DML word", () => {
      expect(() =>
        validateExecuteSql('WITH "delete me" AS (SELECT 1) SELECT * FROM "delete me"'),
      ).not.toThrow();
    });
  });

  describe("rejects (KI-1-05 — pi r2 M-r2-1)", () => {
    it("multi-statement via semicolon", () => {
      expect(() =>
        validateExecuteSql("SELECT 1; DROP TABLE orders"),
      ).toThrow(ToolError);
    });
    it("CTE-DML bypass: WITH ... DELETE", () => {
      expect(() =>
        validateExecuteSql(
          "WITH x AS (DELETE FROM orders RETURNING *) SELECT * FROM x",
        ),
      ).toThrow(ToolError);
    });
    it("CTE-DML bypass: WITH ... INSERT", () => {
      expect(() =>
        validateExecuteSql(
          "WITH y AS (INSERT INTO orders VALUES (1) RETURNING *) SELECT * FROM y",
        ),
      ).toThrow(ToolError);
    });
    it("CTE-DML bypass: WITH ... UPDATE", () => {
      expect(() =>
        validateExecuteSql(
          "WITH z AS (UPDATE orders SET x = 1 RETURNING *) SELECT * FROM z",
        ),
      ).toThrow(ToolError);
    });
    it("pg_catalog access", () => {
      expect(() =>
        validateExecuteSql("SELECT * FROM pg_catalog.pg_tables"),
      ).toThrow(ToolError);
    });
    it("information_schema access", () => {
      expect(() =>
        validateExecuteSql("SELECT * FROM information_schema.columns"),
      ).toThrow(ToolError);
    });
    it("non-SELECT/WITH first keyword", () => {
      expect(() => validateExecuteSql("UPDATE orders SET x = 1")).toThrow(
        ToolError,
      );
    });
    it("empty query", () => {
      expect(() => validateExecuteSql("")).toThrow(ToolError);
      expect(() => validateExecuteSql("   ")).toThrow(ToolError);
    });
    it("SET / RESET (session-mutation)", () => {
      expect(() => validateExecuteSql("SET role TO bad")).toThrow(ToolError);
    });
    it("EXECUTE prepared (bypass via prepared)", () => {
      expect(() =>
        validateExecuteSql("EXECUTE my_prepared_stmt"),
      ).toThrow(ToolError);
    });
    it("multi-statement with intervening whitespace", () => {
      expect(() =>
        validateExecuteSql(`
          SELECT 1
          ;
          DROP TABLE orders
        `),
      ).toThrow(ToolError);
    });
  });
});
