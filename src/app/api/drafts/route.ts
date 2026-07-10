import { NextResponse } from "next/server";

import { AI_DRAFT_LIMIT, buildOpenAiDraftRequestBody, normalizeAiDraftResponse } from "@/lib/llm-drafts";
import { extractResponseOutputText } from "@/lib/llm-scoring";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const AI_DRAFT_TIMEOUT_MS = 120000;

type DraftMode = "outbound" | "growth";

type DraftRequest = {
  mode?: DraftMode;
  locale?: "zh-CN" | "en";
  profile?: unknown;
  styleGuide?: unknown;
  styleSamples?: unknown[];
  growthMemory?: unknown;
  items?: unknown[];
  apiKey?: string;
  model?: string;
};

function normalizeMode(value: unknown): DraftMode {
  return value === "outbound" ? "outbound" : "growth";
}

function isAbortError(error: unknown) {
  return error instanceof Error && (error.name === "AbortError" || /aborted/i.test(error.message));
}

function requestFailureMessage(error: unknown) {
  if (isAbortError(error)) {
    return "AI 草稿生成等待时间过长，已经自动停止。成功生成的草稿会先保存，可以稍后重试未成功的条目。";
  }
  return error instanceof Error ? error.message : "AI 草稿生成请求失败。";
}
function errorMessage(value: unknown, fallback: string) {
  if (value && typeof value === "object" && "error" in value) {
    const error = (value as { error?: { message?: unknown } }).error;
    if (typeof error?.message === "string" && error.message.trim()) return error.message;
  }
  return fallback;
}

export async function POST(request: Request) {
  let body: DraftRequest;

  try {
    body = (await request.json()) as DraftRequest;
  } catch {
    return NextResponse.json({ ok: false, status: "error", message: "请求体不是有效 JSON。" }, { status: 400 });
  }

  const mode = normalizeMode(body.mode);
  const items = Array.isArray(body.items) ? body.items.slice(0, AI_DRAFT_LIMIT) : [];
  if (items.length === 0) {
    return NextResponse.json({ ok: false, status: "empty", message: "当前队列没有可生成草稿的信号。" }, { status: 400 });
  }

  const apiKey = String(body.apiKey ?? "").trim() || process.env.CODEPROXY_API_KEY?.trim();
  if (!apiKey) {
    return NextResponse.json(
      {
        ok: false,
        configured: false,
        status: "missing_key",
        message: "请先在设置页配置 GPT-5.5 / codeproxy 密钥，已保留本地规则草稿。",
      },
      { status: 400 }
    );
  }

  const model = String(body.model ?? "").trim() || process.env.CODEPROXY_DRAFT_MODEL?.trim() || process.env.CODEPROXY_AI_MODEL?.trim() || "gpt-5.5";
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), AI_DRAFT_TIMEOUT_MS);

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
        buildOpenAiDraftRequestBody({
          model,
          payload: {
            mode,
            locale: body.locale,
            profile: body.profile,
            styleGuide: body.styleGuide,
            styleSamples: body.styleSamples,
            growthMemory: body.growthMemory,
            items,
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
        message: requestFailureMessage(error),
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
        message: errorMessage(responseJson, "codeproxy GPT-5.5 草稿生成接口返回错误。"),
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
        message: "AI 草稿生成没有返回可解析结果，已保留本地规则草稿。",
      },
      { status: 502 }
    );
  }

  try {
    const normalized = normalizeAiDraftResponse(JSON.parse(outputText), mode);
    return NextResponse.json({
      ok: true,
      configured: true,
      model,
      drafts: normalized.drafts,
    });
  } catch {
    return NextResponse.json(
      {
        ok: false,
        configured: true,
        status: "invalid_output",
        message: "AI 草稿生成返回内容不是有效 JSON，已保留本地规则草稿。",
      },
      { status: 502 }
    );
  }
}
