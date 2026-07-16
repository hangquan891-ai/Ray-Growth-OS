import { NextResponse } from "next/server";

import { extractResponseOutputText } from "@/lib/llm-scoring";
import { classifyGrokRequestFailure } from "@/lib/grok-diagnostics";
import {
  GROWTH_MEMORY_SAMPLE_LIMIT,
  buildOpenAiGrowthMemoryRequestBody,
  normalizeGrowthMemoryResponse,
} from "@/lib/growth-memory";
import { recordAiDiagnostic } from "@/lib/local-db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const GROWTH_MEMORY_TIMEOUT_MS = 45000;
const GROWTH_MEMORY_ENDPOINT = "https://codeproxy.dev/v1/responses";

type MemoryMode = "outbound" | "growth";

type MemoryRequest = {
  mode?: MemoryMode;
  locale?: "zh-CN" | "en";
  profile?: unknown;
  existingMemory?: unknown;
  sampleSummary?: unknown;
  samples?: unknown[];
  apiKey?: string;
  model?: string;
};

function clean(value: unknown) {
  return String(value ?? "").trim();
}

function normalizeMode(value: unknown): MemoryMode {
  return value === "outbound" ? "outbound" : "growth";
}

function errorMessage(value: unknown, fallback: string) {
  if (value && typeof value === "object" && "error" in value) {
    const error = (value as { error?: { message?: unknown } }).error;
    if (typeof error?.message === "string" && error.message.trim()) return error.message;
  }
  return fallback;
}

function saveMemoryDiagnostic(input: Parameters<typeof recordAiDiagnostic>[0]) {
  try {
    const diagnostic = recordAiDiagnostic(input);
    const log = {
      id: diagnostic.id,
      action: input.action,
      durationMs: input.durationMs,
      httpStatus: input.httpStatus ?? null,
      model: input.model,
      outcome: input.outcome,
      errorMessage: input.errorMessage || "",
    };
    if (input.outcome === "success") console.info("[memory-diagnostic]", log);
    else console.error("[memory-diagnostic]", log);
    return diagnostic;
  } catch (error) {
    console.error("Could not save growth-memory diagnostic.", error);
    return null;
  }
}

function responseMetadata(response: Response) {
  return {
    status: response.status,
    statusText: response.statusText,
    headers: Object.fromEntries(response.headers.entries()),
  };
}

function providerFailureDetails(status: number, providerMessage: string, locale: "zh-CN" | "en") {
  const english = locale === "en";
  if (status === 401 || status === 403) {
    return {
      message: english ? `codeproxy rejected the credentials (HTTP ${status}).` : `codeproxy 拒绝了当前密钥或权限（HTTP ${status}）。`,
      suggestion: english ? "Check the API key, account permissions, and model access." : "请检查 API 密钥、账号权限和所选模型是否可用。",
    };
  }
  if (status === 429) {
    return {
      message: english ? "codeproxy rate-limited the request or the account quota is insufficient (HTTP 429)." : "codeproxy 对请求进行了限流，或当前账号额度不足（HTTP 429）。",
      suggestion: english ? "Wait before retrying and check the account quota." : "请稍后重试，并检查中转账号额度。",
    };
  }
  if (status >= 500) {
    return {
      message: english ? `codeproxy returned a server error (HTTP ${status}).` : `codeproxy 返回了服务端错误（HTTP ${status}）。`,
      suggestion: english ? "Retry later. If it persists, inspect the raw response in the diagnostic log." : "请稍后重试；若持续失败，请从完整日志查看原始响应。",
    };
  }
  return {
    message: english ? `codeproxy returned HTTP ${status}.` : `codeproxy 返回 HTTP ${status}。`,
    suggestion: english ? "Inspect the raw provider response in the diagnostic log." : "请从完整日志查看中转服务的原始响应。",
    technicalMessage: providerMessage,
  };
}

function stripJsonFence(value: string) {
  let text = clean(value);
  text = text.replace(/^```(?:json)?\s*/i, "").replace(/```$/i, "").trim();
  const objectStart = text.indexOf("{");
  const objectEnd = text.lastIndexOf("}");
  if (objectStart >= 0 && objectEnd > objectStart) return text.slice(objectStart, objectEnd + 1);
  return text;
}

function parsePossibleJson(value: string) {
  const text = stripJsonFence(value);
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function wordsFromSample(sample: unknown) {
  const source = sample && typeof sample === "object" ? (sample as Record<string, unknown>) : {};
  const tags = Array.isArray(source.tags) ? source.tags.map(clean) : [];
  const text = [source.text, source.reason, source.usedDraft, ...(tags as string[])]
    .map(clean)
    .filter(Boolean)
    .join(" ");

  const stopWords = new Set([
    "the", "and", "for", "with", "this", "that", "you", "your", "are", "not", "but", "from", "about",
    "一个", "这个", "那个", "可以", "需要", "怎么", "如果", "因为", "不是", "没有", "已经", "自己", "用户", "回复",
  ]);

  return text
    .split(/[\s,，。；;、|/()（）\[\]【】"'“”‘’]+/)
    .map((word) => clean(word).replace(/^#/, ""))
    .filter((word) => word.length >= 2 && word.length <= 32 && !/^https?:/i.test(word) && !stopWords.has(word.toLowerCase()));
}

function topKeywords(samples: unknown[], limit: number) {
  const counts = new Map<string, number>();
  for (const sample of samples) {
    for (const word of wordsFromSample(sample)) {
      counts.set(word, (counts.get(word) || 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([word]) => word)
    .slice(0, limit);
}

function feedbackOf(sample: unknown) {
  const source = sample && typeof sample === "object" ? (sample as Record<string, unknown>) : {};
  return clean(source.feedback);
}

function sampleContainsKeyword(sample: unknown, keyword: string) {
  const source = sample && typeof sample === "object" ? (sample as Record<string, unknown>) : {};
  const tags = Array.isArray(source.tags) ? source.tags.map(clean) : [];
  const text = [source.text, source.reason, source.usedDraft, ...tags].map(clean).join(" ").toLowerCase();
  return text.includes(clean(keyword).toLowerCase());
}

function keywordEvidence(samples: unknown[], keyword: string) {
  let positiveEvidence = 0;
  let negativeEvidence = 0;
  for (const sample of samples) {
    if (!sampleContainsKeyword(sample, keyword)) continue;
    const feedback = feedbackOf(sample);
    if (["got_reply", "followed", "reshared"].includes(feedback)) positiveEvidence += 1;
    if (feedback === "no_reply") negativeEvidence += 1;
  }
  const total = positiveEvidence + negativeEvidence;
  return {
    positiveEvidence,
    negativeEvidence,
    confidence: total > 0 ? Math.round(((Math.max(positiveEvidence, negativeEvidence) + 1) / (total + 2)) * 100) : 55,
  };
}

function buildFallbackMemory(payload: { sampleSummary?: unknown; samples?: unknown[] }, locale: "zh-CN" | "en") {
  const samples = Array.isArray(payload.samples) ? payload.samples : [];
  const positiveSamples = samples.filter((sample) => ["got_reply", "followed", "reshared"].includes(feedbackOf(sample)));
  const noReplySamples = samples.filter((sample) => feedbackOf(sample) === "no_reply");
  const effectiveKeywords = topKeywords(positiveSamples.length ? positiveSamples : samples, 8);
  const weakKeywords = topKeywords(noReplySamples, 6).filter((word) => !effectiveKeywords.includes(word));
  const accountRadarKeywords = effectiveKeywords.slice(0, 6);

  const english = locale === "en";

  return {
    summary: positiveSamples.length
      ? english
        ? `From ${samples.length} feedback samples: prioritize topics and pain points with positive outcomes; deprioritize generic terms from no-reply samples.`
        : `已从 ${samples.length} 条反馈样本里提炼：优先放大产生过正反馈的话题和痛点，降低无回复样本里的泛泛关键词。`
      : english
        ? `The current ${samples.length} samples have too little positive feedback. Narrow generic terms using no-reply samples, then collect another batch.`
        : `当前 ${samples.length} 条样本里正反馈不足，先用无回复样本反向收窄关键词，下一轮继续积累。`,
    effectiveKeywords,
    weakKeywords,
    accountRadarKeywords,
    scoreBoostRules: effectiveKeywords.slice(0, 5).map((keyword) => ({
      pattern: keyword,
      reason: english ? "This pattern appeared more often in samples with continued interaction." : "历史反馈样本里更容易产生继续互动，下一轮优先加权。",
      weight: 6,
      ...keywordEvidence(samples, keyword),
    })),
    scorePenaltyRules: weakKeywords.slice(0, 4).map((keyword) => ({
      pattern: keyword,
      reason: english ? "This pattern appeared more often in no-reply samples." : "历史样本里更容易无回复，下一轮先降低优先级。",
      weight: 4,
      ...keywordEvidence(samples, keyword),
    })),
    replyStyleRules: english
      ? ["Lead with one actionable observation.", "Use a question only when it helps continue a relevant conversation.", "Address the stated pain point instead of giving generic agreement."]
      : ["先给一个具体可执行观点。", "只有在有助于继续相关对话时再提问。", "优先围绕对方正在表达的痛点展开，少写泛泛的赞同。"],
    avoidReplyPatterns: english
      ? ["Do not lead with a product pitch or link.", "Avoid emotional agreement without a concrete point.", "Avoid ad-like copy."]
      : ["不要一上来推产品或贴链接。", "避免只有情绪认同，没有具体建议。", "避免把回复写成广告口播。"],
    nextExperiment: english
      ? "Prioritize posts with a concrete pain point and a specific helpful angle. Mark outcomes after each batch, then regenerate learning."
      : "下一轮先优先处理高痛点、可给具体建议的帖子；每处理完一批后继续标记有回复/无回复，再重新生成记忆。",
  };
}

export async function POST(request: Request) {
  let body: MemoryRequest;

  try {
    body = (await request.json()) as MemoryRequest;
  } catch {
    return NextResponse.json({ ok: false, status: "error", message: "请求体不是有效 JSON。" }, { status: 400 });
  }

  const mode = normalizeMode(body.mode);
  const samples = Array.isArray(body.samples) ? body.samples.slice(0, GROWTH_MEMORY_SAMPLE_LIMIT) : [];
  if (samples.length === 0) {
    return NextResponse.json({ ok: false, status: "empty", message: "还没有可学习的反馈样本。先在互动队列里标记有回复、无回复、被关注或被转发。" }, { status: 400 });
  }

  const apiKey = clean(body.apiKey) || process.env.CODEPROXY_API_KEY?.trim();
  if (!apiKey) {
    return NextResponse.json(
      {
        ok: false,
        configured: false,
        status: "missing_key",
        message: "请先在设置页配置 GPT-5.5 / codeproxy 密钥，再生成增长记忆。",
      },
      { status: 400 }
    );
  }

  const model = clean(body.model) || process.env.CODEPROXY_MEMORY_MODEL?.trim() || process.env.CODEPROXY_AI_MODEL?.trim() || "gpt-5.5";
  const locale: "zh-CN" | "en" = body.locale === "en" ? "en" : "zh-CN";
  const payload = {
    mode,
    locale,
    profile: body.profile,
    existingMemory: body.existingMemory,
    sampleSummary: body.sampleSummary,
    samples,
  };
  const upstreamRequest = buildOpenAiGrowthMemoryRequestBody({ model, payload });
  const requestBody = JSON.stringify(upstreamRequest);
  const startedAt = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), GROWTH_MEMORY_TIMEOUT_MS);

  let response: Response;
  let responseJson: unknown = {};
  let responseBody = "";

  try {
    response = await fetch(GROWTH_MEMORY_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: requestBody,
      signal: controller.signal,
    });
    responseBody = await response.text();
    if (responseBody.trim()) {
      try {
        responseJson = JSON.parse(responseBody) as unknown;
      } catch {}
    }
  } catch (error) {
    const failure = classifyGrokRequestFailure(error, { locale, timeoutMs: GROWTH_MEMORY_TIMEOUT_MS });
    const failureMessage = failure.message
      .replace("Grok result", "growth-memory result")
      .replace("Grok 结果", "增长记忆结果");
    const diagnostic = saveMemoryDiagnostic({
      action: "memory",
      durationMs: Date.now() - startedAt,
      httpStatus: null,
      model,
      outcome: failure.outcome,
      requestBody,
      responseBody,
      responseShape: {
        request: {
          url: GROWTH_MEMORY_ENDPOINT,
          method: "POST",
          headers: { authorization: "[REDACTED]", "content-type": "application/json" },
          timeoutMs: GROWTH_MEMORY_TIMEOUT_MS,
        },
        response: null,
        errorChain: failure.errorChain,
      },
      errorMessage: `${failureMessage} ${failure.technicalMessage}`,
    });
    return NextResponse.json(
      {
        ok: false,
        configured: true,
        status: failure.status,
        diagnosticId: diagnostic?.id,
        message: failureMessage,
        technicalMessage: failure.technicalMessage,
        suggestion: failure.suggestion,
        retryable: failure.retryable,
      },
      { status: failure.status === "upstream_timeout" ? 504 : 502 }
    );
  } finally {
    clearTimeout(timeout);
  }

  const responseShape = {
    request: {
      url: GROWTH_MEMORY_ENDPOINT,
      method: "POST",
      headers: { authorization: "[REDACTED]", "content-type": "application/json" },
      timeoutMs: GROWTH_MEMORY_TIMEOUT_MS,
    },
    response: responseMetadata(response),
  };

  if (!response.ok) {
    const providerMessage = errorMessage(responseJson, responseBody.trim() || "codeproxy growth-memory endpoint returned an error.");
    const failure = providerFailureDetails(response.status, providerMessage, locale);
    const diagnostic = saveMemoryDiagnostic({
      action: "memory",
      durationMs: Date.now() - startedAt,
      httpStatus: response.status,
      model,
      outcome: "provider_error",
      requestBody,
      responseBody,
      responseShape,
      errorMessage: providerMessage,
    });
    return NextResponse.json(
      {
        ok: false,
        configured: true,
        status: "codeproxy_error",
        diagnosticId: diagnostic?.id,
        message: failure.message,
        technicalMessage: failure.technicalMessage || providerMessage,
        suggestion: failure.suggestion,
        retryable: response.status === 429 || response.status >= 500,
      },
      { status: response.status }
    );
  }

  const outputText = extractResponseOutputText(responseJson);
  const parsed = outputText ? parsePossibleJson(outputText) : null;
  const memorySource = parsed && typeof parsed === "object" ? parsed : buildFallbackMemory(payload, payload.locale);
  const memory = normalizeGrowthMemoryResponse(memorySource, payload);
  const diagnostic = saveMemoryDiagnostic({
    action: "memory",
    durationMs: Date.now() - startedAt,
    httpStatus: response.status,
    model,
    outcome: parsed ? "success" : "fallback",
    requestBody,
    responseBody,
    responseShape,
    errorMessage: parsed ? "" : "The provider response did not contain a parseable growth-memory JSON object; local fallback was used.",
  });

  return NextResponse.json({
    ok: true,
    configured: true,
    diagnosticId: diagnostic?.id,
    model: parsed ? model : `${model} / 本地兜底`,
    message: parsed ? undefined : "AI 返回格式不标准，已用当前反馈样本生成本地增长记忆。",
    memory,
  });
}
