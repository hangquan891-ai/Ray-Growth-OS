import { NextResponse } from "next/server";

import { normalizeXProfileUrl } from "@/lib/codeproxy-grok";
import { recordAiDiagnostic } from "@/lib/local-db";
import { buildOpenAiProfileRequestBody, normalizeGeneratedProfile } from "@/lib/llm-profile";
import { extractResponseOutputText } from "@/lib/llm-scoring";
import { isRetryableHttpStatus } from "@/lib/profile-retry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PROFILE_TIMEOUT_MS = 90000;

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

function describeValue(value: unknown, depth = 0): unknown {
  if (value === null) return { type: "null" };
  if (Array.isArray(value)) {
    return {
      type: "array",
      length: value.length,
      item: depth < 2 && value.length ? describeValue(value[0], depth + 1) : undefined,
    };
  }
  if (typeof value === "string") return { type: "string", length: value.length };
  if (typeof value !== "object") return { type: typeof value };

  const entries = Object.entries(value as Record<string, unknown>).slice(0, 40);
  return {
    type: "object",
    keys: entries.map(([key]) => key),
    fields: depth < 2
      ? Object.fromEntries(entries.map(([key, entryValue]) => [key, describeValue(entryValue, depth + 1)]))
      : undefined,
  };
}

function responseSemanticSummary(value: unknown) {
  const source = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const incomplete = source.incomplete_details && typeof source.incomplete_details === "object"
    ? (source.incomplete_details as Record<string, unknown>)
    : {};
  const output = Array.isArray(source.output) ? source.output : [];
  return {
    responseStatus: typeof source.status === "string" ? source.status : "",
    hasError: Boolean(source.error),
    incompleteReason: typeof incomplete.reason === "string" ? incomplete.reason.slice(0, 120) : "",
    outputItems: output.slice(0, 10).map((item) => {
      const outputItem = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
      const content = Array.isArray(outputItem.content) ? outputItem.content : [];
      return {
        type: typeof outputItem.type === "string" ? outputItem.type : "",
        status: typeof outputItem.status === "string" ? outputItem.status : "",
        contentTypes: content.slice(0, 10).map((entry) => {
          const contentItem = entry && typeof entry === "object" ? (entry as Record<string, unknown>) : {};
          return typeof contentItem.type === "string" ? contentItem.type : typeof entry;
        }),
      };
    }),
  };
}

function hasReasoningOnlyOutput(value: unknown) {
  const source = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const output = Array.isArray(source.output) ? source.output : [];
  return output.length > 0 && output.every((item) => {
    const outputItem = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
    return outputItem.type === "reasoning";
  });
}

function saveDiagnostic(input: Parameters<typeof recordAiDiagnostic>[0]) {
  try {
    return recordAiDiagnostic(input);
  } catch (error) {
    console.error("Could not save AI diagnostic metadata.", error);
    return null;
  }
}

export async function POST(request: Request) {
  let body: ProfileRequest;

  try {
    body = (await request.json()) as ProfileRequest;
  } catch {
    return NextResponse.json({ ok: false, retryable: false, status: "error", message: "请求体不是有效 JSON。" }, { status: 400 });
  }

  const mode = normalizeMode(body.mode);
  const xProfileUrl = normalizeXProfileUrl(body.xProfileUrl ?? "");
  if (!xProfileUrl) {
    return NextResponse.json(
      {
        ok: false,
        retryable: false,
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
        retryable: false,
        configured: false,
        status: "missing_key",
        message: "请先在设置页配置 GPT-5.5 / codeproxy 密钥，再用 AI 生成定位。",
      },
      { status: 400 }
    );
  }

  const model = String(body.model ?? "").trim() || process.env.CODEPROXY_PROFILE_MODEL?.trim() || process.env.CODEPROXY_AI_MODEL?.trim() || "gpt-5.5";
  const startedAt = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PROFILE_TIMEOUT_MS);

  let response: Response;
  let responseJson: unknown = {};
  let responseBodyLength = 0;
  let responseBodyFormat: "json" | "non_json" | "empty" = "empty";

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

    const responseText = await response.text();
    responseBodyLength = responseText.length;
    if (responseText.trim()) {
      try {
        responseJson = JSON.parse(responseText) as unknown;
        responseBodyFormat = "json";
      } catch {
        responseBodyFormat = "non_json";
      }
    }
  } catch (error) {
    const rawMessage = error instanceof Error ? error.message : "AI 定位生成请求失败。";
    const timedOut = controller.signal.aborted || /aborted|timeout|timed out/i.test(rawMessage);
    const message = timedOut ? "AI 定位生成超过 90 秒，已停止本次请求。" : rawMessage;
    const diagnostic = saveDiagnostic({
      action: "profile",
      durationMs: Date.now() - startedAt,
      httpStatus: null,
      model,
      outcome: timedOut ? "timeout" : "request_failed",
      responseShape: { bodyFormat: "unavailable" },
      errorMessage: message,
    });
    return NextResponse.json(
      {
        ok: false,
        retryable: true,
        configured: true,
        status: timedOut ? "timeout" : "request_failed",
        diagnosticId: diagnostic?.id,
        message,
      },
      { status: 502 }
    );
  } finally {
    clearTimeout(timeout);
  }

  const responseShape = {
    requestPolicy: {
      timeoutMs: PROFILE_TIMEOUT_MS,
      maxOutputTokens: 2400,
      reasoningEffort: /^gpt-5\.5(?:$|-)/i.test(model) ? "none" : "provider-default",
    },
    contentType: response.headers.get("content-type") || "",
    bodyFormat: responseBodyFormat,
    bodyLength: responseBodyLength,
    summary: responseSemanticSummary(responseJson),
    value: describeValue(responseJson),
  };

  if (!response.ok) {
    const message = errorMessage(responseJson, "codeproxy GPT-5.5 定位生成接口返回错误。");
    const retryable = isRetryableHttpStatus(response.status);
    const diagnostic = saveDiagnostic({
      action: "profile",
      durationMs: Date.now() - startedAt,
      httpStatus: response.status,
      model,
      outcome: "provider_error",
      responseShape,
      errorMessage: message,
    });
    return NextResponse.json(
      {
        ok: false,
        retryable,
        configured: true,
        status: "codeproxy_error",
        diagnosticId: diagnostic?.id,
        message,
      },
      { status: response.status }
    );
  }

  const outputText = extractResponseOutputText(responseJson);
  if (!outputText) {
    const reasoningOnly = hasReasoningOnlyOutput(responseJson);
    const message = reasoningOnly
      ? "上游模型只返回了推理过程，没有返回最终定位内容。请重试一次。"
      : "AI 没有返回可解析的定位草稿。";
    const diagnostic = saveDiagnostic({
      action: "profile",
      durationMs: Date.now() - startedAt,
      httpStatus: response.status,
      model,
      outcome: "empty_output",
      responseShape,
      errorMessage: reasoningOnly
        ? "Provider completed with reasoning output only and omitted the final message."
        : "Successful provider response contained no output recognized by the current parser.",
    });
    return NextResponse.json(
      {
        ok: false,
        retryable: true,
        configured: true,
        status: "empty_output",
        diagnosticId: diagnostic?.id,
        message,
      },
      { status: 502 }
    );
  }

  try {
    const parsed = JSON.parse(outputText);
    const profile = normalizeGeneratedProfile(parsed, mode, body.locale);
    const diagnostic = saveDiagnostic({
      action: "profile",
      durationMs: Date.now() - startedAt,
      httpStatus: response.status,
      model,
      outcome: "success",
      responseShape: { ...responseShape, extractedTextLength: outputText.length },
    });
    return NextResponse.json({
      ok: true,
      configured: true,
      diagnosticId: diagnostic?.id,
      model,
      profile,
    });
  } catch {
    const diagnostic = saveDiagnostic({
      action: "profile",
      durationMs: Date.now() - startedAt,
      httpStatus: response.status,
      model,
      outcome: "invalid_output",
      responseShape: { ...responseShape, extractedTextLength: outputText.length },
      errorMessage: "Extracted output was not valid JSON.",
    });
    return NextResponse.json(
      {
        ok: false,
        retryable: true,
        configured: true,
        status: "invalid_output",
        diagnosticId: diagnostic?.id,
        message: "AI 定位生成返回内容不是有效 JSON。",
      },
      { status: 502 }
    );
  }
}
