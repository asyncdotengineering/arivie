/* SPDX-License-Identifier: Apache-2.0 */
/**
 * @arivie/react/chat — drop-in React UI surface for Arivie agents.
 *
 *   import { ArivieChat } from "@arivie/react/chat";
 *
 *   <ArivieChat
 *     userId={session.user.id}
 *     userEmail={session.user.email}
 *     endpoint="/api/chat"
 *   />
 *
 * Includes:
 *   - <ArivieChat>      — full chat layout (sidebar + main + artifact pane)
 *   - <ArtifactPane>    — standalone artifact panel, wired to json-render
 *                          via @arivie/ui-catalog
 *   - <ThreadList>      — sidebar thread picker (SWR-backed)
 *   - detectArtifact()  — heuristic mapping from tool outputs to artifacts
 *   - Artifact types    — query / chart / report / entity discriminated union
 */
export { ArivieChat } from "./ArivieChat.js";
export type { ArivieChatProps } from "./ArivieChat.js";
export { ArtifactPane } from "./ArtifactPane.js";
export type { ArtifactPaneProps } from "./ArtifactPane.js";
export { ThreadList } from "./ThreadList.js";
export type { ThreadListProps } from "./ThreadList.js";
export {
  ArtifactSchema,
  ChartArtifactSchema,
  EntityArtifactSchema,
  QueryArtifactSchema,
  ReportArtifactSchema,
  detectArtifact,
} from "./artifacts.js";
export type {
  Artifact,
  ArtifactKind,
  ChartArtifact,
  EntityArtifact,
  QueryArtifact,
  ReportArtifact,
} from "./artifacts.js";
