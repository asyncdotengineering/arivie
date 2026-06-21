/* SPDX-License-Identifier: Apache-2.0 */
import type { EventInput, Lease, RunError, RuntimeStorage } from "../storage/types.js";
import type { AgentExecutor, ResolvedAgent, CreateSessionInput } from "./types.js";
import type { RunRecord, SessionRecord } from "../storage/types.js";

function toRunError(err: unknown): RunError {
  if (err instanceof Error) {
    return {
      message: err.message,
      name: err.name,
      ...("code" in err && typeof err.code === "string" ? { code: err.code } : {}),
    };
  }
  return { message: String(err) };
}

export interface ExecuteRunArgs {
  storage: RuntimeStorage;
  executor: AgentExecutor;
  run: RunRecord;
  session: SessionRecord;
  agent: ResolvedAgent;
  input: CreateSessionInput;
  lease: Lease;
}

/**
 * Execute one run to completion (RFC §6.3). Sets status running, drives the
 * executor (which emits intermediate events), then emits the terminal event
 * and flips status. The terminal event is appended BEFORE the status flip so
 * `streamEvents` always delivers it before closing. Always releases the lease.
 */
export async function executeRun(args: ExecuteRunArgs): Promise<void> {
  const { storage, executor, run, session, agent, input, lease } = args;
  const controller = new AbortController();
  const emit = (event: EventInput) => storage.events.append(run.id, event);

  try {
    await storage.runs.setStatus(run.id, "running");
    const result = await executor({
      run,
      session,
      agent,
      input,
      emit,
      signal: controller.signal,
    });
    await emit({
      type: "run.completed",
      sessionId: session.id,
      payload: { ...(result.text !== undefined ? { text: result.text } : {}) },
    });
    await storage.runs.complete(run.id, result);
  } catch (err) {
    const error = toRunError(err);
    await emit({ type: "run.failed", sessionId: session.id, payload: { error } });
    await storage.runs.fail(run.id, error);
  } finally {
    await storage.leases.release(lease);
  }
}
