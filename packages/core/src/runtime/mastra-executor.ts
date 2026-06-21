/* SPDX-License-Identifier: Apache-2.0 */
import type { Agent } from "@mastra/core/agent";
import { runWithUserContext } from "../context.js";
import { ArivieConfigError } from "../errors.js";
import type { UserContext as OwnerUserContext } from "../types.js";
import type { EventInput } from "../storage/types.js";
import type {
  AgentExecutor,
  AgentTurnResult,
  RunContext,
  UserContext,
} from "./types.js";

export interface MastraExecutorOptions {
  /** Built Mastra agents keyed by the same id as the runtime AgentDefinition. */
  agents: Record<string, Agent>;
}

/** Map the runtime's user identity to the owner-boundary UserContext the tools read. */
function toOwnerUser(user: UserContext): OwnerUserContext {
  return {
    userId: user.userId,
    permissions: user.permissions ?? [],
    dbRole: user.dbRole ?? "",
    ...(user.raw !== undefined ? { raw: user.raw } : {}),
  };
}

function extractText(result: unknown): string {
  const record = result as { text?: unknown };
  return typeof record.text === "string" ? record.text : "";
}

/** Walk a Mastra generate() response, emitting tool-call events into the run stream. */
async function emitToolCalls(
  emit: (event: EventInput) => Promise<unknown>,
  result: unknown,
  sessionId: string,
): Promise<void> {
  const record = result as Record<string, unknown>;
  const response = record.response as { messages?: unknown[] } | undefined;
  const messages = Array.isArray(response?.messages) ? response.messages : [];
  for (const message of messages) {
    if (message === null || typeof message !== "object") continue;
    const content = (message as { content?: unknown }).content;
    const parts = Array.isArray(content) ? content : [];
    for (const part of parts) {
      if (part === null || typeof part !== "object") continue;
      const p = part as Record<string, unknown>;
      const type = String(p.type ?? "");
      if (type === "tool-call") {
        await emit({
          type: "tool.call.started",
          sessionId,
          payload: {
            toolCallId: String(p.toolCallId ?? ""),
            tool: String(p.toolName ?? "?"),
            args: (p.input ?? p.args ?? {}) as Record<string, unknown>,
          },
        });
      } else if (type === "tool-result") {
        await emit({
          type: "tool.call.completed",
          sessionId,
          payload: {
            toolCallId: String(p.toolCallId ?? ""),
            tool: String(p.toolName ?? "?"),
            output: p.output ?? p.result ?? {},
          },
        });
      }
    }
  }
}

/**
 * The Mastra adapter for the runtime executor seam (RFC §6.3). Given the built
 * Mastra agents, returns an {@link AgentExecutor} that, per run: resolves the
 * Mastra agent, sets the owner-boundary user context (so source tools'
 * `getCurrentUserContext()` resolves), runs `agent.generate` against the
 * session's memory thread, emits tool-call events, and returns the terminal
 * text. v1 is non-streaming — correct and simple; incremental `model.delta`
 * translation can layer on later without changing this contract.
 */
export function createMastraExecutor(options: MastraExecutorOptions): AgentExecutor {
  return async (ctx: RunContext): Promise<AgentTurnResult> => {
    const agent = options.agents[ctx.agent.id];
    if (agent === undefined) {
      throw new ArivieConfigError(
        `No Mastra agent registered for "${ctx.agent.id}"`,
      );
    }
    const prompt = ctx.input.prompt ?? "";
    const ownerUser = toOwnerUser(ctx.input.user);
    // Conversation continuity is Mastra Memory's job: the runtime Session IS
    // the Mastra thread, so multi-turn history persists through Mastra's
    // primitive. Our runtime layers the durable event/run protocol on top —
    // the two are complementary, not competing.
    const result = await runWithUserContext(ownerUser, () =>
      agent.generate(prompt, {
        memory: { thread: ctx.session.id, resource: ctx.session.resource },
      }),
    );
    await emitToolCalls(ctx.emit, result, ctx.session.id);
    return { text: extractText(result) };
  };
}
