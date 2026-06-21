/* SPDX-License-Identifier: Apache-2.0 */
import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({ threads: [] });
}

export async function POST() {
  return NextResponse.json(
    { error: "thread_history_unavailable" },
    { status: 410 },
  );
}
