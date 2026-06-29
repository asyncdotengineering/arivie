/* SPDX-License-Identifier: Apache-2.0 */
import type { Agent } from "@mastra/core/agent";
import { runWithUserContext } from "../context.js";
import { ArivieConfigError } from "../errors.js";
import type { UserContext as OwnerUserContext } from "../types.js";
import { temporalGrounding } from "./temporal-grounding.js";
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

function str(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

/**
 * The Mastra adapter for the runtime executor seam (RFC §6.3). Given the built
 * Mastra agents, returns an {@link AgentExecutor} that, per run: resolves the
 * Mastra agent, sets the owner-boundary user context (so source tools'
 * `getCurrentUserContext()` resolves), and STREAMS `agent.stream(...).fullStream`
 * — translating Mastra chunks into structured runtime events as they arrive:
 * `text-delta` → `model.delta`, `tool-call` → `tool.call.started`,
 * `tool-result` → `tool.call.completed`. The terminal text comes from
 * `stream.text`. Conversation continuity is Mastra Memory's job (the runtime
 * Session IS the Mastra thread); our runtime layers the durable event/run
 * protocol on top — complementary, not competing.
 */
export function createMastraExecutor(options: MastraExecutorOptions): AgentExecutor {
  return async (ctx: RunContext): Promise<AgentTurnResult> => {
    const agent = options.agents[ctx.agent.id];
    if (agent === undefined) {
      throw new ArivieConfigError(
        `No Mastra agent registered for "${ctx.agent.id}"`,
      );
    }
    const userTurn = ctx.input.prompt ?? "";
    const ownerUser = toOwnerUser(ctx.input.user);
    const sessionId = ctx.session.id;
    const now = new Date();
    const temporal = temporalGrounding(now);
    const runPrompt =
      userTurn.length > 0 ? `${temporal}\n\n${userTurn}` : temporal;

    return runWithUserContext(ownerUser, async () => {
      const stream = await agent.stream(runPrompt, {
        memory: { thread: sessionId, resource: ctx.session.resource },
      });

      for await (const chunk of stream.fullStream) {
        const payload = asRecord((chunk as { payload?: unknown }).payload);
        switch ((chunk as { type?: string }).type) {
          case "text-delta":
            await ctx.emit({
              type: "model.delta",
              sessionId,
              payload: { text: str(payload.text) },
            });
            break;
          case "tool-call":
            await ctx.emit({
              type: "tool.call.started",
              sessionId,
              payload: {
                toolCallId: str(payload.toolCallId),
                tool: str(payload.toolName, "?"),
                args: asRecord(payload.args ?? payload.input),
              },
            });
            break;
          case "tool-result":
            await ctx.emit({
              type: "tool.call.completed",
              sessionId,
              payload: {
                toolCallId: str(payload.toolCallId),
                tool: str(payload.toolName, "?"),
                output: payload.result ?? payload.output ?? {},
              },
            });
            break;
          default:
            break;
        }
      }

      const text = await stream.text;
      return { text: str(text) };
    });
  };
}
