import { NextResponse } from "next/server";

import { buildCodeProxyMessageRequest, buildStructuredGrokSignalPrompt, buildXProfilePullPrompt, extractCodeProxyMessageText, extractXUsername } from "@/lib/codeproxy-grok";
import { formatSignalsAsLeadInput, parseStructuredSignalsFromText } from "@/lib/signals";
import { openGrokBridge } from "@/lib/grok-bridge";
import { classifyGrokRequestFailure } from "@/lib/grok-diagnostics";
import { recordAiDiagnostic } from "@/lib/local-db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type GrokRequest = {
  action?: "open" | "search" | "proxy-search" | "profile-pull";
  locale?: "zh-CN" | "en";
  apiKey?: string;
  model?: string;
  endpoint?: string;
  prompt?: string;
  profileUrl?: string;
};

const GROK_PROXY_TIMEOUT_MS = 90000;

function saveGrokDiagnostic(input: Parameters<typeof recordAiDiagnostic>[0]) {
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
    if (input.outcome === "success") console.info("[grok-diagnostic]", log);
    else console.error("[grok-diagnostic]", log);
    return diagnostic;
  } catch (error) {
    console.error("Could not save Grok diagnostic.", error);
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

function providerFailureDetails(status: number, providerMessage: string, locale?: "zh-CN" | "en") {
  const english = locale === "en";
  if (status === 401 || status === 403) {
    return {
      message: english ? `codeproxy rejected the credentials (HTTP ${status}).` : `codeproxy 拒绝了当前密钥或权限（HTTP ${status}）。`,
      suggestion: english ? "Check the API key, account permissions, and whether the selected model is available." : "请检查 API 密钥、账号权限，以及当前账号是否能使用所选模型。",
    };
  }
  if (status === 404) {
    return {
      message: english ? "The codeproxy endpoint or selected model was not found (HTTP 404)." : "codeproxy 没有找到当前接口或所选模型（HTTP 404）。",
      suggestion: english ? "Check the configured model name and proxy service compatibility." : "请检查设置中的模型名称，以及中转服务是否支持该接口。",
    };
  }
  if (status === 429) {
    return {
      message: english ? "codeproxy rate-limited the request or the account has insufficient quota (HTTP 429)." : "codeproxy 对请求进行了限流，或当前账号额度不足（HTTP 429）。",
      suggestion: english ? "Wait before retrying and check account quota." : "请稍后重试，并检查中转账号额度。",
    };
  }
  if (status >= 500) {
    return {
      message: english ? `codeproxy returned a server error (HTTP ${status}).` : `codeproxy 返回了服务端错误（HTTP ${status}）。`,
      suggestion: english ? "The upstream service may be temporarily unavailable. Retry later and use the log ID if it persists." : "上游服务可能暂时不可用；稍后重试，若持续失败请根据日志编号排查。",
    };
  }
  return {
    message: english ? `codeproxy returned HTTP ${status}: ${providerMessage}` : `codeproxy 返回 HTTP ${status}：${providerMessage}`,
    suggestion: english ? "Review the full response in the diagnostic log." : "请在完整诊断日志中查看上游原始响应。",
  };
}

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

      const profileFetchStartedAt = Date.now();
      pulledProfile = await fetchPublicXProfileSnapshot(profileUrl);
      if (!pulledProfile.text) {
        const technicalMessage = pulledProfile.warnings.join(" | ") || "Public X profile sources returned no readable content.";
        const diagnostic = saveGrokDiagnostic({
          action: "grok",
          durationMs: Date.now() - profileFetchStartedAt,
          httpStatus: null,
          model,
          outcome: "profile_fetch_failed",
          requestBody: JSON.stringify({ action: body.action, model, profileUrl, prompt }),
          responseBody: "",
          responseShape: { pulledProfile },
          errorMessage: technicalMessage,
        });
        return NextResponse.json(
          {
            ok: false,
            status: "profile_fetch_failed",
            diagnosticId: diagnostic?.id,
            message: "竞品洞察没有读取到可用的公开 X 数据。请检查账号地址是否正确，或稍后再试。",
            technicalMessage,
            suggestion: "请确认账号是公开账号且地址正确；完整的公开数据源失败原因已写入本机日志。",
            retryable: true,
            pulledProfile,
          },
          { status: 502 }
        );
      }

      prompt = buildXProfilePullPrompt({ profileUrl, contextPrompt: prompt, profileSnapshot: pulledProfile.text, locale: body.locale });
    }

    if (prompt.length > 14000) {
      return NextResponse.json({ ok: false, status: "error", message: "Prompt 太长，请控制在 14000 字以内。" }, { status: 400 });
    }

    const structuredPrompt = buildStructuredGrokSignalPrompt(prompt, body.locale);
    const proxyRequest = buildCodeProxyMessageRequest({ prompt: structuredPrompt, model, endpoint: body.endpoint ?? process.env.CODEPROXY_GROK_ENDPOINT });
    const requestBody = JSON.stringify(proxyRequest.body);
    const startedAt = Date.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), GROK_PROXY_TIMEOUT_MS);
    let response: Response;
    let responseJson: unknown = {};
    let responseBody = "";

    try {
      response = await fetch(proxyRequest.url, {
        method: "POST",
        headers: {
          ...proxyRequest.headers,
          Authorization: `Bearer ${apiKey}`,
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
      const failure = classifyGrokRequestFailure(error, { locale: body.locale, timeoutMs: GROK_PROXY_TIMEOUT_MS });
      const diagnostic = saveGrokDiagnostic({
        action: "grok",
        durationMs: Date.now() - startedAt,
        httpStatus: null,
        model: proxyRequest.body.model,
        outcome: failure.outcome,
        requestBody,
        responseBody,
        responseShape: {
          request: {
            url: proxyRequest.url,
            method: "POST",
            headers: { ...proxyRequest.headers, authorization: "[REDACTED]" },
            timeoutMs: GROK_PROXY_TIMEOUT_MS,
          },
          response: null,
          errorChain: failure.errorChain,
        },
        errorMessage: `${failure.message} ${failure.technicalMessage}`,
      });
      return NextResponse.json(
        {
          ok: false,
          status: failure.status,
          diagnosticId: diagnostic?.id,
          message: failure.message,
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
        url: proxyRequest.url,
        method: "POST",
        headers: { ...proxyRequest.headers, authorization: "[REDACTED]" },
        timeoutMs: GROK_PROXY_TIMEOUT_MS,
      },
      response: responseMetadata(response),
    };

    if (!response.ok) {
      const providerMessage = apiErrorMessage(responseJson, responseBody.trim() || "codeproxy 中转接口返回错误。");
      const failure = providerFailureDetails(response.status, providerMessage, body.locale);
      const diagnostic = saveGrokDiagnostic({
        action: "grok",
        durationMs: Date.now() - startedAt,
        httpStatus: response.status,
        model: proxyRequest.body.model,
        outcome: "provider_error",
        requestBody,
        responseBody,
        responseShape,
        errorMessage: providerMessage,
      });
      return NextResponse.json(
        {
          ok: false,
          status: "proxy_error",
          diagnosticId: diagnostic?.id,
          message: failure.message,
          technicalMessage: providerMessage,
          suggestion: failure.suggestion,
          retryable: response.status === 429 || response.status >= 500,
        },
        { status: response.status }
      );
    }

    const text = extractCodeProxyMessageText(responseJson);
    if (!text) {
      const message = body.locale === "en" ? "codeproxy returned a successful HTTP response but no readable Grok text." : "codeproxy 返回了成功的 HTTP 状态，但响应中没有可读取的 Grok 文本。";
      const suggestion = body.locale === "en" ? "Review the raw response in the diagnostic log and verify model compatibility." : "请根据日志编号查看原始响应，并检查当前模型是否兼容此接口。";
      const diagnostic = saveGrokDiagnostic({
        action: "grok",
        durationMs: Date.now() - startedAt,
        httpStatus: response.status,
        model: proxyRequest.body.model,
        outcome: "empty_output",
        requestBody,
        responseBody,
        responseShape,
        errorMessage: "extractCodeProxyMessageText returned an empty string.",
      });
      return NextResponse.json(
        { ok: false, status: "empty_output", diagnosticId: diagnostic?.id, message, technicalMessage: "extractCodeProxyMessageText returned an empty string.", suggestion, retryable: true },
        { status: 502 }
      );
    }

    const structuredResult = parseStructuredSignalsFromText(text, { source: "grok" }) as {
      ok?: boolean;
      signals?: unknown[];
      accountRadar?: unknown;
      error?: string;
    };
    const signals = Array.isArray(structuredResult.signals) ? structuredResult.signals : [];
    if (signals.length === 0) {
      const parseError = structuredResult.error || "No importable signals were found.";
      const message = body.locale === "en" ? "Grok returned content, but no importable signals could be parsed." : "Grok 已返回内容，但没有解析出任何可导入的互动线索。";
      const suggestion = body.locale === "en" ? "Review the raw response in the log. Retry if the model did not follow the required JSON format." : "请根据日志编号查看模型原始响应；如果模型没有按要求返回 JSON，可重新查询。";
      const diagnostic = saveGrokDiagnostic({
        action: "grok",
        durationMs: Date.now() - startedAt,
        httpStatus: response.status,
        model: proxyRequest.body.model,
        outcome: "no_importable_signals",
        requestBody,
        responseBody,
        responseShape: { ...responseShape, parser: { error: parseError, textLength: text.length } },
        errorMessage: parseError,
      });
      return NextResponse.json(
        {
          ok: false,
          status: "no_importable_signals",
          diagnosticId: diagnostic?.id,
          message,
          technicalMessage: parseError,
          suggestion,
          retryable: true,
        },
        { status: 422 }
      );
    }

    const formattedText = formatSignalsAsLeadInput(signals);
    const diagnostic = saveGrokDiagnostic({
      action: "grok",
      durationMs: Date.now() - startedAt,
      httpStatus: response.status,
      model: proxyRequest.body.model,
      outcome: "success",
      requestBody,
      responseBody,
      responseShape: { ...responseShape, parser: { signalCount: signals.length, textLength: text.length } },
    });

    return NextResponse.json({
      ok: true,
      status: "success",
      diagnosticId: diagnostic?.id,
      model: proxyRequest.body.model,
      text: formattedText,
      rawText: text,
      structured: true,
      signals,
      accountRadar: structuredResult.accountRadar ?? null,
      parseError: "",
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
