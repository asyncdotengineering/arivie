/* SPDX-License-Identifier: Apache-2.0 */
import assert from "node:assert/strict";
import type { RuntimeStorage } from "./types.js";

/**
 * Factory returning a FRESH, isolated {@link RuntimeStorage} each call. The
 * in-memory store returns `new InMemoryRuntimeStorage()`; the Postgres store
 * (C5) returns a store bound to a clean schema. Each section calls it so
 * sections do not share state.
 */
export type StorageFactory = () => RuntimeStorage | Promise<RuntimeStorage>;

/**
 * Run the full runtime-storage contract against a factory, throwing on the
 * first violated invariant (via `node:assert`). Shared verbatim by the
 * in-memory contract test (C4) and the Postgres contract test (C5) so both
 * back-ends prove identical behavior — including the no-double-claim invariant
 * the dispatch queue depends on (RFC §11 abort criteria).
 *
 * Framework-agnostic on purpose: no `vitest` import, so it ships in core's
 * bundle and is reusable cross-package. Wrap it in one `it(...)` per back-end.
 */
export async function assertStorageContract(make: StorageFactory): Promise<void> {
  await checkSessions(make);
  await checkRuns(make);
  await checkEvents(make);
  await checkDispatch(make);
  await checkDispatchNoDoubleClaim(make);
  await checkLeases(make);
}

async function checkSessions(make: StorageFactory): Promise<void> {
  const s = await make();
  const created = await s.sessions.create({ resource: "u1", userId: "u1" });
  assert.ok(created.id, "session.create assigns an id");
  const fetched = await s.sessions.get(created.id);
  assert.deepEqual(fetched, created, "session.get returns the created session");

  const explicit = await s.sessions.create({ id: "fixed", resource: "u1", userId: "u1" });
  const again = await s.sessions.create({ id: "fixed", resource: "u1", userId: "u1" });
  assert.equal(again.id, explicit.id, "create with explicit id is idempotent");
  assert.equal(await s.sessions.get("missing"), undefined, "get of missing id is undefined");
}

async function checkRuns(make: StorageFactory): Promise<void> {
  const s = await make();
  const session = await s.sessions.create({ resource: "u1", userId: "u1" });
  const run = await s.runs.create({ sessionId: session.id, agentId: "analyst", input: "q" });
  assert.equal(run.status, "queued", "new run is queued");
  assert.equal(run.input, "q", "run preserves input");

  const running = await s.runs.setStatus(run.id, "running");
  assert.equal(running.status, "running", "setStatus updates status");

  const done = await s.runs.complete(run.id, { text: "answer" });
  assert.equal(done.status, "completed", "complete sets status");
  assert.deepEqual(done.result, { text: "answer" }, "complete stores result");

  const run2 = await s.runs.create({ sessionId: session.id, agentId: "analyst" });
  const failed = await s.runs.fail(run2.id, { message: "boom", name: "Error" });
  assert.equal(failed.status, "failed", "fail sets status");
  assert.equal(failed.error?.message, "boom", "fail stores error");

  const list = await s.runs.listBySession(session.id);
  assert.equal(list.length, 2, "listBySession returns both runs");
}

async function checkEvents(make: StorageFactory): Promise<void> {
  const s = await make();
  const session = await s.sessions.create({ resource: "u1", userId: "u1" });
  const run = await s.runs.create({ sessionId: session.id, agentId: "analyst" });

  const e1 = await s.events.append(run.id, {
    type: "run.started",
    sessionId: session.id,
    payload: { agentId: "analyst" },
  });
  const e2 = await s.events.append(run.id, {
    type: "model.delta",
    sessionId: session.id,
    payload: { text: "hi" },
  });
  assert.ok(e1.cursor < e2.cursor, "cursors are monotonically increasing");
  assert.ok(e1.id, "append assigns an id");
  assert.ok(e1.timestamp, "append assigns a timestamp");

  const all = await s.events.readAfter(run.id, undefined, 100);
  assert.equal(all.length, 2, "readAfter(undefined) returns all events");

  const afterFirst = await s.events.readAfter(run.id, e1.cursor, 100);
  assert.equal(afterFirst.length, 1, "readAfter(cursor) excludes events at/before the cursor");
  assert.equal(afterFirst[0]!.cursor, e2.cursor, "readAfter returns only later events");

  const limited = await s.events.readAfter(run.id, undefined, 1);
  assert.equal(limited.length, 1, "readAfter respects limit");

  assert.equal(await s.events.latestCursor(run.id), e2.cursor, "latestCursor is the newest");
  assert.equal(await s.events.latestCursor("other"), undefined, "latestCursor of empty run is undefined");
}

async function checkDispatch(make: StorageFactory): Promise<void> {
  const s = await make();
  const t0 = 1_000_000;
  const admit1 = await s.dispatch.admit({ channel: "gh", event: { a: 1 }, dedupeKey: "k1", now: t0 });
  assert.equal(admit1.duplicate, false, "first admit is not a duplicate");

  const admit2 = await s.dispatch.admit({ channel: "gh", event: { a: 1 }, dedupeKey: "k1", now: t0 });
  assert.equal(admit2.duplicate, true, "second admit with same key is a duplicate");
  assert.equal(admit2.message.id, admit1.message.id, "duplicate admit returns the same message");

  const claimed = await s.dispatch.claimReady({ limit: 10, leaseMs: 60_000, workerId: "w1", now: t0 });
  assert.equal(claimed.length, 1, "claimReady claims the queued message");
  assert.equal(claimed[0]!.status, "claimed", "claimed message has claimed status");

  const reclaim = await s.dispatch.claimReady({ limit: 10, leaseMs: 60_000, workerId: "w2", now: t0 + 1_000 });
  assert.equal(reclaim.length, 0, "a live lease blocks reclaim by another worker");

  await s.dispatch.retryLater(admit1.message.id, { backoffMs: 30_000, error: "transient", now: t0 + 2_000 });
  const stillBackedOff = await s.dispatch.claimReady({ limit: 10, leaseMs: 60_000, workerId: "w1", now: t0 + 3_000 });
  assert.equal(stillBackedOff.length, 0, "retryLater keeps the message unavailable during backoff");

  const afterBackoff = await s.dispatch.claimReady({ limit: 10, leaseMs: 60_000, workerId: "w1", now: t0 + 40_000 });
  assert.equal(afterBackoff.length, 1, "message becomes claimable after backoff elapses");
  assert.equal(afterBackoff[0]!.attempts, 1, "retryLater increments attempts");

  await s.dispatch.complete(admit1.message.id);
  const completed = await s.dispatch.get(admit1.message.id);
  assert.equal(completed?.status, "completed", "complete marks message completed");

  const admitDl = await s.dispatch.admit({ channel: "gh", event: {}, dedupeKey: "k2", now: t0 + 40_000 });
  await s.dispatch.deadLetter(admitDl.message.id, "fatal");
  const dead = await s.dispatch.get(admitDl.message.id);
  assert.equal(dead?.status, "dead_letter", "deadLetter marks message dead_letter");
}

async function checkDispatchNoDoubleClaim(make: StorageFactory): Promise<void> {
  const s = await make();
  const t0 = 2_000_000;
  await s.dispatch.admit({ channel: "gh", event: {}, dedupeKey: "solo", now: t0 });
  // Two workers race for the single message; exactly one must win.
  const [a, b] = await Promise.all([
    s.dispatch.claimReady({ limit: 10, leaseMs: 60_000, workerId: "wA", now: t0 }),
    s.dispatch.claimReady({ limit: 10, leaseMs: 60_000, workerId: "wB", now: t0 }),
  ]);
  assert.equal(a.length + b.length, 1, "a deduped message is claimed by exactly one worker");
}

async function checkLeases(make: StorageFactory): Promise<void> {
  const s = await make();
  const t0 = 3_000_000;
  const lease = await s.leases.acquire("run:1", { holder: "w1", ttlMs: 60_000, now: t0 });
  assert.ok(lease, "acquire returns a lease when free");

  const blocked = await s.leases.acquire("run:1", { holder: "w2", ttlMs: 60_000, now: t0 + 1_000 });
  assert.equal(blocked, null, "a live lease blocks another holder");

  const afterExpiry = await s.leases.acquire("run:1", { holder: "w2", ttlMs: 60_000, now: t0 + 61_000 });
  assert.ok(afterExpiry, "an expired lease can be re-acquired");

  await s.leases.release(afterExpiry!);
  const reacquired = await s.leases.acquire("run:1", { holder: "w3", ttlMs: 60_000, now: t0 + 62_000 });
  assert.ok(reacquired, "a released lease can be re-acquired");
}
