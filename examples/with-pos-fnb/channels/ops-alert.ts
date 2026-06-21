/* SPDX-License-Identifier: Apache-2.0 */
import { defineChannel, defineTrigger, type TriggerEvent } from "@arivie/core/triggers";
import { z } from "zod";

type OpsAlertEvent = TriggerEvent<
  "ops.closeout.alert",
  { outletId: string; severity: "info" | "warning" | "critical"; message: string }
>;

export const opsAlertTrigger = defineTrigger<Record<string, never>, OpsAlertEvent>({
  id: "ops.closeout.alert",
  configSchema: z.object({}),
  routes: [
    {
      method: "POST",
      path: "/closeout",
      async handler({ c, emit }) {
        const body = await c.req.json().catch(() => ({}));
        const outletId =
          body != null && typeof body === "object" && "outletId" in body
            ? String((body as { outletId?: unknown }).outletId)
            : "unknown";
        const severity =
          body != null &&
          typeof body === "object" &&
          (body as { severity?: unknown }).severity === "critical"
            ? "critical"
            : "warning";
        const message =
          body != null && typeof body === "object" && "message" in body
            ? String((body as { message?: unknown }).message)
            : "Closeout alert received";

        await emit({
          type: "ops.closeout.alert",
          payload: { outletId, severity, message },
          metadata: {
            provider: "lumiere-pos",
            conversationKey: `closeout:${outletId}`,
            resourceKey: "lumiere-chain",
            rawRequest: c.req.raw,
          },
        });
        return c.json({ ok: true, routed: "ops.closeout.alert" });
      },
    },
  ],
});

export const channel = defineChannel({
  name: "ops-alert",
  trigger: opsAlertTrigger,
  config: {},
});

export default channel;
