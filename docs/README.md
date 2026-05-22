# Arivie documentation site

Astro Starlight site for [arivie.dev](https://arivie.dev). Built with `astro ^6.3.5` and `@astrojs/starlight ^0.39.2`.

## Commands

```bash
pnpm --filter docs dev      # local preview
pnpm --filter docs build    # static output → dist/
pnpm --filter docs preview  # serve dist/
```

Deploy is handled by `.github/workflows/docs-deploy.yml` (Cloudflare Pages). `wrangler.toml` names the Pages project.
