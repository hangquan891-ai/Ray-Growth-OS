import { NextResponse } from "next/server";

import { extractResponseOutputText } from "@/lib/llm-scoring";
import {
  GROWTH_MEMORY_SAMPLE_LIMIT,
  buildOpenAiGrowthMemoryRequestBody,
  normalizeGrowthMemoryResponse,
} from "@/lib/growth-memory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type MemoryMode = "outbound" | "growth";

type MemoryRequest = {
  mode?: MemoryMode;
  profile?: unknown;
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

function buildFallbackMemory(payload: { sampleSummary?: unknown; samples?: unknown[] }) {
  const samples = Array.isArray(payload.samples) ? payload.samples : [];
  const positiveSamples = samples.filter((sample) => ["got_reply", "followed", "reshared"].includes(feedbackOf(sample)));
  const noReplySamples = samples.filter((sample) => feedbackOf(sample) === "no_reply");
  const effectiveKeywords = topKeywords(positiveSamples.length ? positiveSamples : samples, 8);
  const weakKeywords = topKeywords(noReplySamples, 6).filter((word) => !effectiveKeywords.includes(word));
  const accountRadarKeywords = effectiveKeywords.slice(0, 6);

  return {
    summary: positiveSamples.length
      ? `已从 ${samples.length} 条反馈样本里提炼：优先放大产生过正反馈的话题和痛点，降低无回复样本里的泛泛关键词。`
      : `当前 ${samples.length} 条样本里正反馈不足，先用无回复样本反向收窄关键词，下一轮继续积累。`,
    effectiveKeywords,
    weakKeywords,
    accountRadarKeywords,
    scoreBoostRules: effectiveKeywords.slice(0, 5).map((keyword) => ({
      pattern: keyword,
      reason: "历史反馈样本里更容易产生继续互动，下一轮优先加权。",
      weight: 6,
    })),
    scorePenaltyRules: weakKeywords.slice(0, 4).map((keyword) => ({
      pattern: keyword,
      reason: "历史样本里更容易无回复，下一轮先降低优先级。",
      weight: 4,
    })),
    replyStyleRules: [
      "先给一个具体可执行观点，再自然说明自己的相关经验或产品背景。",
      "回复里保留提问或轻量下一步，目标是继续对话，不是直接硬卖。",
      "优先围绕对方正在表达的痛点展开，少写泛泛的赞同。",
    ],
    avoidReplyPatterns: [
      "不要一上来推产品或贴链接。",
      "避免只有情绪认同，没有具体建议。",
      "避免把回复写成广告口播。",
    ],
    nextExperiment: "下一轮先优先处理高痛点、可给具体建议的帖子；每处理完一批后继续标记有回复/无回复，再重新生成记忆。",
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
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45000);

  let response: Response;
  let responseJson: unknown;
  const payload = {
    mode,
    profile: body.profile,
    sampleSummary: body.sampleSummary,
    samples,
  };

  try {
    response = await fetch("https://codeproxy.dev/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(buildOpenAiGrowthMemoryRequestBody({ model, payload })),
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
        message: error instanceof Error ? error.message : "增长记忆生成请求失败。",
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
        message: errorMessage(responseJson, "codeproxy GPT-5.5 增长记忆接口返回错误。"),
      },
      { status: response.status }
    );
  }

  const outputText = extractResponseOutputText(responseJson);
  const parsed = outputText ? parsePossibleJson(outputText) : null;
  const memorySource = parsed && typeof parsed === "object" ? parsed : buildFallbackMemory(payload);
  const memory = normalizeGrowthMemoryResponse(memorySource, payload);

  return NextResponse.json({
    ok: true,
    configured: true,
    model: parsed ? model : `${model} / 本地兜底`,
    message: parsed ? undefined : "AI 返回格式不标准，已用当前反馈样本生成本地增长记忆。",
    memory,
  });
}