/* SPDX-License-Identifier: Apache-2.0 */
import { AppChat } from "./agent-chat-client";

export default function HomePage() {
  return (
    <main className="page">
      <h1>Arivie + Next.js</h1>
      <p className="lede">
        Chat surface powered by <code>ArivieChat</code> from <code>@arivie/react/chat</code>{" "}
        against the built-in <code>POST /api/chat</code> route.
      </p>
      <AppChat />
    </main>
  );
}
