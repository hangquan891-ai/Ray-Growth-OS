import { NextResponse } from "next/server";

import { normalizeXProfileUrl } from "@/lib/codeproxy-grok";
import { buildOpenAiProfileRequestBody, normalizeGeneratedProfile } from "@/lib/llm-profile";
import { extractResponseOutputText } from "@/lib/llm-scoring";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ProfileMode = "outbound" | "growth";

type ProfileRequest = {
  mode?: ProfileMode;
  locale?: "zh-CN" | "en";
  xProfileUrl?: string;
  current?: unknown;
  apiKey?: string;
  model?: string;
};

function normalizeMode(value: unknown): ProfileMode {
  return value === "outbound" ? "outbound" : "growth";
}

function errorMessage(value: unknown, fallback: string) {
  if (value && typeof value === "object" && "error" in value) {
    const error = (value as { error?: { message?: unknown } }).error;
    if (typeof error?.message === "string" && error.message.trim()) return error.message;
  }
  return fallback;
}

export async function POST(request: Request) {
  let body: ProfileRequest;

  try {
    body = (await request.json()) as ProfileRequest;
  } catch {
    return NextResponse.json({ ok: false, status: "error", message: "请求体不是有效 JSON。" }, { status: 400 });
  }

  const mode = normalizeMode(body.mode);
  const xProfileUrl = normalizeXProfileUrl(body.xProfileUrl ?? "");
  if (!xProfileUrl) {
    return NextResponse.json(
      {
        ok: false,
        status: "missing_profile_url",
        message: "请先在设置页保存你的 X 主页地址，再让 AI 生成定位。",
      },
      { status: 400 }
    );
  }

  const apiKey = String(body.apiKey ?? "").trim() || process.env.CODEPROXY_API_KEY?.trim();
  if (!apiKey) {
    return NextResponse.json(
      {
        ok: false,
        configured: false,
        status: "missing_key",
        message: "请先在设置页配置 GPT-5.5 / codeproxy 密钥，再用 AI 生成定位。",
      },
      { status: 400 }
    );
  }

  const model = String(body.model ?? "").trim() || process.env.CODEPROXY_PROFILE_MODEL?.trim() || process.env.CODEPROXY_AI_MODEL?.trim() || "gpt-5.5";
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45000);

  let response: Response;
  let responseJson: unknown;

  try {
    response = await fetch("https://codeproxy.dev/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(
        buildOpenAiProfileRequestBody({
          model,
          payload: {
            mode,
            locale: body.locale,
            xProfileUrl,
            current: body.current,
          },
        })
      ),
      signal: controller.signal,
    });
    responseJson = await response.json().catch(() => ({}));
  } catch (error) {
    clearTimeout(timeout);
    return NextResponse.json(
      {
        ok: false,
        configured: true,
        status: "request_failed",
        message: error instanceof Error ? error.message : "AI 定位生成请求失败。",
      },
      { status: 502 }
    );
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    return NextResponse.json(
      {
        ok: false,
        configured: true,
        status: "codeproxy_error",
        message: errorMessage(responseJson, "codeproxy GPT-5.5 定位生成接口返回错误。"),
      },
      { status: response.status }
    );
  }

  const outputText = extractResponseOutputText(responseJson);
  if (!outputText) {
    return NextResponse.json(
      {
        ok: false,
        configured: true,
        status: "empty_output",
        message: "AI 没有返回可解析的定位草稿。",
      },
      { status: 502 }
    );
  }

  try {
    const parsed = JSON.parse(outputText);
    const profile = normalizeGeneratedProfile(parsed, mode, body.locale);
    return NextResponse.json({
      ok: true,
      configured: true,
      model,
      profile,
    });
  } catch {
    return NextResponse.json(
      {
        ok: false,
        configured: true,
        status: "invalid_output",
        message: "AI 定位生成返回内容不是有效 JSON。",
      },
      { status: 502 }
    );
  }
}
