/* SPDX-License-Identifier: Apache-2.0 */
import { getArivieRuntime } from "../../../arivie.config";

export async function POST(req: Request): Promise<Response> {
  const { arivie } = await getArivieRuntime();
  return arivie.next.POST(req);
}
