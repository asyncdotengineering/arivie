/* SPDX-License-Identifier: Apache-2.0 */

/**
 * Minimal self-contained HTML shell served as the json-render UI
 * resource (`ui://render-ui/view.html`). MCP UI clients (Claude Desktop,
 * Cursor, ChatGPT) open this in an iframe; the parent posts the tool
 * result containing a json-render spec via `ontoolresult`, and this
 * shell renders the spec.
 *
 * Implementation note: we load React + json-render packages from esm.sh
 * at runtime instead of bundling them. This keeps `@arivie/mcp` from
 * shipping a 200KB+ HTML blob and means the shell auto-tracks
 * @json-render/* versions we install. The tradeoff is the shell does a
 * network fetch on first render; for a dev/spike server this is fine.
 *
 * Customise this template (or replace via `makeMcpUiServer({ html })`)
 * to ship a hand-tuned production shell with bundled assets + brand styling.
 */
export const DEFAULT_UI_SHELL_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Arivie</title>
    <style>
      :root {
        --bg: #0b1115;
        --fg: #e7eef3;
        --muted: #8aa0ad;
        --accent: #0d9488;
        --warn: #fb923c;
      }
      @media (prefers-color-scheme: light) {
        :root {
          --bg: #ffffff;
          --fg: #0b1115;
          --muted: #5b6770;
          --accent: #0d9488;
          --warn: #c2570a;
        }
      }
      html, body, #root { height: 100%; margin: 0; }
      body {
        background: var(--bg);
        color: var(--fg);
        font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI",
                     Roboto, "Helvetica Neue", Arial, sans-serif;
        line-height: 1.5;
      }
      .empty { padding: 24px; color: var(--muted); font-size: 14px; }
      .err { padding: 16px; color: var(--warn); font-family: ui-monospace, monospace;
             font-size: 12px; white-space: pre-wrap; }
    </style>
  </head>
  <body>
    <div id="root">
      <div class="empty">Waiting for spec from the Arivie agent…</div>
    </div>
    <script type="module">
      // Pulled at runtime — these versions match what @arivie/mcp depends on.
      import * as React from "https://esm.sh/react@19.1?bundle";
      import * as ReactDOM from "https://esm.sh/react-dom@19.1/client?bundle";
      import { defineRegistry, Renderer } from "https://esm.sh/@json-render/react@0.19?bundle";
      import { shadcnComponentDefinitions } from "https://esm.sh/@json-render/shadcn@0.19/catalog?bundle";
      import { defineCatalog } from "https://esm.sh/@json-render/core@0.19?bundle";
      import { schema } from "https://esm.sh/@json-render/react@0.19/schema?bundle";

      // A bare-minimum mirror of the server-side Arivie catalog. We can't
      // import the server catalog directly (this runs in the browser), so
      // we re-declare the components the renderer needs. The Zod schema is
      // only used for VALIDATION on the server; the renderer just looks up
      // component names → React components in the registry.
      const catalog = defineCatalog(schema, {
        components: {
          ...shadcnComponentDefinitions,
          ArivieMetric: { props: schema.object({}), description: "" },
          ArivieQueryResult: { props: schema.object({}), description: "" },
          ArivieVerdict: { props: schema.object({}), description: "" },
          ArivieSemanticEntity: { props: schema.object({}), description: "" },
        },
        actions: {},
      });

      const fmt = (v, format) => {
        if (v == null) return "—";
        if (format === "currency") {
          const n = Number(v);
          if (!Number.isFinite(n)) return String(v);
          return n.toLocaleString(undefined, { style: "currency", currency: "USD" });
        }
        if (format === "percent") return \`\${v}%\`;
        return String(v);
      };

      const { registry } = defineRegistry(catalog, {
        components: {
          ArivieMetric: ({ props }) =>
            React.createElement("div", {
              style: {
                padding: "16px", border: "1px solid #2a3942", borderRadius: 12,
                display: "inline-block", minWidth: 220, margin: 8,
              },
            }, [
              React.createElement("div", { key: "l", style: { color: "var(--muted)", fontSize: 13 } }, props.label),
              React.createElement("div", { key: "v", style: { fontSize: 28, fontWeight: 600, marginTop: 4 } },
                fmt(props.value, props.format)),
              props.delta ? React.createElement("div", { key: "d",
                style: { fontSize: 13, marginTop: 4,
                  color: props.deltaDirection === "down" ? "var(--warn)" : "var(--accent)" }
              }, \`\${props.deltaDirection === "down" ? "▼" : "▲"} \${props.delta}\`) : null,
            ]),
          ArivieQueryResult: ({ props }) =>
            React.createElement("div", { style: { margin: 12 } }, [
              React.createElement("pre", {
                key: "sql",
                style: {
                  background: "#0e1820", color: "#cde8ff", padding: 12, borderRadius: 8,
                  fontSize: 12, overflow: "auto", maxHeight: 240,
                },
              }, props.sql),
              React.createElement("table", {
                key: "t",
                style: { width: "100%", borderCollapse: "collapse", marginTop: 8, fontSize: 13 },
              }, [
                React.createElement("thead", { key: "h" },
                  React.createElement("tr", null, Object.keys(props.rows?.[0] ?? {}).map(k =>
                    React.createElement("th", {
                      key: k,
                      style: { textAlign: "left", padding: "6px 10px", borderBottom: "1px solid #2a3942" },
                    }, k)))),
                React.createElement("tbody", { key: "b" },
                  (props.rows ?? []).map((row, i) =>
                    React.createElement("tr", { key: i },
                      Object.values(row).map((v, j) =>
                        React.createElement("td", {
                          key: j,
                          style: { padding: "6px 10px", borderBottom: "1px solid #1a242c" },
                        }, String(v)))))),
              ]),
              React.createElement("div", {
                key: "meta",
                style: { fontSize: 12, color: "var(--muted)", marginTop: 6 },
              }, \`\${props.rows?.length ?? 0} row(s)\${props.durationMs ? \` · \${props.durationMs}ms\` : ""}\${props.truncated ? " · truncated" : ""}\`),
            ]),
          ArivieVerdict: ({ props }) => {
            const colors = {
              healthy: { bg: "#0e2a22", fg: "#10b981" },
              watch:   { bg: "#2a230e", fg: "#fbbf24" },
              breached:{ bg: "#2a1010", fg: "#f87171" },
              info:    { bg: "#0e1c2a", fg: "#60a5fa" },
            };
            const c = colors[props.status] ?? colors.info;
            return React.createElement("div", {
              style: {
                display: "inline-flex", alignItems: "center", gap: 8, padding: "6px 14px",
                borderRadius: 999, background: c.bg, color: c.fg, fontSize: 13, margin: 8,
              },
            }, [
              React.createElement("strong", { key: "s" }, props.status.toUpperCase()),
              React.createElement("span", { key: "m" }, props.message),
              props.threshold ? React.createElement("span", { key: "t", style: { opacity: 0.7 } }, \`(\${props.threshold})\`) : null,
            ]);
          },
          ArivieSemanticEntity: ({ props }) =>
            React.createElement("div", {
              style: {
                margin: 12, padding: 16, border: "1px solid #2a3942", borderRadius: 12,
              },
            }, [
              React.createElement("h3", { key: "n", style: { margin: 0, fontSize: 16 } }, props.entityName),
              props.description ? React.createElement("p", { key: "d",
                style: { color: "var(--muted)", fontSize: 13 } }, props.description) : null,
              ["measures", "dimensions", "segments"].map(kind =>
                (props[kind]?.length ?? 0) > 0
                  ? React.createElement("div", { key: kind, style: { marginTop: 8 } }, [
                      React.createElement("div", { key: "h",
                        style: { fontSize: 12, color: "var(--muted)", textTransform: "uppercase" } }, kind),
                      React.createElement("ul", { key: "u", style: { margin: "4px 0 0", paddingLeft: 18 } },
                        props[kind].map((x, i) => React.createElement("li", { key: i, style: { fontSize: 13 } },
                          [React.createElement("strong", { key: "n" }, x.name),
                           x.description ? \` — \${x.description}\` : ""]))),
                    ])
                  : null
              ),
            ]),
        },
      });

      const root = ReactDOM.createRoot(document.getElementById("root"));

      function render(spec) {
        try {
          root.render(React.createElement(Renderer, { spec, registry }));
        } catch (err) {
          root.render(React.createElement("div", { className: "err" },
            \`Render error: \${err?.message ?? String(err)}\`));
        }
      }

      // MCP UI clients post the tool result via window.ontoolresult.
      window.ontoolresult = (result) => {
        const text = result?.content?.[0]?.text;
        if (!text) return;
        try {
          const spec = JSON.parse(text);
          render(spec);
        } catch (err) {
          root.render(React.createElement("div", { className: "err" },
            \`Bad spec JSON: \${err?.message ?? String(err)}\`));
        }
      };
    </script>
  </body>
</html>
`;
