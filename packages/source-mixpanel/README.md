# @arivie/source-mixpanel

Mixpanel Query API `SourceAdapter` for Arivie (RFC-003 v2 REQ-41).

## Usage

```ts
import { mixpanelAdapter } from "@arivie/source-mixpanel";

const mixpanel = mixpanelAdapter({
  projectToken: process.env.MIXPANEL_TOKEN!,
  projectId: process.env.MIXPANEL_PROJECT_ID!,
});

// Wire into defineArivie sources (C45):
// sources: { mixpanel }
```

## Authentication

Query API requests use HTTP Basic Auth: the project API secret (or service-account
credential) as the username with an empty password. See
[Mixpanel Project Secret](https://developer.mixpanel.com/reference/project-secret).

## Read-only tokens

On the first `execute()` call, the adapter probes the Import API. If the
credential can successfully import events, construction fails with a clear error.
Mixpanel does not expose a dedicated read-only scope endpoint — configure
query-only tokens in your Mixpanel project settings.

## Live tests (HS-5)

```bash
MIXPANEL_TOKEN=... MIXPANEL_PROJECT_ID=... pnpm --filter @arivie/source-mixpanel test
```

When credentials are absent, `test/live.test.ts` is skipped and logs
`[HS-5] Mixpanel creds missing — running mock-only`. Mock fixtures in
`test/fixtures/mock-mixpanel-responses.ts` exercise deterministic query paths.

## Query shape

```ts
interface MixpanelQuery {
  event?: string;
  aggregate?: "count" | "sum" | "average";
  from_date: string; // yyyy-mm-dd
  to_date: string;
  where?: string;
  on?: string;
}
```

`compileMetric` is defined for REQ-43; the agent dispatcher lands in Sprint 3 C61.
