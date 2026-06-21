/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Singleton defineArivie() — cached across hot-reloads in dev, single
 * boot in production. Exposes the Arivie agent + its embedded Mastra
 * instance for `handleChatStream`.
 *
 * Auto-picks a model from environment:
 *   GOOGLE_GENERATIVE_AI_API_KEY → gemini-2.5-flash (recommended for the
 *                                  starter — fastest, cheapest, works well
 *                                  with Arivie's semantic-layer-grounded
 *                                  text-to-SQL flow)
 *   OPENAI_API_KEY               → gpt-5-mini
 *   XAI_API_KEY                  → grok-4.20-non-reasoning
 *
 * Override via MODEL_PROVIDER=google|openai|xai.
 */
import { resolve } from "node:path";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { createXai } from "@ai-sdk/xai";
import {
  type ArivieApp,
  type ArivieAppConfig,
  defineAgent,
  defineArivie,
} from "@arivie/core";
import { analytics } from "@arivie/plugin-analytics";
import { postgresRuntime, postgresSource } from "@arivie/plugin-postgres";
import type { LanguageModel } from "ai";

const SEMANTIC_PATH = resolve(process.cwd(), "semantic");

function resolveModel(): {
  model: LanguageModel;
  provider: string;
  id: string;
} {
  const force = process.env.MODEL_PROVIDER?.toLowerCase();
  const google = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  const openai = process.env.OPENAI_API_KEY;
  const xai = process.env.XAI_API_KEY;

  if (force === "google" || (force == null && google)) {
    if (!google)
      throw new Error(
        "MODEL_PROVIDER=google but GOOGLE_GENERATIVE_AI_API_KEY not set",
      );
    const provider = createGoogleGenerativeAI({ apiKey: google });
    const id = process.env.GOOGLE_MODEL ?? "gemini-2.5-flash";
    return { model: provider(id), provider: "google", id };
  }
  if (force === "openai" || (force == null && openai)) {
    if (!openai)
      throw new Error("MODEL_PROVIDER=openai but OPENAI_API_KEY not set");
    const provider = createOpenAI({ apiKey: openai });
    const id = process.env.OPENAI_MODEL ?? "gpt-5-mini";
    return { model: provider(id), provider: "openai", id };
  }
  if (force === "xai" || (force == null && xai)) {
    if (!xai) throw new Error("MODEL_PROVIDER=xai but XAI_API_KEY not set");
    const provider = createXai({ apiKey: xai });
    const id = process.env.XAI_MODEL ?? "grok-4.20-non-reasoning";
    return { model: provider(id), provider: "xai", id };
  }
  throw new Error(
    "No model key set. Add GOOGLE_GENERATIVE_AI_API_KEY (recommended) or OPENAI_API_KEY or XAI_API_KEY to .env.local",
  );
}

let cached: Promise<ArivieApp> | null = null;

/** Module-singleton ArivieApp. Survives Next.js hot reloads. */
export function getArivie(): Promise<ArivieApp> {
  if (cached) return cached;
  cached = (async () => {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
      throw new Error("DATABASE_URL not set");
    }

    const { model, provider, id } = resolveModel();
    // eslint-disable-next-line no-console
    console.log(`[arivie-chat] model: ${provider}/${id}`);

    const config: ArivieAppConfig = {
      app: {
        id: process.env.ARIVIE_OWNER_ID ?? "arivie-chat",
        name: process.env.ARIVIE_OWNER_NAME ?? "Arivie",
      },
      storage: postgresRuntime({ url: databaseUrl }),
      model,
      plugins: [
        analytics({
          semanticPath: SEMANTIC_PATH,
          mode: "preload",
          sources: {
            commerce: postgresSource({
              url: databaseUrl,
              readOnlyRole: process.env.ARIVIE_DB_ROLE ?? "arivie_reader",
            }),
          },
          compileMetric: true,
        }),
      ],
      agents: {
        analyst: defineAgent({
          instructions:
            "Answer commerce analytics questions with concise, SQL-backed evidence.",
          capabilities: ["analytics.query", "analytics.compile_metric"],
        }),
      },
      context: { root: SEMANTIC_PATH },
      resolveUser: async () => ({
        userId: "anonymous",
        permissions: ["analytics:read"],
        dbRole: process.env.ARIVIE_DB_ROLE ?? "arivie_reader",
      }),
    };
    return defineArivie(config);
  })();
  return cached;
}
