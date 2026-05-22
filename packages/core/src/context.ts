/* SPDX-License-Identifier: Apache-2.0 */
import { AsyncLocalStorage } from "node:async_hooks";
import type { UserContext } from "./types.js";

const userContextStorage = new AsyncLocalStorage<UserContext>();

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
