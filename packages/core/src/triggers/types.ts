/* SPDX-License-Identifier: Apache-2.0 */
import type { Context } from "hono";
import type { StandardSchemaV1 } from "@standard-schema/spec";

export interface TriggerEvent<TType extends string = string, TPayload = unknown> {
  type: TType;
  payload: TPayload;
  metadata: {
    provider: string;
    deliveryId?: string;
    conversationKey?: string;
    resourceKey?: string;
    rawRequest?: Request;
  };
}

export interface TriggerContext<TConfig = unknown, TEvents extends TriggerEvent = TriggerEvent> {
  c: Context;
  config: TConfig;
  emit(event: TEvents): Promise<void>;
}

export type TriggerMethod = "GET" | "POST" | "PUT" | "DELETE" | "ALL";

export interface TriggerRoute<TEvents extends TriggerEvent> {
  method: TriggerMethod;
  path: string;
  handler(ctx: TriggerContext<unknown, TEvents>):
    | Response
    | Promise<Response>
    | void
    | Promise<void>;
}

export interface TriggerDefinition<TConfig, TEvents extends TriggerEvent> {
  id: string;
  configSchema: StandardSchemaV1<TConfig>;
  routes: TriggerRoute<TEvents>[];
}
