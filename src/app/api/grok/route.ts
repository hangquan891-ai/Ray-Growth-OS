import { NextResponse } from "next/server";

import { buildCodeProxyMessageRequest, buildStructuredGrokSignalPrompt, buildXProfilePullPrompt, extractCodeProxyMessageText, extractXUsername } from "@/lib/codeproxy-grok";
import { formatSignalsAsLeadInput, parseStructuredSignalsFromText } from "@/lib/signals";
import { openGrokBridge } from "@/lib/grok-bridge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type GrokRequest = {
  action?: "open" | "search" | "proxy-search" | "profile-pull";
  apiKey?: string;
  model?: string;
  prompt?: string;
  profileUrl?: string;
};

function apiErrorMessage(value: unknown, fallback: string) {
  if (value && typeof value === "object") {
    const error = (value as { error?: { message?: unknown }; message?: unknown }).error;
    if (typeof error?.message === "string" && error.message.trim()) return error.message;
    const message = (value as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) return message;
  }
  return fallback;
}
type PublicXProfileSnapshot = {
  username: string;
  text: string;
  sources: string[];
  warnings: string[];
};

const PUBLIC_X_FETCH_TIMEOUT_MS = 10000;
const PUBLIC_X_READER_TEXT_LIMIT = 6000;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function textField(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function numberField(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function compactLines(lines: string[]) {
  return lines.map((line) => line.trim()).filter(Boolean).join("\n");
}

function clampProfileText(value: string, limit = PUBLIC_X_READER_TEXT_LIMIT) {
  const normalized = value
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");

  return normalized.length > limit ? `${normalized.slice(0, limit)}\n...（已截断）` : normalized;
}

function previewProfileText(value: string) {
  return clampProfileText(value, 900);
}

async function fetchWithTimeout(url: string, init: RequestInit = {}, timeoutMs = PUBLIC_X_FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchPublicXProfileSnapshot(profileUrl: string): Promise<PublicXProfileSnapshot> {
  const username = extractXUsername(profileUrl);
  const sources: string[] = [];
  const warnings: string[] = [];
  const blocks: string[] = [];

  if (!username) {
    return { username: "", text: "", sources, warnings: ["没有识别到有效的 X 用户名。"] };
  }

  const encodedUsername = encodeURIComponent(username);
  const profileMirrorUrl = `https://api.fxtwitter.com/${encodedUsername}`;

  try {
    const response = await fetchWithTimeout(profileMirrorUrl, {
      headers: { Accept: "application/json", "User-Agent": "RayGrowthOS/1.0" },
      cache: "no-store",
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const data = asRecord(await response.json().catch(() => ({})));
    const user = asRecord(data.user);
    if (Object.keys(user).length > 0) {
      const rawDescription = asRecord(user.raw_description);
      const screenName = textField(user.screen_name) || username;
      const name = textField(user.name);
      const description = textField(rawDescription.text) || textField(user.description);
      const followers = numberField(user.followers);
      const following = numberField(user.following);
      const tweets = numberField(user.tweets);
      const likes = numberField(user.likes);
      const mediaCount = numberField(user.media_count);
      const joined = textField(user.joined);
      const location = textField(user.location);
      const website = textField(user.website);
      const protectedValue = typeof user.protected === "boolean" ? user.protected : null;
      const verification = asRecord(user.verification);
      const verifiedType = textField(verification.type);

      blocks.push(
        `公开账号资料：\n${compactLines([
          `主页: https://x.com/${screenName}`,
          `账号: @${screenName}`,
          name ? `名称: ${name}` : "",
          description ? `简介: ${description.replace(/\r?\n/g, " / ")}` : "",
          location ? `位置: ${location}` : "",
          website ? `网站: ${website}` : "",
          followers !== null ? `关注者: ${followers}` : "",
          following !== null ? `正在关注: ${following}` : "",
          tweets !== null ? `公开推文数: ${tweets}` : "",
          likes !== null ? `点赞数: ${likes}` : "",
          mediaCount !== null ? `媒体数: ${mediaCount}` : "",
          joined ? `加入时间: ${joined}` : "",
          protectedValue !== null ? `是否保护账号: ${protectedValue ? "是" : "否"}` : "",
          verifiedType ? `认证类型: ${verifiedType}` : "",
        ])}`
      );
      sources.push("api.fxtwitter.com 公开账号资料");
    }
  } catch (error) {
    warnings.push(error instanceof Error ? `公开账号资料读取失败：${error.message}` : "公开账号资料读取失败。");
  }

  const readerUrl = `https://r.jina.ai/http://r.jina.ai/http://https://x.com/${encodedUsername}`;
  try {
    const response = await fetchWithTimeout(readerUrl, {
      headers: { Accept: "text/plain", "User-Agent": "RayGrowthOS/1.0" },
      cache: "no-store",
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const readerText = clampProfileText(await response.text());
    if (readerText) {
      blocks.push(`公开页面文本摘录：\n${readerText}`);
      sources.push("r.jina.ai 公开页面文本");
    }
  } catch (error) {
    warnings.push(error instanceof Error ? `公开页面文本读取失败：${error.message}` : "公开页面文本读取失败。");
  }

  return {
    username,
    text: blocks.join("\n\n").trim(),
    sources,
    warnings: warnings.slice(0, 3),
  };
}

export async function POST(request: Request) {
  let body: GrokRequest;

  try {
    body = (await request.json()) as GrokRequest;
  } catch {
    return NextResponse.json({ ok: false, status: "error", message: "请求体不是有效 JSON。" }, { status: 400 });
  }

  if (body.action === "open") {
    const result = await openGrokBridge();
    return NextResponse.json(result, { status: result.ok ? 200 : 500 });
  }

  if (body.action === "search") {
    const prompt = String(body.prompt ?? "").trim();
    if (!prompt) {
      return NextResponse.json({ ok: false, status: "error", message: "Prompt 不能为空。" }, { status: 400 });
    }
    if (prompt.length > 8000) {
      return NextResponse.json({ ok: false, status: "error", message: "Prompt 太长，请控制在 8000 字以内。" }, { status: 400 });
    }

    const result = await openGrokBridge(prompt);
    return NextResponse.json(result, { status: result.ok ? 200 : 500 });
  }

  if (body.action === "proxy-search" || body.action === "profile-pull") {
    let prompt = String(body.prompt ?? "").trim();
    const apiKey = String(body.apiKey ?? "").trim();
    const model = String(body.model ?? "").trim();

    if (!apiKey) {
      return NextResponse.json({ ok: false, status: "missing_key", message: "请先配置 codeproxy / Grok 中转密钥。" }, { status: 400 });
    }
    if (!prompt) {
      return NextResponse.json({ ok: false, status: "error", message: "Prompt 不能为空。" }, { status: 400 });
    }

    let pulledProfile: PublicXProfileSnapshot | null = null;

    if (body.action === "profile-pull") {
      const profileUrl = String(body.profileUrl ?? "").trim();
      if (!profileUrl) {
        return NextResponse.json({ ok: false, status: "error", message: "请先填写要分析的竞品、KOL 或目标用户 X 账号。" }, { status: 400 });
      }

      pulledProfile = await fetchPublicXProfileSnapshot(profileUrl);
      if (!pulledProfile.text) {
        return NextResponse.json(
          {
            ok: false,
            status: "profile_fetch_failed",
            message: "账号雷达没有读取到可用的公开 X 数据。请检查账号地址是否正确，或稍后再试。",
            pulledProfile,
          },
          { status: 502 }
        );
      }

      prompt = buildXProfilePullPrompt({ profileUrl, contextPrompt: prompt, profileSnapshot: pulledProfile.text });
    }

    if (prompt.length > 14000) {
      return NextResponse.json({ ok: false, status: "error", message: "Prompt 太长，请控制在 14000 字以内。" }, { status: 400 });
    }

    const structuredPrompt = buildStructuredGrokSignalPrompt(prompt);
    const proxyRequest = buildCodeProxyMessageRequest({ prompt: structuredPrompt, model });
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60000);
    let response: Response;
    let responseJson: unknown;

    try {
      response = await fetch(proxyRequest.url, {
        method: "POST",
        headers: {
          ...proxyRequest.headers,
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(proxyRequest.body),
        signal: controller.signal,
      });
      responseJson = await response.json().catch(() => ({}));
    } catch (error) {
      clearTimeout(timeout);
      return NextResponse.json(
        {
          ok: false,
          status: "request_failed",
          message: error instanceof Error ? error.message : "codeproxy 中转请求失败。",
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
          status: "proxy_error",
          message: apiErrorMessage(responseJson, "codeproxy 中转接口返回错误。"),
        },
        { status: response.status }
      );
    }

    const text = extractCodeProxyMessageText(responseJson);
    if (!text) {
      return NextResponse.json({ ok: false, status: "empty_output", message: "codeproxy 没有返回可导入的文本结果。" }, { status: 502 });
    }

    const structuredResult = parseStructuredSignalsFromText(text, { source: "grok" }) as {
      ok?: boolean;
      signals?: unknown[];
      accountRadar?: unknown;
      error?: string;
    };
    const signals = Array.isArray(structuredResult.signals) ? structuredResult.signals : [];
    const formattedText = signals.length > 0 ? formatSignalsAsLeadInput(signals) : text;

    return NextResponse.json({
      ok: true,
      status: "success",
      model: proxyRequest.body.model,
      text: formattedText,
      rawText: text,
      structured: signals.length > 0,
      signals,
      accountRadar: structuredResult.accountRadar ?? null,
      parseError: signals.length > 0 ? "" : structuredResult.error || "",
      pulledProfile: pulledProfile
        ? {
            username: pulledProfile.username,
            sources: pulledProfile.sources,
            warnings: pulledProfile.warnings,
            textLength: pulledProfile.text.length,
            preview: previewProfileText(pulledProfile.text),
          }
        : null,
    });
  }

  return NextResponse.json({ ok: false, status: "error", message: "未知 action。" }, { status: 400 });
}
