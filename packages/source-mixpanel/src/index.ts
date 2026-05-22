/* SPDX-License-Identifier: Apache-2.0 */
export {
  mixpanelAdapter,
  deriveMixpanelAdapterId,
  hashProjectToken,
} from "./adapter.js";
export { compileMetricForMixpanel } from "./compile-metric.js";
export {
  executeMixpanelQuery,
  fetchSegmentation,
  fetchEventNames,
  probeWriteScope,
  queryApiBaseUrl,
  importApiBaseUrl,
  basicAuthHeader,
} from "./execute.js";
export {
  aggregateToSegmentationType,
  buildSegmentationSearchParams,
  buildSumSearchParams,
  compileMetricQuery,
  parseSegmentationData,
  sumRowValues,
  READ_ONLY_REQUIRED_MSG,
} from "./query.js";
export type {
  MixpanelQuery,
  MixpanelAdapter,
  MixpanelAdapterOptions,
  MixpanelEventInfo,
} from "./types.js";
export type { MixpanelClientConfig } from "./execute.js";
export type { SegmentationSeriesRow } from "./query.js";
