/* SPDX-License-Identifier: Apache-2.0 */
import { withAuth } from "@workos-inc/authkit-nextjs";
import { BYPASS_OWNER_ID, isAuthBypassRequest } from "./auth-bypass";

export async function resolveOwnerId(req: Request): Promise<string> {
  if (isAuthBypassRequest(req)) {
    return BYPASS_OWNER_ID;
  }
  const { user } = await withAuth();
  if (user?.id != null && user.id.length > 0) {
    return user.id;
  }
  return process.env.ARIVIE_OWNER_ID ?? "with-workos-owner";
}
