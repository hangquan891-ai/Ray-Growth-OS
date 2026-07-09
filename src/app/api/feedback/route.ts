import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type FeedbackStatus = "none" | "got_reply" | "no_reply" | "followed" | "reshared";
type ExecutionStatus = "new" | "replied" | "quoted" | "saved" | "deferred" | "skipped";

type FeedbackPullItem = {
  itemId?: string;
  platform?: string;
  name?: string;
  url?: string;
  sourceUrl?: string;
  replyUrl?: string;
  note?: string;
  status?: ExecutionStatus;
};

type FeedbackPullRequest = {
  mode?: "outbound" | "growth";
  items?: FeedbackPullItem[];
  selfProfileUrl?: string;
  selfUsername?: string;
};

type TweetMetrics = {
  replies: number | null;
  reposts: number | null;
  quotes: number | null;
  likes: number | null;
};

const FEEDBACK_PULL_LIMIT = 10;
const PUBLIC_X_FETCH_TIMEOUT_MS = 10000;

function clean(value: unknown) {
  return String(value ?? "").trim();
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function numeric(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const normalized = value.replace(/,/g, "").trim().toLowerCase();
    const multiplier = normalized.endsWith("k") ? 1000 : normalized.endsWith("m") ? 1000000 : 1;
    const parsed = Number(normalized.replace(/[km]$/, ""));
    return Number.isFinite(parsed) ? Math.round(parsed * multiplier) : null;
  }
  return null;
}

function normalizeXUsername(value: unknown) {
  return clean(value).replace(/^@/, "").toLowerCase();
}

function extractXUsername(rawValue: string) {
  const value = clean(rawValue);
  if (!value) return "";

  try {
    const normalizedInput = /^https?:\/\//i.test(value) ? value : `https://x.com/${value.replace(/^@/, "")}`;
    const url = new URL(normalizedInput);
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    if (host !== "x.com" && host !== "twitter.com") return "";
    const [username] = url.pathname.split("/").filter(Boolean);
    if (!username || ["home", "explore", "search", "i", "settings"].includes(username.toLowerCase())) return "";
    return normalizeXUsername(username);
  } catch {
    const match = value.match(/(?:x\.com|twitter\.com)\/([^/\s?#]+)/i);
    return normalizeXUsername(match?.[1] || value);
  }
}

function resolveSelfUsername(body: FeedbackPullRequest) {
  return normalizeXUsername(body.selfUsername) || extractXUsername(clean(body.selfProfileUrl));
}

function extractXStatusInfo(rawUrl: string) {
  const value = clean(rawUrl);
  if (!value) return { username: "", statusId: "", normalizedUrl: "" };

  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    if (host !== "x.com" && host !== "twitter.com") return { username: "", statusId: "", normalizedUrl: value };
    const parts = url.pathname.split("/").filter(Boolean);
    const statusIndex = parts.findIndex((part) => part === "status" || part === "statuses");
    const username = statusIndex > 0 ? parts[0] : "";
    const statusId = statusIndex >= 0 ? parts[statusIndex + 1] || "" : "";
    return {
      username,
      statusId: /^\d+$/.test(statusId) ? statusId : "",
      normalizedUrl: username && statusId ? `https://x.com/${username}/status/${statusId}` : value,
    };
  } catch {
    const match = value.match(/(?:x\.com|twitter\.com)\/([^/\s]+)\/status(?:es)?\/(\d+)/i);
    return match ? { username: match[1], statusId: match[2], normalizedUrl: `https://x.com/${match[1]}/status/${match[2]}` } : { username: "", statusId: "", normalizedUrl: value };
  }
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

function metricFrom(records: Array<Record<string, unknown>>, keys: string[]) {
  for (const record of records) {
    for (const key of keys) {
      const parsed = numeric(record[key]);
      if (parsed !== null) return parsed;
    }
  }
  return null;
}

function extractTweetRecord(data: unknown) {
  const root = asRecord(data);
  const dataRecord = asRecord(root.data);
  return asRecord(root.tweet) || asRecord(root.status) || asRecord(dataRecord.tweet) || asRecord(dataRecord.status) || root;
}

function extractMetrics(data: unknown): TweetMetrics {
  const tweet = extractTweetRecord(data);
  const records = [tweet, asRecord(tweet.stats), asRecord(tweet.counts), asRecord(tweet.public_metrics)];

  return {
    replies: metricFrom(records, ["reply_count", "replies", "replies_count", "conversation_count"]),
    reposts: metricFrom(records, ["retweet_count", "retweets", "repost_count", "reposts", "shares", "share_count"]),
    quotes: metricFrom(records, ["quote_count", "quotes", "quote_tweet_count", "quote_tweets"]),
    likes: metricFrom(records, ["like_count", "likes", "favorite_count", "favorites"]),
  };
}

async function fetchTweetMetrics(username: string, statusId: string) {
  const urls = [
    username ? `https://api.fxtwitter.com/${encodeURIComponent(username)}/status/${encodeURIComponent(statusId)}` : "",
    `https://api.fxtwitter.com/status/${encodeURIComponent(statusId)}`,
  ].filter(Boolean);
  const warnings: string[] = [];

  for (const url of urls) {
    try {
      const response = await fetchWithTimeout(url, {
        headers: { Accept: "application/json", "User-Agent": "RayGrowthOS/1.0" },
        cache: "no-store",
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json().catch(() => ({}));
      return { metrics: extractMetrics(data), source: "api.fxtwitter.com", warnings };
    } catch (error) {
      warnings.push(error instanceof Error ? error.message : "公开数据读取失败");
    }
  }

  return { metrics: { replies: null, reposts: null, quotes: null, likes: null }, source: "", warnings: warnings.slice(0, 2) };
}

function classifyFeedback(metrics: TweetMetrics): { feedback: FeedbackStatus; confidence: number; reason: string } {
  const replies = metrics.replies ?? 0;
  const reposts = metrics.reposts ?? 0;
  const quotes = metrics.quotes ?? 0;

  if (replies > 0) {
    return { feedback: "got_reply", confidence: 84, reason: `你的回复链接公开数据里看到 ${replies} 条回复。` };
  }
  if (quotes + reposts > 0) {
    return { feedback: "reshared", confidence: 76, reason: `你的回复链接公开数据里看到 ${quotes + reposts} 次引用/转发。` };
  }

  return { feedback: "no_reply", confidence: 68, reason: "这条回复暂时没有看到别人继续回复，先按无回复记录。" };
}

function apiError(message: string, status = 400) {
  return NextResponse.json({ ok: false, status: "error", message }, { status });
}

export async function POST(request: Request) {
  let body: FeedbackPullRequest;

  try {
    body = (await request.json()) as FeedbackPullRequest;
  } catch {
    return apiError("请求体不是有效 JSON。");
  }

  const mode = body.mode === "outbound" ? "outbound" : "growth";
  const items = Array.isArray(body.items) ? body.items.slice(0, FEEDBACK_PULL_LIMIT) : [];
  if (items.length === 0) return apiError("请先勾选要自动拉取反馈的条目。");

  const selfUsername = resolveSelfUsername(body);
  const checkedAt = new Date().toISOString();
  const results = [];

  for (const item of items) {
    const itemId = clean(item.itemId);
    const trackedUrl = clean(item.replyUrl);
    const { username, statusId, normalizedUrl } = extractXStatusInfo(trackedUrl);
    const normalizedTweetUsername = normalizeXUsername(username);

    if (!itemId || !statusId) {
      results.push({
        itemId,
        skipped: true,
        feedback: "none",
        status: item.status || "new",
        checkedAt,
        confidence: 0,
        reason: "这条还没有保存你的回复链接，无法自动拉取反馈。请先从 App 打开原帖并在 X 回复，让插件记录 replyUrl。",
        url: normalizedUrl || trackedUrl,
      });
      continue;
    }

    if (!selfUsername) {
      results.push({
        itemId,
        skipped: true,
        feedback: "none",
        status: item.status || "new",
        checkedAt,
        confidence: 0,
        reason: "请先在设置里保存你的 X 主页地址，用来判断哪些链接是你的回复。",
        url: normalizedUrl,
      });
      continue;
    }

    if (normalizedTweetUsername !== selfUsername) {
      results.push({
        itemId,
        skipped: true,
        feedback: "none",
        status: item.status || "new",
        checkedAt,
        confidence: 0,
        reason: `当前链接属于 @${normalizedTweetUsername || "unknown"}，不是你的回复链接 @${selfUsername}，为避免误判已跳过。`,
        url: normalizedUrl,
      });
      continue;
    }

    const pulled = await fetchTweetMetrics(username, statusId);
    if (!pulled.source) {
      results.push({
        itemId,
        skipped: true,
        feedback: "none",
        status: item.status || "new",
        checkedAt,
        confidence: 0,
        reason: `公开 X 数据读取失败：${pulled.warnings.join("；") || "未知错误"}`,
        url: normalizedUrl,
      });
      continue;
    }

    const classification = classifyFeedback(pulled.metrics);
    results.push({
      itemId,
      skipped: false,
      feedback: classification.feedback,
      status: item.status || "new",
      checkedAt,
      confidence: classification.confidence,
      reason: classification.reason,
      metrics: pulled.metrics,
      source: pulled.source,
      url: normalizedUrl,
    });
  }

  const updatedCount = results.filter((result) => !result.skipped && result.feedback !== "none").length;
  const skippedCount = results.length - updatedCount;

  return NextResponse.json({
    ok: true,
    mode,
    checkedAt,
    updatedCount,
    skippedCount,
    results,
  });
}