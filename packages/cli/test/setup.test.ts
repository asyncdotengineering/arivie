/* SPDX-License-Identifier: Apache-2.0 */
import { execSync } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { postgresAdapter } from "@arivie/db-postgres";
import { runSetup } from "../src/commands/setup.js";
import { loadArivieConfig } from "../src/lib/load-config.js";
import { postgresAdapterFromConfig } from "../src/lib/postgres-from-config.js";

const SETUP_CONFIG_DIR = join(
  fileURLToPath(new URL(".", import.meta.url)),
  "fixtures/setup-config",
);

function dockerAvailable(): boolean {
  try {
    execSync("docker info", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const describeIntegration = describe.skipIf(!dockerAvailable());

describeIntegration.sequential("setup idempotency (testcontainer)", () => {
  let container: Awaited<ReturnType<PostgreSqlContainer["start"]>>;
  let connectionUrl: string;
  let semanticDir: string;
  let prevCwd: string;

  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:16-alpine").start();
    connectionUrl = container.getConnectionUri();
    process.env.DATABASE_URL = connectionUrl;

    semanticDir = join(
      fileURLToPath(new URL(".", import.meta.url)),
      `semantic-${Date.now()}`,
    );
    await mkdir(join(semanticDir, "entities"), { recursive: true });
    prevCwd = process.cwd();
    process.chdir(SETUP_CONFIG_DIR);
  }, 120_000);

  afterAll(async () => {
    process.chdir(prevCwd);
    try {
      const config = await loadArivieConfig("./arivie.config.ts");
      await postgresAdapterFromConfig(config).sql.end();
    } catch {
      const adapter = postgresAdapter({ url: connectionUrl });
      await adapter.sql.end();
    }
    await container.stop();
    await rm(semanticDir, { recursive: true, force: true });
  });

  it("loads named config export", async () => {
    const config = await loadArivieConfig("./arivie.config.ts");
    expect(config.owner.id).toBe("dogfood-test");
    expect(postgresAdapterFromConfig(config).url).toBe(connectionUrl);
  });

  it("setup twice leaves one role and one owner row", async () => {
    const config = await loadArivieConfig("./arivie.config.ts");
    config.semantic.path = semanticDir;

    const first = await runSetup(config);
    expect(first.roleMessage).toMatch(/role created|already exists/);
    expect(first.mastraMessage).toMatch(/migrations applied|no migrations/);

    const second = await runSetup(config);
    expect(second.roleMessage).toContain("no-op");
    expect(second.mastraMessage).toContain("no migrations to apply");
    expect(second.ownerMessage).toContain("Owner identity: ok");

    await postgresAdapterFromConfig(config).sql.end();

    const adapter = postgresAdapter({ url: connectionUrl });
    const roles = await adapter.sql<{ count: string }[]>`
      SELECT COUNT(*)::text AS count FROM pg_roles WHERE rolname = 'arivie_reader'
    `;
    expect(Number(roles[0]?.count)).toBe(1);

    const identities = await adapter.sql<{ count: string }[]>`
      SELECT COUNT(*)::text AS count
      FROM arivie_owner_identity
      WHERE key = 'owner_id' AND value = 'dogfood-test'
    `;
    expect(Number(identities[0]?.count)).toBe(1);
    await adapter.sql.end();
  });

  it("parallel setupRole calls both succeed", async () => {
    const config = await loadArivieConfig("./arivie.config.ts");
    const adapter = postgresAdapterFromConfig(config);
    await Promise.all([
      adapter.setupRole("arivie_reader"),
      adapter.setupRole("arivie_reader"),
    ]);
  });

  it("setup reports friendly error for malformed entity YAML", { timeout: 60_000 }, async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { printCliCommandError } = await import("../src/lib/cli-errors.js");
    const badDir = join(
      fileURLToPath(new URL(".", import.meta.url)),
      `semantic-bad-${Date.now()}`,
    );
    await mkdir(join(badDir, "entities"), { recursive: true });
    await writeFile(join(badDir, "entities/orders.yml"), "name: [\n", "utf8");
    await writeFile(join(badDir, "catalog.yml"), "entities: []\n", "utf8");

    const config = await loadArivieConfig("./arivie.config.ts");
    config.semantic.path = badDir;
    config.semantic.mode = "auto";

    let code = 0;
    try {
      await runSetup(config);
    } catch (err) {
      printCliCommandError("setup", err);
      code = 1;
    }

    expect(code).toBe(1);
    expect(errSpy).toHaveBeenCalledWith(
      expect.stringMatching(/Arivie setup failed:/),
    );
    errSpy.mockRestore();
    await rm(badDir, { recursive: true, force: true });
  });
});

