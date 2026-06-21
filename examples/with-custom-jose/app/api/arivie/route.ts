/* SPDX-License-Identifier: Apache-2.0 */
import { getArivieRuntimeForOwner } from "../../../arivie.config";
import { resolveOwnerId } from "../../../lib/resolve-owner";
import { assertAuthBypassAllowed } from "../../../lib/auth-bypass";

assertAuthBypassAllowed();

export async function POST(req: Request): Promise<Response> {
  const ownerId = await resolveOwnerId(req);
  const { arivie } = await getArivieRuntimeForOwner(ownerId);
  return arivie.handler(req);
}
