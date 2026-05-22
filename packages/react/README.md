# @arivie/react

Headless React hooks for Arivie consumers — **REQ-29**. No UI components; pair with `@ai-sdk/react` (AI Elements) in your app.

## Hooks

| Hook | Purpose |
|------|---------|
| `useAgent` | SSE chat against your Arivie HTTP handler (`POST` + `text/event-stream`) |
| `useSchema` | `GET {endpoint}/schema` — catalog, entities, owner |
| `useMemory` | `GET/POST/DELETE {endpoint}/memory` — saved corrections |

See [RFC §4.8](https://github.com/openscoped/data-agent/blob/main/.research/07-rfc/RFC-002-concrete-tech-implementation/02-requirements-interfaces.md#48-anaclipreact--headless-hooks) for the public surface.

## Install

```bash
pnpm add @arivie/react react
```

## Usage

```tsx
import { useAgent } from "@arivie/react";

function Chat() {
  const { messages, status, submit, abort } = useAgent({
    endpoint: "/api/arivie",
  });

  return (
    <div>
      {messages.map((m) => (
        <p key={m.id}>{m.content}</p>
      ))}
      <button onClick={() => submit("What is revenue?")}>Ask</button>
      <button onClick={abort} disabled={status === "idle"}>
        Stop
      </button>
    </div>
  );
}
```

## Bundle budget

Built output must stay **&lt; 30 KB gzip** (excluding `react`, `react-dom`, and AI Elements peers). Checked in CI via `pnpm --filter @arivie/react size`.

## License

Apache-2.0
