/* SPDX-License-Identifier: Apache-2.0 */
import NextAuth from "next-auth";
import { assertAuthBypassAllowed } from "../../../lib/auth-bypass";
import { authOptions } from "../../../lib/auth-options";

// Refuse to start if ARIVIE_AUTH_BYPASS=1 leaked into production. The auth
// route is module-loaded at server boot, so this fires at startup, not on
// first request. Matches the with-clerk / with-workos middleware behaviour.
assertAuthBypassAllowed();

export default NextAuth(authOptions);
