/* SPDX-License-Identifier: Apache-2.0 */
import { ArivieConfigError } from "../errors.js";
import type {
  PluginDefinition,
  PluginFactory,
  PluginInstance,
} from "./types.js";

/** Plugin ids are lowercase slugs: `analytics`, `plugin-postgres`. */
const PLUGIN_ID_RE = /^[a-z0-9][a-z0-9-]*$/;

/** Official semver.org grammar (no leading `v`). */
const SEMVER_RE =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;

/**
 * Validate a plugin definition's static shape. Throws {@link ArivieConfigError}
 * with an actionable message. Called by {@link definePlugin} so misconfiguration
 * fails at module load, not at runtime (RFC §4.2 error cases).
 */
export function validatePluginDefinition(
  definition: PluginDefinition<unknown>,
): void {
  const id = definition.id;
  if (typeof id !== "string" || !PLUGIN_ID_RE.test(id)) {
    throw new ArivieConfigError(
      `Invalid plugin id ${JSON.stringify(id)}: must be a lowercase slug matching ${PLUGIN_ID_RE}`,
    );
  }

  if (typeof definition.version !== "string" || !SEMVER_RE.test(definition.version)) {
    throw new ArivieConfigError(
      `Plugin "${id}" has invalid version ${JSON.stringify(definition.version)}: must be valid semver`,
    );
  }

  // Permissions: well-formed and unique.
  const declaredPermissions = new Set<string>();
  for (const perm of definition.permissions ?? []) {
    if (typeof perm.id !== "string" || perm.id.length === 0) {
      throw new ArivieConfigError(
        `Plugin "${id}" declares a permission with an empty id`,
      );
    }
    if (typeof perm.description !== "string" || perm.description.length === 0) {
      throw new ArivieConfigError(
        `Plugin "${id}" permission "${perm.id}" must have a non-empty description`,
      );
    }
    if (declaredPermissions.has(perm.id)) {
      throw new ArivieConfigError(
        `Plugin "${id}" declares duplicate permission "${perm.id}"`,
      );
    }
    declaredPermissions.add(perm.id);
  }

  // Capabilities: well-formed, unique, and every requiredPermission is declared.
  const capabilityIds = new Set<string>();
  for (const cap of definition.capabilities ?? []) {
    if (typeof cap.id !== "string" || cap.id.length === 0) {
      throw new ArivieConfigError(
        `Plugin "${id}" declares a capability with an empty id`,
      );
    }
    if (capabilityIds.has(cap.id)) {
      throw new ArivieConfigError(
        `Plugin "${id}" declares duplicate capability "${cap.id}"`,
      );
    }
    capabilityIds.add(cap.id);
    if (typeof cap.title !== "string" || cap.title.length === 0) {
      throw new ArivieConfigError(
        `Plugin "${id}" capability "${cap.id}" must have a non-empty title`,
      );
    }
    if (typeof cap.description !== "string" || cap.description.length === 0) {
      throw new ArivieConfigError(
        `Plugin "${id}" capability "${cap.id}" must have a non-empty description`,
      );
    }
    for (const required of cap.requiredPermissions ?? []) {
      if (!declaredPermissions.has(required)) {
        throw new ArivieConfigError(
          `Plugin "${id}" capability "${cap.id}" requires undeclared permission "${required}". ` +
            `Add it to the plugin's permissions before use (RFC §10.1, REQ-11).`,
        );
      }
    }
  }

  // Context schemas: well-formed and unique within the plugin.
  const contextSchemaIds = new Set<string>();
  for (const schema of definition.contextSchemas ?? []) {
    if (typeof schema.id !== "string" || schema.id.length === 0) {
      throw new ArivieConfigError(
        `Plugin "${id}" declares a context schema with an empty id`,
      );
    }
    if (contextSchemaIds.has(schema.id)) {
      throw new ArivieConfigError(
        `Plugin "${id}" declares duplicate context schema "${schema.id}"`,
      );
    }
    contextSchemaIds.add(schema.id);
    if (schema.kind === "executable" && schema.schema === undefined) {
      throw new ArivieConfigError(
        `Plugin "${id}" executable context schema "${schema.id}" must provide a validation schema`,
      );
    }
  }

  // Blueprints: well-formed and unique within the plugin.
  const blueprintIds = new Set<string>();
  for (const blueprint of definition.blueprints ?? []) {
    if (typeof blueprint.id !== "string" || blueprint.id.length === 0) {
      throw new ArivieConfigError(
        `Plugin "${id}" declares a blueprint with an empty id`,
      );
    }
    if (blueprintIds.has(blueprint.id)) {
      throw new ArivieConfigError(
        `Plugin "${id}" declares duplicate blueprint "${blueprint.id}"`,
      );
    }
    blueprintIds.add(blueprint.id);
    if (typeof blueprint.version !== "string" || !SEMVER_RE.test(blueprint.version)) {
      throw new ArivieConfigError(
        `Plugin "${id}" blueprint "${blueprint.id}" has invalid version ${JSON.stringify(blueprint.version)}`,
      );
    }
  }
}

/**
 * Define a versioned plugin (RFC §4.2, §7.2). Validates the definition's
 * static shape up front, then returns a factory that binds config to the
 * definition. The resulting {@link PluginInstance} is consumed by
 * `defineArivie` (C7).
 */
export function definePlugin<TConfig = unknown>(
  definition: PluginDefinition<TConfig>,
): PluginFactory<TConfig> {
  validatePluginDefinition(definition as PluginDefinition<unknown>);
  return (config: TConfig): PluginInstance<TConfig> => ({ definition, config });
}
