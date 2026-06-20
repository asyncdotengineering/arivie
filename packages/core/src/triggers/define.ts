/* SPDX-License-Identifier: Apache-2.0 */
import type { TriggerDefinition, TriggerEvent, TriggerMethod } from "./types.js";

const VALID_METHODS = new Set<TriggerMethod>(["GET", "POST", "PUT", "DELETE", "ALL"]);

export function defineTrigger<TConfig, TEvents extends TriggerEvent>(
  definition: TriggerDefinition<TConfig, TEvents>,
): TriggerDefinition<TConfig, TEvents> {
  if (!definition.id || typeof definition.id !== "string") {
    throw new Error("Trigger id must be a non-empty string");
  }
  if (!Array.isArray(definition.routes) || definition.routes.length === 0) {
    throw new Error(`Trigger "${definition.id}" must define at least one route`);
  }

  for (const route of definition.routes) {
    if (!route.path.startsWith("/")) {
      throw new Error(
        `Trigger "${definition.id}" route path must start with "/": ${route.path}`,
      );
    }
    if (!VALID_METHODS.has(route.method)) {
      throw new Error(
        `Trigger "${definition.id}" route has invalid method: ${route.method}`,
      );
    }
  }

  return definition;
}
