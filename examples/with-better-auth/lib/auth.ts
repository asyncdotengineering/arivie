/* SPDX-License-Identifier: Apache-2.0 */
import { betterAuth } from "better-auth";
import { nextCookies } from "better-auth/next-js";

function requireSecret(): string {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (secret != null && secret.length > 0) {
    return secret;
  }
  // Next.js loads route modules during `next build` to optimize them; the
  // build phase has no env-vars and signs no real sessions, so a static
  // placeholder is safe *only there*. Any other phase (dev, runtime, test)
  // refuses the placeholder: auth secrets fail closed.
  if (process.env.NEXT_PHASE === "phase-production-build") {
    return "build-phase-placeholder-not-used-at-runtime";
  }
  throw new Error(
    "BETTER_AUTH_SECRET is required — set it in .env.local or your CI env. " +
      "Auth secrets must fail closed; a fallback would allow forged sessions.",
  );
}

export const auth = betterAuth({
  baseURL: process.env.BETTER_AUTH_URL ?? "http://localhost:3000",
  secret: requireSecret(),
  emailAndPassword: { enabled: true },
  plugins: [nextCookies()],
});
