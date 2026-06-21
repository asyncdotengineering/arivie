/* SPDX-License-Identifier: Apache-2.0 */
// @arivie/context — file-backed context layer.
//
// The loader/validator/provenance runtime is built in C3 (see
// rfcs/general-agent-framework). The context *schema* contract ships now
// because the plugin SDK (C1) and manifest builder (C2) reference it.
export type { ContextSchemaDefinition } from "./schemas.js";
