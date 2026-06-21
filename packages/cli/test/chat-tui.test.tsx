/* SPDX-License-Identifier: Apache-2.0 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { render } from "ink-testing-library";
import React from "react";
import { describe, expect, it } from "vitest";
import { ChatTui } from "../src/commands/chat-tui.js";
import { loadArivieInstance } from "../src/lib/load-instance.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixture = join(__dirname, "fixtures", "info-app.config.ts");

describe("arivie chat — ChatTui", () => {
  it("renders the header and new-conversation picker", async () => {
    const app = await loadArivieInstance(fixture);
    const { lastFrame, rerender, unmount } = render(
      <ChatTui app={app} agent="helper" user={{ userId: "u" }} />,
    );

    await expect.poll(() => lastFrame(), { timeout: 5000 }).toContain("Info Test App");
    await expect.poll(() => lastFrame(), { timeout: 5000 }).toContain("New conversation");

    rerender(<ChatTui app={app} agent="helper" user={{ userId: "u" }} />);
    unmount();
    await app.dispose();
  });
});
