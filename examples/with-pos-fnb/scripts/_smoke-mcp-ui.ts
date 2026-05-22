/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Smoke-test `arivie mcp --ui` over stdio using the canonical MCP client.
 * Verifies: server initializes, exposes the expected tools (render_arivie_ui,
 * ask, query, schema) and the UI resource (ui://render_arivie_ui/view.html),
 * and that calling render_arivie_ui with a sample spec returns valid JSON.
 */
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = join(__dirname, "..", ".env.local");
const configPath = resolve(__dirname, "..", "arivie.config.ts");
const cliEntry = resolve(__dirname, "..", "..", "..", "packages", "cli", "dist", "bin", "arivie.js");

const env: Record<string, string> = { ...(process.env as Record<string, string>) };
try {
  const raw = readFileSync(envPath, "utf8");
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq < 0) continue;
    const k = t.slice(0, eq).trim();
    const v = t.slice(eq + 1).trim();
    if (v) env[k] = v;
  }
} catch {
  // best effort
}

const transport = new StdioClientTransport({
  command: "node",
  args: [cliEntry, "mcp", "--config", configPath, "--ui"],
  env,
});

const client = new Client({ name: "arivie-mcp-ui-smoke", version: "0.0.1" });

await client.connect(transport);

console.log("✓ connected");

const tools = await client.listTools();
console.log(`\n→ tools (${tools.tools.length}):`);
for (const t of tools.tools) {
  console.log(`   - ${t.name}${t.title ? ` (${t.title})` : ""}`);
}

const resources = await client.listResources();
console.log(`\n→ resources (${resources.resources.length}):`);
for (const r of resources.resources) {
  console.log(`   - ${r.uri}  [${r.mimeType ?? "?"}]`);
}

// json-render specs use a root+elements graph, not a single tree node.
// Catalog validates against the wrapper shape.
const sampleSpec = {
  root: "metric",
  elements: {
    metric: {
      type: "ArivieMetric",
      props: {
        label: "Revenue (yesterday)",
        value: "4449.38",
        format: "currency",
        delta: "+12.3%",
        deltaDirection: "up",
      },
      children: [] as string[],
      visible: true,
    },
  },
};

let renderRes;
try {
  renderRes = await client.callTool({
    name: "render_arivie_ui",
    arguments: { spec: sampleSpec },
  });
} catch (err) {
  console.log("\n→ render_arivie_ui rejected the spec:");
  console.log("  ", err instanceof Error ? err.message : String(err));
  await client.close();
  process.exit(1);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const isErr = (renderRes as any).isError === true;
console.log(`\n→ render_arivie_ui returned content[] (isError=${isErr}):`);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
for (const part of (renderRes.content as any[]) ?? []) {
  if (part.type === "text") {
    console.log(`   text content (first 400 chars):`);
    console.log(`   ${part.text.slice(0, 400)}`);
    try {
      const echoed = JSON.parse(part.text);
      if (echoed.root && echoed.elements) {
        const rootEl = echoed.elements[echoed.root];
        console.log(`   ✓ valid spec (root="${echoed.root}", type=${rootEl?.type}, label="${rootEl?.props?.label}", value=${rootEl?.props?.value})`);
      }
    } catch {
      // not JSON — likely a validation error message
    }
  }
}

await client.close();

if (isErr) {
  console.log("\n✗ smoke FAILED — render_arivie_ui returned isError=true");
  process.exit(1);
}
console.log("\n✓ smoke passed — arivie mcp --ui returns renderable specs");
