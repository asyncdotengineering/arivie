/* SPDX-License-Identifier: Apache-2.0 */
import { defineConfig } from "tsup";
import base from "../../tsup.base.ts";

export default defineConfig({
  ...base,
  entry: ["src/index.ts", "src/chat/index.ts"],
  external: ["react", "react-dom", "zod", "@ai-sdk/react", "ai"],
});
