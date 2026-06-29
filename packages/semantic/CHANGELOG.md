## 3.0.0

### Major Changes

- 3586aba: Arivie v3.0.0 — navigation-by-default knowledge delivery + OKF-shaped context layer.

  BREAKING (see [ADR 0006](./docs/adr/0006-knowledge-delivery-navigation-default-okf.md)):

  - **`@arivie/plugin-analytics`**: remove `mode` config (`"preload"` / `"auto"`). Navigation-by-default replaces preload — a cached governance core (entity catalog, join skeleton, glossary) sits behind the prompt-cache breakpoint; entity detail and knowledge concepts are fetched on demand via tools.
  - **`@arivie/context`**: OKF-shaped knowledge layer — markdown concepts carry `type: playbook | reference | term`, fronted by `index.md` catalog and `semantic:` cross-links to the executable semantic layer.
  - **`@arivie/agent`** / **`@arivie/core`**: system-prompt assembly and plugin config surface updated for the single navigation path.

  All `@arivie/*` packages move to 3.0.0 together (lockstep), consistent with prior releases.

## 0.0.0

- Initial parser, linter, and codegen (Sprint 0 / C03).
