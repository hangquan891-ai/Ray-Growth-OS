import { NextResponse } from "next/server";

import { listAiDiagnostics } from "@/lib/local-db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    ok: true,
    diagnostics: listAiDiagnostics("profile", 20),
  });
}
