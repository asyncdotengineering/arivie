/* SPDX-License-Identifier: Apache-2.0 */
import { assertAuthBypassAllowed } from "../../../../lib/auth-bypass";
import { auth } from "../../../../lib/auth";
import { toNextJsHandler } from "better-auth/next-js";

// Refuse to start if ARIVIE_AUTH_BYPASS=1 leaked into production — the auth
// route is module-loaded at server boot, so this fires at startup, not on
// first request. Matches the with-clerk / with-workos middleware behaviour.
assertAuthBypassAllowed();

export const { GET, POST } = toNextJsHandler(auth);
