/* SPDX-License-Identifier: Apache-2.0 */
import { headers } from "next/headers";
import { auth } from "./auth";
import { BYPASS_OWNER_ID, isAuthBypassRequest } from "./auth-bypass";

export async function resolveOwnerId(req: Request): Promise<string> {
  if (isAuthBypassRequest(req)) {
    return BYPASS_OWNER_ID;
  }
  const session = await auth.api.getSession({ headers: await headers() });
  const user = session?.user;
  if (user?.id != null && user.id.length > 0) {
    return user.id;
  }
  if (user?.email != null && user.email.length > 0) {
    return user.email;
  }
  return process.env.ARIVIE_OWNER_ID ?? "with-better-auth-owner";
}
