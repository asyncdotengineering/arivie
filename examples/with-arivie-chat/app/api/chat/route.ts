/* SPDX-License-Identifier: Apache-2.0 */
import { getArivie } from "@/lib/arivie";

export const maxDuration = 60;

export async function POST(req: Request): Promise<Response> {
  const arivie = await getArivie();
  return arivie.handler(req);
}
