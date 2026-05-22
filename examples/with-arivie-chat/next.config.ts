/* SPDX-License-Identifier: Apache-2.0 */
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // The semantic/ and seed/ directories are read at runtime by `defineArivie`
  // and the setup script. Next.js's tracer doesn't see them (no import), so
  // we tell it explicitly to include them in the serverless function bundle.
  outputFileTracingIncludes: {
    "/api/**": ["./semantic/**/*", "./seed/**/*"],
  },
};

export default nextConfig;
