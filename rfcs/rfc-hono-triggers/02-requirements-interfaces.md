---
rfc: hono-triggers
part: 02-requirements-interfaces
---

# 3. Strict Requirements

- REQ-1: Arivie exposes a Hono sub-app factory `arivie()` from `@arivie/core/server` that mounts Mastra's REST API plus Arivie-owned trigger/channel routes.
- REQ-2: The existing `ArivieInstance.handler` and `ArivieInstance.hono` continue to work for the single-agent chat path; the new server layer is additive.
- REQ-3: Users can author an optional `app.ts` that exports a Hono app and mounts `arivie()` explicitly, mirroring Flue's pattern.
- REQ-4: `defineTrigger` declares an event source (routes, verification, event parsing). `defineChannel` is a named configured trigger. `defineSubscription` wires trigger events to agents, workflows, or skills.
- REQ-5: Trigger events carry a normalized envelope `{ type, payload, metadata }` with provider-native types preserved in `payload`.
- REQ-6: Channel routes mount at `/channels/:name/:suffix` under the Arivie prefix. Generic webhook triggers mount at `/triggers/:name/:suffix` using the same machinery.
- REQ-7: Subscriptions resolve a target agent/workflow instance id from the event (e.g., thread id, issue id, custom key) so consecutive events continue the same Mastra Memory thread.
- REQ-8: Trigger verification (signature checks, handshakes) runs inside the trigger/channel implementation, not in Arivie core.
- REQ-9: The CLI gains `arivie build --target node` and `arivie build --target cloudflare`.
- REQ-10: The Node target bundles to `dist/server.mjs` and runs with `@hono/node-server`, externalizing dependencies.
- REQ-11: The Cloudflare target bundles to a Worker artifact using `@cloudflare/vite-plugin` and preserves Mastra's Durable Object / storage expectations where applicable.
- REQ-12: Schedules remain Mastra scheduled workflows; no new scheduler daemon is introduced.
- REQ-13: Every new public function and route has failing-to-passing tests; TDD is the default implementation mode.

---

# 4. Interface Specification

## 4.1 `TriggerEvent` — normalized event envelope

- **Location:** `packages/core/src/triggers/types.ts`
- **Signature:**
  ```ts
  export interface TriggerEvent<TType extends string = string, TPayload = unknown> {
    type: TType;
    payload: TPayload;
    metadata: {
      provider: string;
      deliveryId?: string;
      conversationKey?: string;
      rawRequest?: Request;
    };
  }
  ```
- **Behavior:** All inbound events are normalized to this shape before subscriptions see them. `conversationKey` is used to continue a Mastra Memory thread.
- **Error cases:** malformed payloads are rejected with a 400 response by the trigger handler before `emit` is called.

## 4.2 `TriggerContext` — what a trigger route handler receives

- **Location:** `packages/core/src/triggers/types.ts`
- **Signature:**
  ```ts
  export interface TriggerContext {
    c: Context;                         // Hono context
    emit(event: TriggerEvent): Promise<void>;
    config: unknown;
  }
  ```
- **Behavior:** `emit` runs verification, matches subscriptions, and dispatches to targets. Handlers return a Hono `Response` (or `void` for empty 200).

## 4.3 `TriggerDefinition` — how a provider package declares its surface

- **Location:** `packages/core/src/triggers/types.ts`
- **Signature:**
  ```ts
  export interface TriggerDefinition<TConfig, TEvents extends TriggerEvent> {
    id: string;
    configSchema: StandardSchema<TConfig>;
    routes: Array<{
      method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'ALL';
      path: string;   // e.g. '/events', '/webhook'
      handler(ctx: TriggerContext<TConfig, TEvents>): Promise<Response | void>;
    }>;
  }
  ```
- **Behavior:** Defines one or more HTTP surfaces and the config required to initialize them.

## 4.4 `defineTrigger`

- **Location:** `packages/core/src/triggers/define.ts`
- **Signature:**
  ```ts
  export function defineTrigger<TConfig, TEvents extends TriggerEvent>(
    definition: TriggerDefinition<TConfig, TEvents>,
  ): TriggerDefinition<TConfig, TEvents>;
  ```
- **Behavior:** Validates and freezes a trigger definition. No runtime state; pure factory.

## 4.5 `defineChannel`

- **Location:** `packages/core/src/triggers/channel.ts`
- **Signature:**
  ```ts
  export interface ChannelDefinition<TConfig, TEvents extends TriggerEvent> {
    name: string;
    trigger: TriggerDefinition<TConfig, TEvents>;
    config: TConfig;
  }

  export function defineChannel<TConfig, TEvents extends TriggerEvent>(
    channel: ChannelDefinition<TConfig, TEvents>,
  ): ChannelDefinition<TConfig, TEvents>;
  ```
- **Behavior:** A named, configured trigger. The name becomes the URL namespace (`/channels/:name/...`).

## 4.6 `defineSubscription`

- **Location:** `packages/core/src/triggers/subscription.ts`
- **Signature:**
  ```ts
  export interface SubscriptionTarget {
    kind: 'agent' | 'workflow' | 'skill';
    id: string;
    instanceId?: string | ((event: TriggerEvent) => string);
    input?: Record<string, unknown> | ((event: TriggerEvent) => Record<string, unknown>);
  }

  export interface SubscriptionDefinition<TEvent extends TriggerEvent> {
    source: ChannelDefinition<unknown, TEvent> | TriggerDefinition<unknown, TEvent>;
    filter?: (event: TriggerEvent) => boolean;
    target: SubscriptionTarget;
  }

  export function defineSubscription<TEvent extends TriggerEvent>(
    subscription: SubscriptionDefinition<TEvent>,
  ): SubscriptionDefinition<TEvent>;
  ```
- **Behavior:** Registers a listener. When the source emits an event passing `filter`, the subscription resolves `target` and dispatches.

## 4.7 `arivie()` server factory

- **Location:** `packages/core/src/server/index.ts`
- **Signature:**
  ```ts
  export interface ArivieServerOptions {
    instance: ArivieInstance;
    channels?: ChannelDefinition<unknown, TriggerEvent>[];
    subscriptions?: SubscriptionDefinition<TriggerEvent>[];
    prefix?: string;
  }

  export function arivie(options: ArivieServerOptions): Hono;
  ```
- **Behavior:** Returns a Hono sub-app with:
  - Mastra agent/workflow routes via `MastraServer` under `/agents`, `/workflows`, `/runs`, etc.
  - Arivie channel routes under `/channels/:name/:suffix`
  - Arivie generic trigger routes under `/triggers/:name/:suffix`
- **Error cases:** Throws if `instance.mastra` is missing; 404 for unknown channels/triggers; 405 for wrong method.

## 4.8 `createArivieServer` — higher-level wrapper

- **Location:** `packages/core/src/server/index.ts`
- **Signature:**
  ```ts
  export async function createArivieServer(
    config: ArivieConfig,
    options?: Omit<ArivieServerOptions, 'instance'>,
  ): Promise<{ instance: ArivieInstance; app: Hono }>;
  ```
- **Behavior:** Calls `defineArivie(config)`, discovers `channels/` and `subscriptions/` from the project root, and returns both the instance and the composed Hono app.

## 4.9 `ArivieInstance` additions

- **Location:** `packages/core/src/types.ts`
- **Signature:** Add to `ArivieInstance`:
  ```ts
  /** Mountable Hono sub-app with Mastra + Arivie routes. */
  app: Hono;
  ```
- Keep `handler` and `hono` for backward compatibility; `handler` becomes `app.fetch` and `hono` remains the legacy single-agent passthrough.

## 4.10 CLI `build` command

- **Location:** `packages/cli/src/commands/build.ts`
- **Signature:**
  ```ts
  export const buildCommand = defineCommand({
    meta: { name: 'build', description: 'Build Arivie project for a target' },
    args: {
      target: { type: 'string', required: true, description: 'node | cloudflare' },
      output: { type: 'string', default: './dist' },
    },
    async run({ args }) { ... },
  });
  ```
- **Behavior:** Discovers modules, generates a target-specific entry, and bundles with Vite.

## 4.11 `BuildPlugin` interface

- **Location:** `packages/cli/src/lib/build/types.ts`
- **Signature:**
  ```ts
  export interface BuildPlugin {
    name: string;
    bundle: 'vite' | 'vite-cloudflare';
    generateEntryPoint(ctx: BuildContext): string | Promise<string>;
    external?: string[];
    entryFilename?: string;
    viteInputs?(ctx: BuildContext): ViteCloudflareInputs;
    additionalOutputs?(ctx: BuildContext): Record<string, string>;
  }
  ```
