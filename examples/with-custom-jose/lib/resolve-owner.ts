/* SPDX-License-Identifier: Apache-2.0 */
import { BYPASS_OWNER_ID, isAuthBypassRequest } from "./auth-bypass";
import { verifyJwt } from "./verify-jwt";

export async function resolveOwnerId(req: Request): Promise<string> {
  if (isAuthBypassRequest(req)) {
    return BYPASS_OWNER_ID;
  }
  const header = req.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header);
  if (match?.[1] == null) {
    throw new Error("Authorization: Bearer <jwt> required");
  }
  const { sub } = await verifyJwt(match[1]);
  return sub;
}
