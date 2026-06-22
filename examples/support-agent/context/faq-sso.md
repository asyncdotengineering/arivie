---
summary: Setting up SSO / SAML for an Aurora workspace.
usage_mode: auto
tags: [sso, saml, security, enterprise]
---
# Single sign-on (SSO)

SSO is available on the **Enterprise** plan.

1. **Settings → Security → SSO → Configure**.
2. Choose **SAML** and paste your IdP metadata URL (Okta, Entra ID, Google Workspace).
3. Map the email attribute and save.
4. Send members the Aurora SSO link from your IdP dashboard.

Once SSO is enforced, password login is disabled for the workspace and members sign in through your identity provider.
