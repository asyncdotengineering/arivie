/* SPDX-License-Identifier: Apache-2.0 */
import { makeMcpRouteHandler } from "@arivie/mcp/next";
import { getArivieRuntime } from "../../../../arivie.config";

export async function POST(req: Request): Promise<Response> {
  const { mcp } = await getArivieRuntime();
  return makeMcpRouteHandler(mcp)(req);
}
