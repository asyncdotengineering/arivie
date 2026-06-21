/* SPDX-License-Identifier: Apache-2.0 */
import type { StandardSchemaV1 } from "@standard-schema/spec";
import { ArivieConfigError } from "../errors.js";
import type { PluginInstance } from "./types.js";

/**
 * Run a Standard Schema validator and return the parsed value, or throw
 * {@link ArivieConfigError} with the collected issues. Handles sync and async
 * validators. Standard Schema is the framework's config validation boundary
 * (RFC §5.2), so plugins validate their own config the same way the app does.
 */
export async function validateStandardSchema<T>(
  schema: StandardSchemaV1<T>,
  value: unknown,
  context: string,
): Promise<T> {
  let result = schema["~standard"].validate(value);
  if (result instanceof Promise) result = await result;
  if (result.issues) {
    const messages = result.issues
      .map((issue) => {
        const path = issue.path
          ?.map((p) => (typeof p === "object" ? p.key : p))
          .join(".");
        return path ? `${path}: ${issue.message}` : issue.message;
      })
      .join("; ");
    throw new ArivieConfigError(`${context}: ${messages}`);
  }
  return result.value;
}

/**
 * Assert that every plugin instance has a distinct id. Duplicate plugin ids
 * are a fatal config error (RFC §4.1 error cases); the manifest builder (C2)
 * also re-checks across the merged contribution surface.
 */
export function assertUniquePluginIds(
  instances: readonly PluginInstance[],
): void {
  const seen = new Set<string>();
  for (const instance of instances) {
    const id = instance.definition.id;
    if (seen.has(id)) {
      throw new ArivieConfigError(`Duplicate plugin id "${id}" in app config`);
    }
    seen.add(id);
  }
}

/**
 * Validate a plugin instance's config against its `configSchema` (when
 * declared) and return the instance with parsed config. Plugins without a
 * schema pass their config through unchanged.
 */
export async function parsePluginConfig<TConfig>(
  instance: PluginInstance<TConfig>,
): Promise<PluginInstance<TConfig>> {
  const { definition, config } = instance;
  if (definition.configSchema === undefined) return instance;
  const parsed = await validateStandardSchema(
    definition.configSchema,
    config,
    `Invalid config for plugin "${definition.id}"`,
  );
  return { definition, config: parsed };
}
