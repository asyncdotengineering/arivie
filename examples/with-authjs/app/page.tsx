/* SPDX-License-Identifier: Apache-2.0 */
import { AgentChat } from "./agent-chat-client";

export default function HomePage() {
  return (
    <main className="page">
      <h1>Arivie + Next.js</h1>
      <p className="lede">
        Chat surface powered by <code>useAgent</code> via the registry{" "}
        <code>AgentChat</code> component.
      </p>
      <AgentChat endpoint="/api/arivie" title="Ask your data" />
    </main>
  );
}
