/* SPDX-License-Identifier: Apache-2.0 */
import { auth } from "@clerk/nextjs/server";
import { BYPASS_OWNER_ID, isAuthBypassRequest } from "./auth-bypass";

export async function resolveOwnerId(req: Request): Promise<string> {
  if (isAuthBypassRequest(req)) {
    return BYPASS_OWNER_ID;
  }
  const session = await auth();
  if (session.userId != null && session.userId.length > 0) {
    return session.userId;
  }
  return process.env.ARIVIE_OWNER_ID ?? "with-clerk-owner";
}
