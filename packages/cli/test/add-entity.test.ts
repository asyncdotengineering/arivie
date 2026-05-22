/* SPDX-License-Identifier: Apache-2.0 */
import { execSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { ArivieConfig } from "@arivie/core/types";
import type { LanguageModel } from "ai";
import { postgresAdapter } from "@arivie/db-postgres";
import { parseEntity } from "@arivie/semantic";
import { runAddEntity } from "../src/commands/add-entity.js";
import { tableMetadataToEntityYaml } from "../src/lib/introspect-to-yaml.js";

const ARIVIE_ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "../../..");
const SEED_SQL = join(ARIVIE_ROOT, "scripts", "seed-dogfood.sql");

function dockerAvailable(): boolean {
  try {
    execSync("docker info", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const describeIntegration = describe.skipIf(!dockerAvailable());

describe("runAddEntity path safety", () => {
  it("rejects table names with path traversal", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const code = await runAddEntity("../../escape");
    expect(code).not.toBe(0);
    expect(errSpy).toHaveBeenCalledWith(
      expect.stringContaining("only letters, numbers, and underscore"),
    );
    errSpy.mockRestore();
  });
});

describe("tableMetadataToEntityYaml", () => {
  it("produces EntitySchema-valid YAML", () => {
    const yaml = tableMetadataToEntityYaml({
      schema: "public",
      name: "orders",
      primary_key: ["id"],
      row_count: 10,
      foreign_keys: [],
      columns: [
        {
          name: "id",
          type: "integer",
          nullable: false,
        },
        {
          name: "customer_id",
          type: "text",
          nullable: false,
        },
      ],
    });

    const result = parseEntity("orders.yml", yaml);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.name).toBe("orders");
      expect(result.value.columns).toHaveLength(2);
    }
  });
});

describeIntegration.sequential("add entity orders (dogfood seed)", () => {
  let container: Awaited<ReturnType<PostgreSqlContainer["start"]>>;
  let workDir: string;
  let prevCwd: string;

  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:16-alpine").start();
    const url = container.getConnectionUri();
    process.env.DATABASE_URL = url;

    const adapter = postgresAdapter({ url });
    const seedSql = await readFile(SEED_SQL, "utf8");
    await adapter.sql.unsafe(seedSql);
    await adapter.sql.end();

    workDir = await mkdtemp(join(tmpdir(), "arivie-add-entity-"));
    prevCwd = process.cwd();
    await mkdir(join(workDir, "semantic/entities"), { recursive: true });
    process.chdir(workDir);
  }, 120_000);

  afterAll(async () => {
    process.chdir(prevCwd);
    await container.stop();
    await rm(workDir, { recursive: true, force: true });
  });

  it("writes orders.yml that parseEntity accepts", async () => {
    const pg = postgresAdapter({ url: container.getConnectionUri() });
    const config: ArivieConfig = {
      owner: { id: "dogfood-test", name: "Dogfood" },
      model: {} as LanguageModel,
      workspace: { rootDir: "./semantic" },
      storage: pg,
      sources: {
        postgres: {
          kind: "adapter",
          adapter: pg,
          description: "Test Postgres for the CLI add-entity test.",
        },
      },
      semantic: { path: "./semantic", mode: "preload" },
      resolveUser: async () => ({
        userId: "cli",
        permissions: [],
        dbRole: "arivie_reader",
      }),
    };

    const code = await runAddEntity("orders", config);
    expect(code).toBe(0);

    const yaml = await readFile(join(workDir, "semantic/entities/orders.yml"), "utf8");
    const parsed = parseEntity("orders.yml", yaml);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.value.name).toBe("orders");
      expect(parsed.value.columns?.some((c) => c.name === "total_amount")).toBe(true);
    }
  });
});
