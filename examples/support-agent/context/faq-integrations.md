---
summary: How to connect Slack and other integrations to Aurora.
usage_mode: auto
tags: [integrations, slack, api]
---
# Integrations

- **Slack:** **Settings → Integrations → Slack → Connect**, then authorize the workspace. Aurora posts notifications to the channel you pick.
- **API keys:** **Settings → Developer → API keys → New key**. Keys are shown once — store them securely.
- **Webhooks:** **Settings → Developer → Webhooks** — add an endpoint URL; Aurora signs each payload with your signing secret.

Disconnecting an integration revokes its tokens immediately.
