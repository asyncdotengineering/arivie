/* SPDX-License-Identifier: Apache-2.0 */
import { getServerSession } from "next-auth";
import { authOptions } from "./auth-options";
import { BYPASS_OWNER_ID, isAuthBypassRequest } from "./auth-bypass";

export async function resolveOwnerId(req: Request): Promise<string> {
  if (isAuthBypassRequest(req)) {
    return BYPASS_OWNER_ID;
  }
  const session = await getServerSession(authOptions);
  const email = session?.user?.email;
  if (email != null && email.length > 0) {
    return email;
  }
  return process.env.ARIVIE_OWNER_ID ?? "with-authjs-owner";
}
