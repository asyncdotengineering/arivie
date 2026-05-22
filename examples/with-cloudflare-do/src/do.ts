/* SPDX-License-Identifier: Apache-2.0 */
import { getArivieRuntime, type ArivieWorkerEnv } from "../arivie.config";

export class ArivieDO implements DurableObject {
  constructor(
    private readonly state: DurableObjectState,
    private readonly env: ArivieWorkerEnv & { ARIVIE_DO: DurableObjectNamespace },
  ) {}

  async fetch(request: Request): Promise<Response> {
    const { arivie } = await getArivieRuntime(this.env);
    return arivie.handler(request);
  }
}
