# Next.js → TanStack Start migration assessment

**Decision:** **Don't migrate yet — but the path is real.** Stay on Next.js
for the production starter and ship a parallel `examples/with-arivie-chat-tanstack/`
port when TanStack Start ships its 1.0. The migration is mechanical
enough that a single weekend will produce it once the green light is on.

## TL;DR verdict

| Concern | Next.js (today) | TanStack Start (today) | Verdict |
|---|---|---|---|
| Release status | Stable since 2017; v16 in production | RC; "considered feature-complete and stable" but maintainers warn it isn't bug-free | **Next.js wins** until 1.0 |
| SSE streaming for `handleChatStream` | Native via `Response` in route handlers | Native via server-route `Response` and `createServerFn` async generators | Tie |
| AI SDK 6 (`@ai-sdk/react`, `useChat`) | First-class; the starter uses it today | Framework-agnostic; works fine on any React app | Tie |
| Better Auth wiring | `toNextJsHandler(auth)` one-liner in `app/api/auth/[...all]/route.ts` | `auth.handler(request)` inside a `createFileRoute('/api/auth/$')` GET/POST handler — officially supported; ships a `tanstackStartCookies` plugin | Tie |
| File-based routing | `app/page.tsx`, `app/api/foo/route.ts`, `[param]` dynamic | `src/routes/index.tsx`, `src/routes/api/foo.ts`, `$param` dynamic | **TanStack wins** ergonomically; types are stronger |
| Server actions / functions | `'use server'` directives | `createServerFn({ method }).inputValidator().handler()` — typed, validated, composable | **TanStack wins** |
| Middleware | `middleware.ts` matcher | `createMiddleware()` composed in `src/start.ts` | TanStack is more flexible; Next is more conventional |
| Mastra + Postgres + pg Pool (single-process state) | Module-singleton via `let cached` in `lib/arivie.ts` | Same pattern works | Tie |
| Hosting | Vercel-native; any Node host | Any Vite-compatible host; deployment guides are sparser | **Next.js wins** today |
| Ecosystem (shadcn, examples, recipes) | Vast | Smaller but growing; TanStack ships skills/migration guides | **Next.js wins** today |

**Flip conditions:**
- Revisit when TanStack Start hits 1.0 (the "considered stable" caveat
  goes away).
- Revisit if Next.js v17 breaks our streaming setup OR if Vercel's
  pricing/lock-in becomes an issue for a self-hosted Arivie deployment.
- Revisit if a paying customer specifically wants a TanStack-based
  starter — the port itself is ~1 day of focused work.

## What would have to change (mechanical port)

The starter is 17 source files. The breakdown:

| File | Migration treatment |
|---|---|
| `app/page.tsx` | → `src/routes/index.tsx` with `createFileRoute('/')`. `Route.useLoaderData()` replaces the server-side `auth.api.getSession({ headers: await headers() })`; loader runs server-only. |
| `app/login/page.tsx` | → `src/routes/login.tsx`. `useRouter()` from `@tanstack/react-router` replaces Next's. Otherwise identical. |
| `app/register/page.tsx` | → `src/routes/register.tsx`. Same. |
| `app/api/auth/[...all]/route.ts` | → `src/routes/api/auth/$.ts`. Replace `toNextJsHandler(auth)` with `auth.handler(request)` inside a `server.handlers.{GET,POST}` block. Add the `tanstackStartCookies` plugin to `auth.ts`. |
| `app/api/chat/route.ts` | → `src/routes/api/chat.ts`. The `handleChatStream` call is unchanged — it returns a `ReadableStream`, and TanStack's server route handlers return a standard `Response`. The `runWithUserContext` wrap stays. `headers()` from `next/headers` becomes `request.headers`. |
| `app/api/threads/route.ts` | → `src/routes/api/threads.ts`. Same shape, `request.headers` swap. |
| `app/api/threads/[id]/messages/route.ts` | → `src/routes/api/threads/$id/messages.ts`. `params: Promise<{ id }>` becomes typed via `Route.useParams`. |
| `app/layout.tsx` | → `src/routes/__root.tsx`. ThemeProvider, font setup, Sonner Toaster move into the root route's component. |
| `app/globals.css` | Unchanged. Tailwind v4 works in Vite. |
| `lib/arivie.ts` | Unchanged — pure Node code. |
| `lib/auth.ts` | Add the `tanstackStartCookies()` plugin to `betterAuth({ ..., plugins: [tanstackStartCookies()] })`. |
| `lib/auth-client.ts` | Unchanged — `better-auth/react` works in any React app. |
| `lib/artifacts.ts` | Unchanged. |
| `lib/utils.ts` | Unchanged. |
| `components/*` | All unchanged — they don't import anything Next-specific. The only Next dep is `next-themes` which works in any React app. |
| `next.config.ts` | → `vite.config.ts` + `app.config.ts`. TanStack Start uses Vite. |
| `next-env.d.ts` | Delete. |
| `package.json` | Drop `next`; add `@tanstack/react-router`, `@tanstack/react-start`, `vite`, `@vitejs/plugin-react`. |

## Streaming correctness — the load-bearing concern

Our chat pipeline streams AI SDK 6 SSE frames through `createUIMessageStreamResponse({ stream })`. This produces a `Response` with `Content-Type: text/event-stream` and a `ReadableStream` body. **Both frameworks return this from a route handler identically** — it's pure web-standard Fetch API. Verified against TanStack Start docs: server route handlers return a `Response`, including streamed ones, and `createServerFn` natively supports `ReadableStream` return values with end-to-end typing.

There is one nuance: `handleChatStream` in `@mastra/ai-sdk` accepts a Mastra instance and stays framework-agnostic. The `runWithUserContext` AsyncLocalStorage wrapper also stays unchanged — ALS is a Node primitive, not a Next thing.

Risk: the only Next-specific behavior in our chat route is `await headers()` (Next 16's async dynamic API). TanStack passes `request.headers` directly, which is simpler.

## The honest tradeoff

What TanStack Start buys us (qualitatively):
- Stronger typing across the routing surface, including `useParams`, `useLoaderData`, and `useSearch`.
- Server functions are composable in a way Server Actions aren't (typed input validation, middleware chaining, no `'use server'` directive boundary).
- Vite as the bundler is faster in dev and produces more predictable production builds than Turbopack.
- Easier escape from Vercel-shaped abstractions if we ever need to run on Cloudflare Workers or self-host on a VPS.

What we lose:
- A larger surface area to debug when something goes wrong, with fewer published recipes.
- Some Next-only ecosystem bits (Vercel AI Gateway, Vercel Postgres helpers, OG image generation conventions). None of these are load-bearing for Arivie.
- The "obvious default" status — engineers joining the project will need to learn TanStack Start before they can ship.

## Recommendation

**Phase 3.2 (TanStack port) is GREEN-LIT but not BLOCKING.** Land it after
TanStack Start 1.0 ships. In the meantime, keep `examples/with-arivie-chat/`
on Next.js for the production starter and treat the TanStack port as a
second-flavor demo, the way Mastra ships side-by-side Next.js / Hono /
Express adapters.

Concrete next steps when we do the port:
1. `npm create @tanstack/router@latest examples/with-arivie-chat-tanstack`
2. Copy `lib/*` and `components/*` verbatim.
3. Port the four API routes per the table above.
4. Live-test the chat with the same agent-browser script we used for
   Phase 1.6.
5. Run the Phase 2 demo-artifact button to verify the artifact pane
   renders identically.

## Sources

1. TanStack Router `/packages/react-start/skills/lifecycle/migrate-from-nextjs/SKILL.md` — official migration skill, fetched via Context7.
2. TanStack Start `docs/start/framework/react/guide/streaming-data-from-server-functions.md` — streaming patterns.
3. TanStack Start overview page — release-stage statement: "TanStack Start is currently in the Release Candidate stage! This means it is considered feature-complete and its API is considered stable… This does not mean it is bug-free."
4. Better Auth docs — `auth.handler(request)` wiring with `tanstackStartCookies()` plugin in `src/routes/api/auth/$.ts`.
