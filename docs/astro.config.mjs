/* SPDX-License-Identifier: Apache-2.0 */
import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";

export default defineConfig({
  site: "https://arivie.dev",
  output: "static",
  integrations: [
    starlight({
      title: "Arivie",
      description:
        "Production-grade TypeScript framework for agentic analytics on Mastra — one instance, one owner.",
      favicon: "/favicon.svg",
      social: [
        {
          icon: "github",
          label: "GitHub",
          href: "https://github.com/openscoped/arivie",
        },
      ],
      editLink: {
        baseUrl:
          "https://github.com/openscoped/data-agent/edit/main/arivie/docs/",
      },
      customCss: ["./src/styles/custom.css"],
      sidebar: [
        { label: "Quickstart", slug: "quickstart" },
        {
          label: "Tutorials",
          items: [{ slug: "tutorials/first-bi-agent" }],
        },
        {
          label: "Concepts",
          items: [
            { slug: "concepts/why-arivie" },
            { slug: "concepts/the-boundary" },
            { slug: "concepts/the-semantic-layer" },
            { slug: "concepts/the-agent-loop" },
            { slug: "concepts/the-single-agent" },
            { slug: "concepts/skills" },
            { slug: "concepts/schedules" },
            { slug: "concepts/tool-approval" },
            { slug: "concepts/conversation-continuity" },
            { slug: "concepts/triggers-channels" },
            { slug: "concepts/mcp-equivalence" },
            { slug: "concepts/evaluation" },
          ],
        },
        {
          label: "Integrations",
          items: [
            { slug: "integrations/better-auth" },
            { slug: "integrations/custom-jose" },
          ],
        },
        {
          label: "Recipes",
          items: [
            { slug: "recipes/sql-as-calculator" },
            { slug: "recipes/file-artifacts" },
            { slug: "recipes/kitchen-sink" },
            { slug: "recipes/nextjs" },
            { slug: "recipes/hono" },
            { slug: "recipes/cloudflare-do" },
            { slug: "recipes/multi-region" },
            { slug: "recipes/audit-routing" },
            { slug: "recipes/cost-guardrails" },
          ],
        },
        {
          label: "Reference",
          items: [
            { slug: "comparison" },
            { slug: "reference/core" },
            { slug: "reference/agent" },
            { slug: "reference/cli" },
            { slug: "reference/packages" },
          ],
        },
      ],
      head: [
        {
          tag: "meta",
          attrs: {
            property: "og:image",
            content: "/og.png",
          },
        },
      ],
      credits: true,
    }),
  ],
});
