/* SPDX-License-Identifier: Apache-2.0 */
import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { BYPASS_OWNER_ID } from "./auth-bypass";

function requireSecret(): string {
  const secret = process.env.NEXTAUTH_SECRET;
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
    "NEXTAUTH_SECRET is required — set it in .env.local or your CI env. " +
      "Auth secrets must fail closed; a fallback would allow forged sessions.",
  );
}

export const authOptions: NextAuthOptions = {
  secret: requireSecret(),
  providers: [
    CredentialsProvider({
      name: "Credentials",
      credentials: {
        email: { label: "Email", type: "text" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (process.env.ARIVIE_AUTH_BYPASS === "1") {
          return {
            id: BYPASS_OWNER_ID,
            email: "bypass@arivie.dev",
            name: "Bypass User",
          };
        }
        if (
          credentials?.email === "demo@arivie.dev" &&
          credentials?.password === "demo"
        ) {
          return { id: "demo-user", email: "demo@arivie.dev", name: "Demo" };
        }
        return null;
      },
    }),
  ],
  session: { strategy: "jwt" },
};
