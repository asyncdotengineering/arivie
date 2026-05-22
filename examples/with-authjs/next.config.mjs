/* SPDX-License-Identifier: Apache-2.0 */
/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: [
    "@arivie/core",
    "@arivie/react",
    "@arivie/registry",
    "@arivie/mcp",
    "@arivie/db-postgres",
    "@arivie/agent",
    "@arivie/semantic",
  ],
};

export default nextConfig;
