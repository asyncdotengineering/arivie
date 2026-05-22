/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Session-aware streaming CLI chat for the Arivie agent.
 *
 * - Persists conversation via Mastra Memory (PostgresStore — already wired
 *   into defineArivie). Each turn passes the same `thread` + `resource` so
 *   the agent remembers prior turns within a thread.
 * - Streams text deltas to stdout as the model emits them.
 * - Prints every tool call (SQL / compile_metric args / outputs) after [DONE].
 * - Lets you switch context mode (preload/indexed) per process.
 *
 * Usage:
 *   pnpm exec tsx scripts/chat-session.ts --prompt "..." [--thread <id>] [--mode preload|indexed]
 *   pnpm exec tsx scripts/chat-session.ts --new                        # echo a fresh thread id and exit
 *   pnpm exec tsx scripts/chat-session.ts --list-threads               # list threads for the resource
 *   pnpm exec tsx scripts/chat-session.ts --delete <thread-id>         # purge a thread + its memory rows
 *   pnpm exec tsx scripts/chat-session.ts --script <file>              # batch mode, one prompt per line, same thread
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { defineArivie, type ArivieInstance } from "@arivie/core";
import { runWithUserContext } from "@arivie/core/context";
import { postgresAdapter } from "@arivie/db-postgres";
import {
  buildIndex,
  type EmbeddingProvider,
} from "@arivie/embeddings";
import {
  loadSemanticLayerSync,
  type SemanticLayer,
} from "@arivie/semantic";
import { PgVector } from "@mastra/pg";

const RESOURCE_ID = "owner-cli";
const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = join(__dirname, "..", ".env.local");
const semanticPath = join(__dirname, "..", "semantic");

// ── env + flags ─────────────────────────────────────────────────────────────

function loadEnv(): void {
  try {
    const raw = readFileSync(envPath, "utf8");
    for (const line of raw.split("\n")) {
      const t = line.trim();
      if (t === "" || t.startsWith("#")) continue;
      const eq = t.indexOf("=");
      if (eq < 0) continue;
      const key = t.slice(0, eq).trim();
      const value = t.slice(eq + 1).trim();
      if (process.env[key] == null && value !== "") process.env[key] = value;
    }
  } catch (err) {
    console.warn(`[chat] could not read ${envPath}: ${String(err)}`);
  }
}

interface Flags {
  readonly prompt?: string;
  readonly thread?: string;
  readonly mode: "preload" | "indexed";
  readonly listThreads: boolean;
  readonly deleteThread?: string;
  readonly newThread: boolean;
  readonly script?: string;
  readonly noStream: boolean;
  readonly buildRagIndex: boolean;
}

const RAG_INDEX_NAME = "with_nextjs_sem_5";
const GOOGLE_EMBED_MODEL = "gemini-embedding-001";
const GOOGLE_EMBED_DIMENSIONS = 768; // truncated via providerOptions.outputDimensionality (MRL); ivfflat max 2000.
const GOOGLE_EMBED_COST_PER_M_TOKENS = 0.15;

function parseFlags(argv: string[]): Flags {
  const out: {
    prompt?: string;
    thread?: string;
    mode: "preload" | "indexed";
    listThreads: boolean;
    deleteThread?: string;
    newThread: boolean;
    script?: string;
    noStream: boolean;
    buildRagIndex: boolean;
  } = {
    mode: "preload",
    listThreads: false,
    newThread: false,
    noStream: false,
    buildRagIndex: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case "--prompt":
        out.prompt = argv[++i];
        break;
      case "--thread":
        out.thread = argv[++i];
        break;
      case "--mode": {
        const m = argv[++i];
        if (m !== "preload" && m !== "indexed") {
          throw new Error(`--mode must be preload|indexed, got ${m}`);
        }
        out.mode = m;
        break;
      }
      case "--list-threads":
        out.listThreads = true;
        break;
      case "--delete":
        out.deleteThread = argv[++i];
        break;
      case "--new":
        out.newThread = true;
        break;
      case "--script":
        out.script = argv[++i];
        break;
      case "--no-stream":
        out.noStream = true;
        break;
      case "--build-rag-index":
        out.buildRagIndex = true;
        break;
      case "--help":
      case "-h":
        console.log(
          "usage: tsx scripts/chat-session.ts [--prompt ... | --new | --list-threads | --delete ID | --script FILE] [--thread ID] [--mode preload|indexed] [--no-stream]",
        );
        process.exit(0);
    }
  }
  return out;
}

// ── runtime construction ────────────────────────────────────────────────────

function resolveModel() {
  const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  if (apiKey == null || apiKey === "") {
    throw new Error("GOOGLE_GENERATIVE_AI_API_KEY required");
  }
  const modelId = process.env.GOOGLE_MODEL ?? "gemini-2.5-flash";
  const google = createGoogleGenerativeAI({ apiKey });
  return { model: google(modelId), modelId };
}

async function buildInstance(mode: Flags["mode"]): Promise<{
  instance: ArivieInstance;
  postgres: ReturnType<typeof postgresAdapter>;
  modelId: string;
}> {
  const databaseUrl = process.env.DATABASE_URL;
  if (databaseUrl == null || databaseUrl === "") {
    throw new Error("DATABASE_URL required");
  }
  const { model, modelId } = resolveModel();
  const postgres = postgresAdapter({
    url: databaseUrl,
    readOnlyRole: "arivie_reader",
  });
  const user = {
    userId: RESOURCE_ID,
    permissions: ["analytics:read"],
    dbRole: "arivie_reader",
  };

  let embeddings:
    | { provider: EmbeddingProvider; vector: PgVector; indexName: string }
    | undefined;
  if (mode === "indexed") {
    embeddings = {
      provider: makeGoogleEmbeddingProvider(),
      vector: new PgVector({ id: "with-nextjs-pgvector", connectionString: databaseUrl }),
      indexName: RAG_INDEX_NAME,
    };
  }

  const instance = await defineArivie({
    owner: { id: process.env.ARIVIE_OWNER_ID ?? "with-nextjs-owner", name: "Owner CLI" },
    
    model,
    workspace: { rootDir: semanticPath },
    storage: postgres,
    sources: {
      postgres: {
        kind: "adapter",
        adapter: postgres,
        description: "Demo Postgres for this example script.",
      },
    },
    semantic: {
      path: semanticPath,
      mode,
      ...(embeddings != null ? { embeddings } : {}),
    },
    compileMetric: true,
    resolveUser: async () => user,
  });
  return { instance, postgres, modelId };
}

function makeGoogleEmbeddingProvider(): EmbeddingProvider {
  const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  if (apiKey == null || apiKey === "") {
    throw new Error("GOOGLE_GENERATIVE_AI_API_KEY required for rag mode");
  }
  const google = createGoogleGenerativeAI({ apiKey });
  return {
    // gemini-embedding-001 native dim = 3072. Truncated to GOOGLE_EMBED_DIMENSIONS
    // via providerOptions.google.outputDimensionality so we stay under pgvector
    // ivfflat's 2000-dim ceiling. The providerOptions field travels on the
    // EmbeddingProvider so buildIndex + retrieve are symmetric — both use the
    // same MRL-truncated dimensions automatically (KI-livedemo-1 fix).
    model: google.textEmbedding(GOOGLE_EMBED_MODEL),
    modelName: GOOGLE_EMBED_MODEL,
    dimensions: GOOGLE_EMBED_DIMENSIONS,
    costPerMillionTokens: GOOGLE_EMBED_COST_PER_M_TOKENS,
    providerOptions: {
      google: { outputDimensionality: GOOGLE_EMBED_DIMENSIONS },
    },
  };
}

async function runBuildRagIndex(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (databaseUrl == null || databaseUrl === "") {
    throw new Error("DATABASE_URL required");
  }
  const layer: SemanticLayer = loadSemanticLayerSync(semanticPath);
  const provider = makeGoogleEmbeddingProvider();
  const vector = new PgVector({
    id: "with-nextjs-pgvector",
    connectionString: databaseUrl,
  });

  console.log(
    `building rag index '${RAG_INDEX_NAME}' (provider=${provider.modelName}, dimensions=${provider.dimensions})...`,
  );

  // buildIndex now reads providerOptions from the provider itself (KI-livedemo-1
  // fix) — no need to pass it separately. Chunks across all entities.
  const result = await buildIndex({
    layer,
    provider,
    vector,
    indexName: RAG_INDEX_NAME,
    batchSize: 32,
  });

  console.log(
    `done. chunkCount=${result.chunkCount} totalEmbeddingCost=$${result.totalEmbeddingCost.toFixed(6)}`,
  );
  await vector.disconnect?.();
}

// ── streaming helpers ───────────────────────────────────────────────────────

function printToolEventsFromMessages(messages: unknown[]): void {
  let i = 0;
  for (const msg of messages) {
    if (msg == null || typeof msg !== "object") continue;
    const parts = (msg as { content?: unknown }).content;
    if (!Array.isArray(parts)) continue;
    for (const part of parts) {
      if (part == null || typeof part !== "object") continue;
      const p = part as Record<string, unknown>;
      if (p.type === "tool-call") {
        console.log(
          `\n── tool-call[${i}] ${String(p.toolName ?? "?")}: ${JSON.stringify(
            p.input ?? p.args ?? {},
          ).slice(0, 600)}`,
        );
      } else if (p.type === "tool-result") {
        const out = p.output ?? p.result ?? {};
        let outStr: string;
        if (typeof out === "object" && out !== null && "value" in out) {
          outStr = String((out as { value: unknown }).value);
        } else {
          outStr = JSON.stringify(out);
        }
        // If output is stringified JSON with a sql field, surface it.
        try {
          const parsed = JSON.parse(outStr) as { sql?: unknown; rowCount?: unknown };
          const sql = typeof parsed.sql === "string" ? parsed.sql : undefined;
          if (sql) {
            console.log(`   sql:    ${sql.replace(/\s+/g, " ").slice(0, 400)}`);
          }
          if (typeof parsed.rowCount === "number") {
            console.log(`   rows:   ${parsed.rowCount}`);
          }
        } catch {
          // not JSON — just summarise length.
        }
        console.log(`   output: ${outStr.slice(0, 300)}${outStr.length > 300 ? "…" : ""}`);
        i += 1;
      }
    }
  }
}

async function streamOneTurn(
  instance: ArivieInstance,
  user: { userId: string; permissions: string[]; dbRole: string },
  prompt: string,
  threadId: string,
  noStream: boolean,
): Promise<void> {
  const memory = { thread: threadId, resource: RESOURCE_ID };

  if (noStream) {
    const result = (await runWithUserContext(user, async () =>
      instance.agent.generate(prompt, { memory }),
    )) as Record<string, unknown>;
    const text = typeof result.text === "string" ? result.text : "(no text)";
    console.log(text);
    const response = result.response as { messages?: unknown[] } | undefined;
    if (Array.isArray(response?.messages)) {
      printToolEventsFromMessages(response.messages);
    }
    return;
  }

  const streamResult = await runWithUserContext(user, async () =>
    instance.agent.stream(prompt, { memory }),
  );
  process.stdout.write("\n");
  const reader = streamResult.textStream.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (typeof value === "string" && value.length > 0) process.stdout.write(value);
  }
  process.stdout.write("\n");

  // After the text stream completes, pull final response shape for tool events.
  try {
    const response = (await streamResult.response) as { messages?: unknown[] } | null;
    if (response && Array.isArray(response.messages)) {
      printToolEventsFromMessages(response.messages);
    }
  } catch (err) {
    console.warn(`\n[chat] could not read response shape: ${String(err)}`);
  }
}

// ── thread management ──────────────────────────────────────────────────────

async function memoryHandle(instance: ArivieInstance): Promise<{
  
  listThreads: (args: any) => Promise<any>;
  deleteThread: (threadId: string) => Promise<void>;
} | null> {
  // Mastra Agent has a .memory accessor returning the Memory instance.
  const memUnknown = (
    instance.agent as unknown as {
      getMemory?: () => Promise<unknown> | unknown;
      memory?: unknown;
    }
  ).getMemory;
  const mem =
    typeof memUnknown === "function"
      ? await memUnknown.call(instance.agent)
      : (instance.agent as unknown as { memory?: unknown }).memory;
  if (
    mem != null &&
    typeof mem === "object" &&
    "listThreads" in mem &&
    "deleteThread" in mem
  ) {
    return mem as {
      
      listThreads: (args: any) => Promise<any>;
      deleteThread: (threadId: string) => Promise<void>;
    };
  }
  return null;
}

// ── main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  loadEnv();
  const flags = parseFlags(process.argv.slice(2));

  // --new: just echo a fresh thread id and exit. No DB connection needed.
  if (flags.newThread && flags.prompt == null && flags.script == null) {
    console.log(randomUUID());
    return;
  }

  // --build-rag-index: one-shot index build, no chat.
  if (flags.buildRagIndex) {
    await runBuildRagIndex();
    return;
  }

  const { instance, postgres, modelId } = await buildInstance(flags.mode);
  const user = {
    userId: RESOURCE_ID,
    permissions: ["analytics:read"],
    dbRole: "arivie_reader",
  };

  try {
    if (flags.listThreads) {
      const mem = await memoryHandle(instance);
      if (mem == null) {
        console.error("[chat] memory backend does not expose listThreads");
        process.exit(1);
      }
      const result = await mem.listThreads({ resourceId: RESOURCE_ID });
      const threads = Array.isArray(result?.threads) ? result.threads : [];
      console.log(`threads for resource '${RESOURCE_ID}': ${threads.length}`);
      for (const t of threads) {
        const tt = t as { id?: string; title?: string; createdAt?: string };
        console.log(`  ${tt.id ?? "?"}\t${tt.title ?? ""}\t${tt.createdAt ?? ""}`);
      }
      return;
    }

    if (flags.deleteThread) {
      const mem = await memoryHandle(instance);
      if (mem == null) {
        console.error("[chat] memory backend does not expose deleteThread");
        process.exit(1);
      }
      await mem.deleteThread(flags.deleteThread);
      console.log(`deleted thread ${flags.deleteThread}`);
      return;
    }

    const threadId = flags.thread ?? randomUUID();
    console.log(`mode:   ${flags.mode}`);
    console.log(`model:  ${modelId}`);
    console.log(`thread: ${threadId}`);

    if (flags.script != null) {
      const lines = readFileSync(flags.script, "utf8")
        .split("\n")
        .map((s) => s.trim())
        .filter((s) => s !== "" && !s.startsWith("#"));
      for (let i = 0; i < lines.length; i++) {
        console.log(`\n══ turn ${i + 1}/${lines.length} ${"═".repeat(50)}`);
        console.log(`USER: ${lines[i]}`);
        await streamOneTurn(instance, user, lines[i] as string, threadId, flags.noStream);
      }
      return;
    }

    if (flags.prompt != null) {
      console.log(`USER:   ${flags.prompt}\n`);
      console.log("AGENT:");
      await streamOneTurn(instance, user, flags.prompt, threadId, flags.noStream);
      return;
    }

    console.error("[chat] no --prompt / --script / --list-threads / --delete / --new given. see --help.");
    process.exit(2);
  } finally {
    await postgres.sql.end({ timeout: 5 });
  }
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`\n[chat] ERROR: ${msg}`);
  if (err instanceof Error && err.stack != null) console.error(err.stack);
  process.exit(1);
});
