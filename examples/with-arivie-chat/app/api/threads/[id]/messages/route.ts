/* SPDX-License-Identifier: Apache-2.0 */
import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({ messages: [] });
}
