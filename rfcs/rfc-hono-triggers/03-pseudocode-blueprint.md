---
rfc: hono-triggers
part: 03-pseudocode-blueprint
---

# 6. Pseudocode

## 6.1 Trigger route dispatch

```
FUNCTION handleChannelRequest(honoContext, runtimeConfig):
    name = path parameter "name"
    suffix = path parameter "suffix" or "/"
    channel = runtimeConfig.channels[name]
    IF channel is missing:
        RETURN 404

    routeKey = "{METHOD} {suffix}"
    handler = channel.routes[routeKey]
    IF handler is missing:
        allowed = channel.routes whose suffix matches
        IF allowed is non-empty:
            RETURN 405 with allowed methods
        RETURN 404

    triggerContext = {
        c: honoContext,
        config: channel.config,
        emit: (event) => dispatchEvent(event, channel, runtimeConfig.subscriptions),
    }

    response = await handler(triggerContext)
    IF response is missing:
        THROW "channel handler must return a Response"
    RETURN response
```

## 6.2 Subscription dispatch

```
FUNCTION dispatchEvent(event, channel, subscriptions):
    FOR subscription IN subscriptions WHERE subscription.source matches channel:
        IF subscription.filter exists AND NOT subscription.filter(event):
            CONTINUE

        target = resolveTarget(subscription.target, event)
        IF target.kind is "agent":
            instance = mastra.getAgent(target.id)
            instance.generate(target.input, {
                memory: { thread: target.instanceId, resource: target.instanceId },
            })
        ELSE IF target.kind is "workflow":
            workflow = mastra.getWorkflow(target.id)
            run = workflow.createRun()
            run.start({ inputData: target.input })
        ELSE IF target.kind is "skill":
            executeSkill(target.id, target.input)
```

## 6.3 Server composition

```
FUNCTION arivie(options):
    app = new Hono()
    mastraServer = new MastraServer({ app, mastra: options.instance.mastra })
    mastraServer.init()

    // Arivie channels and triggers mount after Mastra routes so prefixes don't collide.
    app.all("/channels/:name", channelRouteHandler)
    app.all("/channels/:name/:suffix{.+}", channelRouteHandler)
    app.all("/triggers/:name", triggerRouteHandler)
    app.all("/triggers/:name/:suffix{.+}", triggerRouteHandler)

    RETURN app
```

## 6.4 Node build entry generation

```
FUNCTION generateNodeEntry(agents, workflows, channels, subscriptions, appEntry):
    code = "import { serve } from '@hono/node-server';"
    code += imports for every discovered module
    code += "const instance = await defineArivie(config);"
    code += "const app = appEntry ? userApp : new Hono();"
    code += "app.route('/', arivie({ instance, channels, subscriptions }));"
    code += "serve({ fetch: app.fetch, port: process.env.PORT ?? 3000 });"
    RETURN code
```

---

# 7. Code Blueprint

## 7.1 Trigger types and factory

```ts
// packages/core/src/triggers/types.ts
import type { Context } from 'hono';
import type { StandardSchemaV1 } from '@standard-schema/spec';

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

export interface TriggerContext<TConfig = unknown, TEvents extends TriggerEvent = TriggerEvent> {
  c: Context;
  config: TConfig;
  emit(event: TEvents): Promise<void>;
}

export interface TriggerRoute<TEvents extends TriggerEvent> {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'ALL';
  path: string;
  handler(ctx: TriggerContext<unknown, TEvents>): Promise<Response | void> | Response | void;
}

export interface TriggerDefinition<TConfig, TEvents extends TriggerEvent> {
  id: string;
  configSchema: StandardSchemaV1<TConfig>;
  routes: TriggerRoute<TEvents>[];
}
```

```ts
// packages/core/src/triggers/define.ts
import type { TriggerDefinition, TriggerEvent } from './types.js';

export function defineTrigger<TConfig, TEvents extends TriggerEvent>(
  definition: TriggerDefinition<TConfig, TEvents>,
): TriggerDefinition<TConfig, TEvents> {
  // Validation: every route path starts with "/", method is valid.
  for (const route of definition.routes) {
    if (!route.path.startsWith('/')) {
      throw new Error(`Trigger "${definition.id}" route path must start with "/": ${route.path}`);
    }
  }
  return definition;
}
```

## 7.2 Channel and subscription factories

```ts
// packages/core/src/triggers/channel.ts
import type { TriggerDefinition, TriggerEvent } from './types.js';

export interface ChannelDefinition<TConfig, TEvents extends TriggerEvent> {
  name: string;
  trigger: TriggerDefinition<TConfig, TEvents>;
  config: TConfig;
}

export function defineChannel<TConfig, TEvents extends TriggerEvent>(
  channel: ChannelDefinition<TConfig, TEvents>,
): ChannelDefinition<TConfig, TEvents> {
  if (!channel.name || channel.name.includes('/')) {
    throw new Error(`Channel name must be non-empty and not contain "/": ${channel.name}`);
  }
  return channel;
}
```

```ts
// packages/core/src/triggers/subscription.ts
import type { TriggerEvent } from './types.js';
import type { ChannelDefinition } from './channel.js';

export interface SubscriptionTarget {
  kind: 'agent' | 'workflow' | 'skill';
  id: string;
  instanceId?: string | ((event: TriggerEvent) => string);
  input?: Record<string, unknown> | ((event: TriggerEvent) => Record<string, unknown>);
}

export interface SubscriptionDefinition<TEvent extends TriggerEvent = TriggerEvent> {
  source: ChannelDefinition<unknown, TEvent> | string; // string = channel/trigger name
  filter?: (event: TEvent) => boolean;
  target: SubscriptionTarget;
}

export function defineSubscription<TEvent extends TriggerEvent>(
  subscription: SubscriptionDefinition<TEvent>,
): SubscriptionDefinition<TEvent> {
  return subscription;
}
```

## 7.3 Server factory

```ts
// packages/core/src/server/index.ts
import { Hono } from 'hono';
import { MastraServer } from '@mastra/hono';
import type { ArivieInstance } from '../types.js';
import type { ChannelDefinition, SubscriptionDefinition, TriggerEvent } from '../triggers/index.js';

export interface ArivieServerOptions {
  instance: ArivieInstance;
  channels?: ChannelDefinition<unknown, TriggerEvent>[];
  subscriptions?: SubscriptionDefinition<TriggerEvent>[];
}

export function arivie(options: ArivieServerOptions): Hono {
  const app = new Hono();
  const server = new MastraServer({ app, mastra: options.instance.mastra });
  server.init();

  const channels = normalizeChannels(options.channels ?? []);
  const subscriptions = options.subscriptions ?? [];

  app.all('/channels/:name', channelRouteHandler({ channels, subscriptions, instance: options.instance }));
  app.all('/channels/:name/:suffix{.+}', channelRouteHandler({ channels, subscriptions, instance: options.instance }));
  app.all('/triggers/:name', triggerRouteHandler({ channels, subscriptions, instance: options.instance }));
  app.all('/triggers/:name/:suffix{.+}', triggerRouteHandler({ channels, subscriptions, instance: options.instance }));

  return app;
}
```

## 7.4 Channel route handler

```ts
// packages/core/src/server/channel-route.ts
import type { Context } from 'hono';
import type { ChannelDefinition, SubscriptionDefinition, TriggerEvent } from '../triggers/index.js';
import type { ArivieInstance } from '../types.js';

interface RouteContext {
  channels: Map<string, ChannelDefinition<unknown, TriggerEvent>>;
  subscriptions: SubscriptionDefinition<TriggerEvent>[];
  instance: ArivieInstance;
}

export function channelRouteHandler(ctx: RouteContext) {
  return async (c: Context) => {
    const name = c.req.param('name') ?? '';
    const suffix = c.req.param('suffix') ?? '';
    const channel = ctx.channels.get(name);
    if (!channel) {
      return c.json({ error: 'channel_not_found' }, 404);
    }

    const routeKey = `${c.req.method} ${suffix.length > 0 ? `/${suffix}` : '/'}`;
    const route = channel.trigger.routes.find(
      (r) => `${r.method} ${r.path}` === routeKey,
    );
    if (!route) {
      const allowed = channel.trigger.routes
        .filter((r) => r.path === (suffix.length > 0 ? `/${suffix}` : '/'))
        .map((r) => r.method);
      if (allowed.length > 0) {
        c.header('Allow', allowed.join(', '));
        return c.json({ error: 'method_not_allowed' }, 405);
      }
      return c.json({ error: 'route_not_found' }, 404);
    }

    const triggerCtx = {
      c,
      config: channel.config,
      emit: async (event: TriggerEvent) => {
        await dispatchEvent(event, channel.name, ctx);
      },
    };

    const result = await route.handler(triggerCtx);
    if (result instanceof Response) return result;
    if (result === undefined || result === null) return c.body(null, 200);
    return c.json(result);
  };
}
```

## 7.5 Subscription dispatch

```ts
// packages/core/src/server/dispatch.ts
import type { SubscriptionDefinition, TriggerEvent } from '../triggers/index.js';
import type { ArivieInstance } from '../types.js';

export async function dispatchEvent(
  event: TriggerEvent,
  sourceName: string,
  instance: ArivieInstance,
  subscriptions: SubscriptionDefinition<TriggerEvent>[],
): Promise<void> {
  for (const sub of subscriptions) {
    const sourceId = typeof sub.source === 'string' ? sub.source : sub.source.name;
    if (sourceId !== sourceName) continue;
    if (sub.filter && !sub.filter(event)) continue;

    const target = sub.target;
    const instanceId =
      typeof target.instanceId === 'function'
        ? target.instanceId(event)
        : target.instanceId ?? event.metadata.conversationKey ?? 'default';
    const input =
      typeof target.input === 'function' ? target.input(event) : target.input ?? event.payload;

    if (target.kind === 'agent') {
      const agent = instance.mastra.getAgent(target.id);
      await agent.generate(input, {
        memory: { thread: instanceId, resource: instanceId },
      });
    } else if (target.kind === 'workflow') {
      const workflow = instance.mastra.getWorkflow(target.id);
      const run = workflow.createRun();
      await run.start({ inputData: input });
    } else if (target.kind === 'skill') {
      // Arivie skill executor; exact API to be defined when skills gain programmatic invocation.
      throw new Error('Skill subscription target not yet implemented');
    }
  }
}
```

## 7.6 Reference channel: GitHub

```ts
// packages/github/src/channel.ts
import { defineChannel, defineTrigger, type TriggerEvent } from '@arivie/core/triggers';
import { verifyGitHubWebhook } from './verify.js';

interface GitHubConfig {
  webhookSecret: string;
}

type GitHubEvent =
  | TriggerEvent<'github.pull_request.opened', { number: number; title: string; body?: string; repository: string }>
  | TriggerEvent<'github.issue.opened', { number: number; title: string; body?: string; repository: string }>;

const githubTrigger = defineTrigger<GitHubConfig, GitHubEvent>({
  id: 'github',
  configSchema: z.object({ webhookSecret: z.string().min(1) }),
  routes: [
    {
      method: 'POST',
      path: '/webhook',
      async handler({ c, config, emit }) {
        const signature = c.req.header('x-hub-signature-256') ?? '';
        const body = await c.req.text();
        if (!(await verifyGitHubWebhook(config.webhookSecret, signature, body))) {
          return c.json({ error: 'invalid_signature' }, 401);
        }
        const eventType = c.req.header('x-github-event') ?? '';
        const payload = JSON.parse(body);
        const repo = payload.repository?.full_name ?? 'unknown';
        const deliveryId = c.req.header('x-github-delivery') ?? undefined;

        if (eventType === 'pull_request' && payload.action === 'opened') {
          await emit({
            type: 'github.pull_request.opened',
            payload: {
              number: payload.number,
              title: payload.pull_request.title,
              body: payload.pull_request.body,
              repository: repo,
            },
            metadata: { provider: 'github', deliveryId, conversationKey: `${repo}/pr/${payload.number}` },
          });
        } else if (eventType === 'issues' && payload.action === 'opened') {
          await emit({
            type: 'github.issue.opened',
            payload: {
              number: payload.issue.number,
              title: payload.issue.title,
              body: payload.issue.body,
              repository: repo,
            },
            metadata: { provider: 'github', deliveryId, conversationKey: `${repo}/issue/${payload.issue.number}` },
          });
        }
        return c.body(null, 204);
      },
    },
  ],
});

export const githubChannel = (config: GitHubConfig) =>
  defineChannel({ name: 'github', trigger: githubTrigger, config });
```

## 7.7 Node build plugin sketch

```ts
// packages/cli/src/lib/build/plugins/node.ts
import type { BuildContext, BuildPlugin } from '../types.js';

export class NodeBuildPlugin implements BuildPlugin {
  name = 'node';
  bundle = 'vite' as const;

  generateEntryPoint(ctx: BuildContext): string {
    const imports = [
      ...ctx.channels.map((c, i) => `import * as channel_${i} from ${JSON.stringify(c.filePath)};`),
      ...ctx.subscriptions.map((s, i) => `import * as subscription_${i} from ${JSON.stringify(s.filePath)};`),
    ].join('\n');

    const channelArray = `[${ctx.channels.map((_, i) => `channel_${i}`).join(',')}]`;
    const subscriptionArray = `[${ctx.subscriptions.map((_, i) => `subscription_${i}`).join(',')}]`;

    return `
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { defineArivie } from '@arivie/core';
import { arivie } from '@arivie/core/server';
import config from './arivie.config.js';
${imports}

const instance = await defineArivie(config);
const app = new Hono();
app.route('/', arivie({ instance, channels: ${channelArray}, subscriptions: ${subscriptionArray} }));
serve({ fetch: app.fetch, port: process.env.PORT ?? 3000 });
    `.trim();
  }
}
```
