/* SPDX-License-Identifier: Apache-2.0 */
import * as jose from "jose";

export async function verifyJwt(token: string): Promise<{ sub: string }> {
  const secret = process.env.JWT_SECRET;
  if (secret == null || secret.length === 0) {
    throw new Error("JWT_SECRET is required");
  }
  const key = new TextEncoder().encode(secret);
  const { payload } = await jose.jwtVerify(token, key, { algorithms: ["HS256"] });
  if (typeof payload.sub !== "string" || payload.sub.length === 0) {
    throw new Error("JWT missing sub claim");
  }
  return { sub: payload.sub };
}
