/* SPDX-License-Identifier: Apache-2.0 */
import { z } from "zod";

/**
 * The shared event envelope (RFC §7.4). Every structured event carries a
 * monotonic `cursor` for replay/resume, stable `id`, `type`, the owning
 * `sessionId`/`runId`, an ISO `timestamp`, and a typed `payload`. The storage
 * layer (C4/C5) persists this envelope; the event model owns the shape.
 */
export interface BaseEvent<TType extends string = string, TPayload = unknown> {
  cursor: string;
  id: string;
  type: TType;
  sessionId: string;
  runId: string;
  timestamp: string;
  payload: TPayload;
}

const envelope = {
  cursor: z.string(),
  id: z.string(),
  sessionId: z.string(),
  runId: z.string(),
  timestamp: z.string(),
};

/** Zod schemas are the single source of truth; TS types are inferred below. */
export const SessionStartedEventSchema = z.object({
  ...envelope,
  type: z.literal("session.started"),
  payload: z.object({
    agentId: z.string(),
    userId: z.string(),
    resource: z.string().optional(),
  }),
});

export const RunStartedEventSchema = z.object({
  ...envelope,
  type: z.literal("run.started"),
  payload: z.object({
    agentId: z.string(),
    input: z.unknown().optional(),
  }),
});

export const ModelDeltaEventSchema = z.object({
  ...envelope,
  type: z.literal("model.delta"),
  payload: z.object({ text: z.string() }),
});

export const ToolCallStartedEventSchema = z.object({
  ...envelope,
  type: z.literal("tool.call.started"),
  payload: z.object({
    toolCallId: z.string(),
    tool: z.string(),
    args: z.record(z.string(), z.unknown()),
  }),
});

export const ToolCallCompletedEventSchema = z.object({
  ...envelope,
  type: z.literal("tool.call.completed"),
  payload: z.object({
    toolCallId: z.string(),
    tool: z.string(),
    output: z.unknown(),
    isError: z.boolean().optional(),
  }),
});

export const ArtifactWrittenEventSchema = z.object({
  ...envelope,
  type: z.literal("artifact.written"),
  payload: z.object({
    path: z.string(),
    bytes: z.number().optional(),
  }),
});

export const ApprovalRequestedEventSchema = z.object({
  ...envelope,
  type: z.literal("approval.requested"),
  payload: z.object({
    toolCallId: z.string(),
    tool: z.string(),
    args: z.record(z.string(), z.unknown()),
  }),
});

export const ChannelEventReceivedEventSchema = z.object({
  ...envelope,
  type: z.literal("channel.event.received"),
  payload: z.object({
    channel: z.string(),
    eventType: z.string(),
    deliveryId: z.string().optional(),
  }),
});

export const RunCompletedEventSchema = z.object({
  ...envelope,
  type: z.literal("run.completed"),
  payload: z.object({ text: z.string().optional() }),
});

export const RunFailedEventSchema = z.object({
  ...envelope,
  type: z.literal("run.failed"),
  payload: z.object({
    error: z.object({
      message: z.string(),
      name: z.string().optional(),
      code: z.string().optional(),
    }),
  }),
});

/** Discriminated union of every public event variant (RFC §4.7). */
export const ArivieEventSchema = z.discriminatedUnion("type", [
  SessionStartedEventSchema,
  RunStartedEventSchema,
  ModelDeltaEventSchema,
  ToolCallStartedEventSchema,
  ToolCallCompletedEventSchema,
  ArtifactWrittenEventSchema,
  ApprovalRequestedEventSchema,
  ChannelEventReceivedEventSchema,
  RunCompletedEventSchema,
  RunFailedEventSchema,
]);

export type SessionStartedEvent = z.infer<typeof SessionStartedEventSchema>;
export type RunStartedEvent = z.infer<typeof RunStartedEventSchema>;
export type ModelDeltaEvent = z.infer<typeof ModelDeltaEventSchema>;
export type ToolCallStartedEvent = z.infer<typeof ToolCallStartedEventSchema>;
export type ToolCallCompletedEvent = z.infer<typeof ToolCallCompletedEventSchema>;
export type ArtifactWrittenEvent = z.infer<typeof ArtifactWrittenEventSchema>;
export type ApprovalRequestedEvent = z.infer<typeof ApprovalRequestedEventSchema>;
export type ChannelEventReceivedEvent = z.infer<typeof ChannelEventReceivedEventSchema>;
export type RunCompletedEvent = z.infer<typeof RunCompletedEventSchema>;
export type RunFailedEvent = z.infer<typeof RunFailedEventSchema>;

export type ArivieEvent = z.infer<typeof ArivieEventSchema>;

/** The string literal type for every event `type`. */
export type ArivieEventType = ArivieEvent["type"];
