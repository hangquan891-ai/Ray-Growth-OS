import { NextResponse } from "next/server";

import { getAiDiagnostic, listAiDiagnostics } from "@/lib/local-db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const id = Number(url.searchParams.get("id") || 0);
  const limit = Number(url.searchParams.get("limit") || 20);

  if (id > 0) {
    const diagnostic = getAiDiagnostic(id, "draft");
    if (!diagnostic) {
      return NextResponse.json({ ok: false, message: `没有找到草稿日志 #${id}。` }, { status: 404 });
    }
    return NextResponse.json({ ok: true, diagnostic });
  }

  return NextResponse.json({
    ok: true,
    diagnostics: listAiDiagnostics("draft", limit),
  });
}
