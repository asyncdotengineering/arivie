/* SPDX-License-Identifier: Apache-2.0 */
import type { Agent } from "@mastra/core/agent";
import type { PostgresAdapter } from "@arivie/db-postgres";
import { ArivieBoundaryError } from "@arivie/db-postgres";
import { runWithUserContext } from "./context.js";
import { ArivieInternalError } from "./errors.js";
import type { ArivieConfig } from "./types.js";
import { isFatalBoundaryError, verifyOwnerIdentity } from "./verify.js";

export interface WebHandlerDeps {
  agent: Agent;
  db: PostgresAdapter;
  config: ArivieConfig;
  readOnlyRole?: string;
}

function boundaryErrorResponse(err: ArivieBoundaryError): Response {
  return Response.json(
    {
      error: err.code,
      message: err.message,
      detail: err.detail,
    },
    { status: 503 },
  );
}

function wantsEventStream(req: Request): boolean {
  const accept = req.headers.get("accept") ?? "";
  return accept.includes("text/event-stream");
}

function extractAnswerText(result: unknown): string {
  if (result == null || typeof result !== "object") {
    throw new ArivieInternalError("agent.generate returned an unexpected shape");
  }
  // Mastra's agent.generate() return type is loosely typed across stream/text
  // overloads; we narrow at runtime via the typeof check above before this cast.
  const record = result as Record<string, unknown>;
  if (typeof record.text === "string" && record.text.length > 0) {
    return record.text;
  }
  const response = record.response;
  if (response != null && typeof response === "object") {
    // Same as above — the response.messages array shape is dynamic across
    // Mastra versions; runtime-guarded with `typeof response === "object"`.
    const messages = (response as { messages?: unknown }).messages;
    if (Array.isArray(messages)) {
      for (let i = messages.length - 1; i >= 0; i -= 1) {
        const message = messages[i];
        if (message != null && typeof message === "object") {
          // Runtime-guarded `typeof message === "object"`; cast narrows to the
          // shape we care about (`content?`).
          const content = (message as { content?: unknown }).content;
          if (typeof content === "string" && content.length > 0) {
            return content;
          }
        }
      }
    }
  }
  throw new ArivieInternalError("agent.generate did not return text");
}

function sseEvent(data: string): string {
  return `data: ${data}\n\n`;
}

/**
 * Builds an SSE `Response` from a Mastra agent stream.
 *
 * Uses Mastra 1.35 {@link Agent.stream} → `MastraModelOutput.textStream` (not
 * `streamLegacy` or `RunOutput.toReadableStream`, which belong to older APIs).
 */
async function streamAgentAsSse(
  agent: Agent,
  messages: { role: string; content: string }[],
  memory: { thread: string; resource: string },
  abortSignal: AbortSignal,
): Promise<Response> {
  const streamResult = await agent.stream(messages, { memory, abortSignal });
  const encoder = new TextEncoder();

  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const push = (chunk: string) => {
        controller.enqueue(encoder.encode(chunk));
      };

      try {
        const reader = streamResult.textStream.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            break;
          }
          if (typeof value === "string" && value.length > 0) {
            push(sseEvent(value));
          }
        }

        push(sseEvent("[DONE]"));

        const finalPayload: Record<string, unknown> = {};
        const text = await streamResult.text;
        if (text.length > 0) {
          finalPayload.text = text;
        }
        const response = await streamResult.response;
        if (response != null) {
          finalPayload.response = response;
        }
        const toolResults = await streamResult.toolResults;
        if (toolResults.length > 0) {
          finalPayload.toolResults = toolResults;
          const executeResult = toolResults.find(
            (tr) =>
              tr != null &&
              typeof tr === "object" &&
              "toolName" in tr &&
              typeof (tr as { toolName?: string }).toolName === "string" &&
              (tr as { toolName: string }).toolName.startsWith("execute"),
          );
          if (executeResult != null && typeof executeResult === "object") {
            const result = (executeResult as { result?: unknown }).result;
            if (result != null && typeof result === "object") {
              const rowPayload = result as {
                rows?: unknown;
                rowCount?: unknown;
              };
              if (rowPayload.rows !== undefined) {
                finalPayload.rows = rowPayload.rows;
              }
              if (rowPayload.rowCount !== undefined) {
                finalPayload.rowCount = rowPayload.rowCount;
              }
            }
            const args = (executeResult as { args?: unknown }).args;
            if (args != null && typeof args === "object") {
              const sql = (args as { sql?: unknown }).sql;
              if (typeof sql === "string") {
                finalPayload.sql = sql;
              }
            }
          }
        }

        push(sseEvent(JSON.stringify(finalPayload)));
        controller.close();
      } catch (err) {
        controller.error(err);
      }
    },
  });

  return new Response(body, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

export function makeWebHandler(deps: WebHandlerDeps): (req: Request) => Promise<Response> {
  const readOnlyRole = deps.readOnlyRole ?? "arivie_reader";
  // [S1-fix-2 KI-1-06] Pi r2 M-r2-3: closure-captured lazy memoisation of the
  // owner-identity verification. Concurrency proof:
  //   - The `verifyPromise ??=` expression is a single synchronous statement.
  //     Node's event loop processes each request callback atomically up to the
  //     next await, so two requests arriving "simultaneously" still serialise
  //     here — whichever wins the synchronous race assigns the promise; the
  //     loser sees it already populated and reuses it.
  //   - The `.catch()` handler reassigns `verifyPromise = null` *before*
  //     re-throwing, so a non-fatal failure (transient DB blip) is retried on
  //     the next request without leaking the rejection forever.
  //   - Fatal boundary errors (KI-1-07) deliberately do NOT null the cache:
  //     misconfigured credentials should fail fast on every request, not flood
  //     the DB with repeat probes.
  // See test "verifyPromise is shared across concurrent first requests".
  let verifyPromise: Promise<void> | null = null;

  return async (req: Request): Promise<Response> => {
    verifyPromise ??= verifyOwnerIdentity(
      deps.db,
      deps.config.owner.id,
      readOnlyRole,
    ).catch((err: unknown) => {
      if (!isFatalBoundaryError(err)) {
        verifyPromise = null;
      }
      throw err;
    });

    try {
      await verifyPromise;
    } catch (err) {
      if (err instanceof ArivieBoundaryError) {
        return boundaryErrorResponse(err);
      }
      return new Response(null, { status: 503 });
    }

    let user;
    try {
      user = await deps.config.resolveUser(req);
    } catch (err) {
      const message = err instanceof Error ? err.message : "unauthorized";
      return Response.json({ error: "unauthorized", detail: message }, { status: 401 });
    }

    let body: { prompt?: string; messages?: { role: string; content: string }[]; threadId?: string };
    try {
      // `req.json()` returns `unknown`; we cast to the union we accept. The
      // optional fields are guarded individually below before use.
      body = (await req.json()) as typeof body;
    } catch {
      return Response.json({ error: "invalid JSON body" }, { status: 400 });
    }

    const prompt =
      body.prompt ??
      body.messages?.at(-1)?.content;
    if (!prompt) {
      return Response.json({ error: "prompt or messages required" }, { status: 400 });
    }

    const messages =
      body.messages ?? [{ role: "user" as const, content: prompt }];
    const memory = {
      thread: body.threadId ?? `arivie-${user.userId}`,
      resource: user.userId,
    };
    const streamRequested = wantsEventStream(req);

    try {
      // [S1-fix-2 KI-1-10] Pi r2 M-r2-5: forward the request abort signal so a
      // disconnected client cancels the upstream LLM call instead of running
      // the model to completion and discarding the result.
      if (streamRequested) {
        return await runWithUserContext(user, () =>
          streamAgentAsSse(deps.agent, messages, memory, req.signal),
        );
      }

      const answer = await runWithUserContext(user, async () => {
        const result = await deps.agent.generate(messages, {
          memory,
          abortSignal: req.signal,
        });
        return extractAnswerText(result);
      });

      return Response.json({ answer });
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      await deps.config.hooks?.onError?.({
        error,
        ctx: { userId: user.userId, ownerId: deps.config.owner.id, prompt },
      });
      return Response.json(
        {
          error: "ARIVIE_INTERNAL_ERROR",
          message: error.message,
        },
        { status: 500 },
      );
    }
  };
}
