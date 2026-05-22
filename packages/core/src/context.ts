/* SPDX-License-Identifier: Apache-2.0 */
import { AsyncLocalStorage } from "node:async_hooks";
import type { UserContext } from "./types.js";

/**
 * Singleton AsyncLocalStorage pinned to `globalThis`.
 *
 * Why globalThis: under pnpm + tsx, `packages/core/src/context.ts` (loaded
 * via tsx from source when `define.ts` imports `./context.js` relatively)
 * and `packages/core/dist/context.js` (loaded by built downstream packages
 * like `@arivie/agent` via `@arivie/core/context`) can each end up as a
 * SEPARATE module instance. Two module instances → two
 * `new AsyncLocalStorage()` calls → `runWithUserContext` writes to one ALS
 * while `getCurrentUserContext` reads from the other → `undefined`.
 *
 * Pinning to a `Symbol.for(...)` slot on globalThis collapses both copies
 * to a single ALS instance regardless of how many times this module is
 * evaluated. The cost is one symbol-keyed global; the benefit is the
 * `instance.ask()` user-context contract holds in every mixed dev/built
 * loading mode (tsx-from-source, pnpm-symlinked dist, bundled bin).
 */
const ALS_SLOT = Symbol.for("arivie.userContextStorage");

type StorageHost = { [ALS_SLOT]?: AsyncLocalStorage<UserContext> };

function getOrCreateStorage(): AsyncLocalStorage<UserContext> {
  const host = globalThis as unknown as StorageHost;
  const existing = host[ALS_SLOT];
  if (existing !== undefined) return existing;
  const created = new AsyncLocalStorage<UserContext>();
  host[ALS_SLOT] = created;
  return created;
}

const userContextStorage = getOrCreateStorage();

export function setCurrentUserContext(user: UserContext): void {
  userContextStorage.enterWith(user);
}

export function getCurrentUserContext(): UserContext | undefined {
  return userContextStorage.getStore();
}

export function runWithUserContext<T>(
  user: UserContext,
  fn: () => T | Promise<T>,
): T | Promise<T> {
  return userContextStorage.run(user, fn);
}

export { userContextStorage };
