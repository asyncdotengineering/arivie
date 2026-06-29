# @arivie/react

## 3.0.0

### Major Changes

- 3586aba: Arivie v3.0.0 — navigation-by-default knowledge delivery + OKF-shaped context layer.

  BREAKING (see [ADR 0006](./docs/adr/0006-knowledge-delivery-navigation-default-okf.md)):

  - **`@arivie/plugin-analytics`**: remove `mode` config (`"preload"` / `"auto"`). Navigation-by-default replaces preload — a cached governance core (entity catalog, join skeleton, glossary) sits behind the prompt-cache breakpoint; entity detail and knowledge concepts are fetched on demand via tools.
  - **`@arivie/context`**: OKF-shaped knowledge layer — markdown concepts carry `type: playbook | reference | term`, fronted by `index.md` catalog and `semantic:` cross-links to the executable semantic layer.
  - **`@arivie/agent`** / **`@arivie/core`**: system-prompt assembly and plugin config surface updated for the single navigation path.

  All `@arivie/*` packages move to 3.0.0 together (lockstep), consistent with prior releases.

### Patch Changes

- Updated dependencies [3586aba]
  - @arivie/ui-catalog@3.0.0

## 0.2.1

### Patch Changes

- Updated dependencies
  - @arivie/ui-catalog@0.1.1

## 0.0.0

- Initial release (Sprint 3 / S3-04): `useAgent`, `useSchema`, `useMemory` headless hooks with SSE via `fetch` + `ReadableStream` (REQ-29).
- `size-limit` CI gate: bundle &lt; 30 KB gzip excluding React + AI Elements peers.
