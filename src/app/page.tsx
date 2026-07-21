"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type MouseEvent as ReactMouseEvent, type ReactNode, type SetStateAction } from "react";
import Image from "next/image";
import Link from "next/link";
import {
  Activity,
  ArrowRight,
  Bot,
  CheckCircle2,
  ClipboardList,
  Clock3,
  CircleHelp,
  Command,
  Copy,
  Database,
  Download,
  ExternalLink,
  Gauge,
  Home as HomeIcon,
  Lightbulb,
  Loader2,
  MessageCircle,
  MessageSquareText,
  Quote,
  Radar,
  Search,
  Settings,
  Sparkles,
  Target,
  Trophy,
  Trash2,
  Users,
  Upload,
  X,
  Zap,
} from "lucide-react";

import { ActionToastHost, showToast } from "@/components/action-toast";
import { LanguageToggle, useI18n } from "@/components/language-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { AI_RESPONSE_CONFIG_STORAGE_KEY, DEFAULT_AI_RESPONSE_MODEL, DEFAULT_GROK_PROXY_MODEL, GROK_PROXY_CONFIG_STORAGE_KEY, X_PROFILE_CONFIG_STORAGE_KEY, normalizeAiResponseConfig, normalizeGrokProxyConfig, normalizeXProfileConfig } from "@/lib/codeproxy-grok";
import { buildGrokSearchPrompt } from "@/lib/grok-utils";
import { AI_DRAFT_LIMIT, applyAiDraftOverrides, buildDraftRequestInput } from "@/lib/llm-drafts";
import { applyGrowthMemoryToQueueItems, buildGrowthMemoryPromptContext, buildGrowthMemoryRequestInput, growthMemoryKeywordText, mergeGrowthMemoryState, normalizeGrowthMemoryState } from "@/lib/growth-memory";
import { AI_SCORE_LIMIT, applyAiScoreOverrides, buildScoreRequestInput } from "@/lib/llm-scoring";
import { LocalStateConflictError, loadSharedSettings, readLocalState, writeLocalState } from "@/lib/local-state-client";
import { runGrowthWorkflow } from "@/lib/outbound";
import { PROFILE_MAX_RETRIES, isRetryableProfileFailure, profileRetryDelayMs } from "@/lib/profile-retry";
import { matchesQueueTimeRange, preferredVisibleQueueTimeRange } from "@/lib/queue-time-range";
import { buildFeedbackLearningPack, createSignal, formatSignalsAsLeadInput, mergeSignals, parseSignalsFromText, signalDedupKey } from "@/lib/signals";
import { CURRENT_VERSION, DEFAULT_AI_DRAFT_STATE, DEFAULT_AI_SCORE_STATE, DEFAULT_GROK_BRIDGE_STATE, DEFAULT_GROWTH_MEMORY_STATE, DEFAULT_ONBOARDING_STATE, DEFAULT_SIGNAL_STATE, DEFAULT_WORKBENCH_STATE, createOperationalWorkbenchSnapshot, createWorkbenchBackup, mergeConcurrentWorkbenchState, parseStoredWorkbenchState, parseWorkbenchBackup, serializeWorkbenchState } from "@/lib/workbench-state";
import { cn } from "@/lib/utils";

type Mode = "outbound" | "growth";
type DashboardTab = "overview" | "search" | "account" | "engage";

type FormState = {
  productName: string;
  description: string;
  targetCustomer: string;
  competitors: string;
  painPoints: string;
  replyGoal: string;
  productContext: string;
  leadInput: string;
};

type GrokBridgeState = {
  keywords: string;
  grokResult: string;
  accountResult: string;
  xProfileUrl: string;
};

type GrokProxyConfig = {
  apiKey: string;
  model: string;
  endpoint: string;
};

type AiResponseConfig = {
  apiKey: string;
  model: string;
  endpoint: string;
};

type XProfileConfig = {
  profileUrl: string;
};

type BusyOverlayState = {
  title: string;
  message: string;
  detail: string;
} | null;

type OnboardingState = {
  startedAt: string;
  welcomeDismissedAt: string;
};

type OnboardingTarget = "positioning" | "discovery" | "queue";
type OnboardingTaskKey = "positioning" | "discovery" | "scoring" | "engagement";

type OnboardingTask = {
  key: OnboardingTaskKey;
  title: string;
  description: string;
  tab: DashboardTab;
  target: OnboardingTarget;
  complete: boolean;
};

function loadAiResponseConfig() {
  if (typeof window === "undefined") return normalizeAiResponseConfig({}) as AiResponseConfig;
  try {
    const stored = window.localStorage.getItem(AI_RESPONSE_CONFIG_STORAGE_KEY);
    return normalizeAiResponseConfig(stored ? JSON.parse(stored) : {}) as AiResponseConfig;
  } catch {
    return normalizeAiResponseConfig({}) as AiResponseConfig;
  }
}

function loadXProfileConfig() {
  if (typeof window === "undefined") return normalizeXProfileConfig({}) as XProfileConfig;
  try {
    const stored = window.localStorage.getItem(X_PROFILE_CONFIG_STORAGE_KEY);
    return normalizeXProfileConfig(stored ? JSON.parse(stored) : {}) as XProfileConfig;
  } catch {
    return normalizeXProfileConfig({}) as XProfileConfig;
  }
}

function normalizeAccountToken(value: unknown) {
  return String(value ?? "").trim().replace(/^@+/, "").toLowerCase();
}

function extractXHandle(value: unknown) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";

  try {
    const input = /^https?:\/\//i.test(raw) ? raw : "https://x.com/" + raw.replace(/^@+/, "");
    const url = new URL(input);
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    if (host !== "x.com" && host !== "twitter.com") return normalizeAccountToken(raw);
    const [username] = url.pathname.split("/").filter(Boolean);
    if (!username || ["home", "explore", "search", "i", "settings", "notifications", "messages"].includes(username.toLowerCase())) return "";
    return normalizeAccountToken(username);
  } catch {
    const match = raw.match(/(?:x\.com|twitter\.com)\/([^/\s?#]+)/i);
    return normalizeAccountToken(match?.[1] || raw);
  }
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.map((value) => String(value ?? "").trim()).filter(Boolean)));
}

function buildOwnAccountIdentity(current: Pick<FormState, "productName">, profileUrl?: string): OwnAccountIdentity {
  const handle = extractXHandle(profileUrl || "");
  const productName = String(current.productName ?? "").trim();
  const names = uniqueStrings([
    productName,
    productName.replace(/\s*[|｜].*$/, "").trim(),
    productName.replace(/\s*[-—].*$/, "").trim(),
  ]).filter((value) => value.length >= 3);

  return {
    handles: handle ? [handle] : [],
    names,
    label: handle ? "@" + handle : names[0] || "",
  };
}

function signalMatchesOwnAccount(item: Partial<Signal> & Partial<QueueItem>, identity: OwnAccountIdentity) {
  const handles = identity.handles.map(normalizeAccountToken).filter(Boolean);
  const names = identity.names.map((name) => name.toLowerCase()).filter((name) => name.length >= 3);
  if (handles.length === 0 && names.length === 0) return false;

  const sourceUrl = String((item as { sourceUrl?: string }).sourceUrl || item.url || "");
  const urlHandle = extractXHandle(sourceUrl);
  if (urlHandle && handles.includes(urlHandle)) return true;

  const authorText = String((item as { author?: string; name?: string }).author || (item as { name?: string }).name || "").toLowerCase();
  const authorToken = normalizeAccountToken(authorText);
  if (handles.some((handle) => authorToken === handle || authorText.includes("@" + handle) || authorText.includes(handle))) return true;

  return names.some((name) => authorText.includes(name));
}

function partitionOwnSignals<T extends Partial<Signal> & Partial<QueueItem>>(items: T[], identity: OwnAccountIdentity) {
  const included: T[] = [];
  const excludedOwn: T[] = [];
  for (const item of items) {
    if (signalMatchesOwnAccount(item, identity)) excludedOwn.push(item);
    else included.push(item);
  }
  return { included, excludedOwn };
}

function ownAccountExclusionText(identity: OwnAccountIdentity, locale: "zh-CN" | "en" = "zh-CN") {
  const markers = [...identity.handles.map((handle) => "@" + handle), ...identity.names].filter(Boolean);
  if (locale === "en") {
    const label = markers.length ? ` (${markers.join(" / ")})` : "";
    return "\n\nHard exclusion: do not return the operator's own account" + label + ", product account, posts, or replies. Return external target users, third-party discussions, competitor audiences, or potential customers only.";
  }
  const label = markers.length ? "（" + markers.join(" / ") + "）" : "";
  return "\n\n硬性排除规则：不要返回我自己的账号" + label + "、我方产品账号、我自己发的帖子或回复。只返回外部目标用户、第三方讨论、竞品受众或潜在客户。";
}

type AccountRadarInsight = {
  accountType?: string;
  competitorPosition?: string;
  ourPosition?: string;
  audienceOverlap?: string;
  opportunityGap?: string;
  recommendedAngles?: string[];
  nextStep?: string;
  keywords?: string[];
  riskNotes?: string;
};
type GrokProxyApiResponse = {
  ok?: boolean;
  status?: string;
  diagnosticId?: number;
  message?: string;
  technicalMessage?: string;
  suggestion?: string;
  retryable?: boolean;
  model?: string;
  text?: string;
  rawText?: string;
  structured?: boolean;
  signals?: Signal[];
  accountRadar?: AccountRadarInsight | null;
  parseError?: string;
  pulledProfile?: {
    username?: string;
    sources?: string[];
    warnings?: string[];
    textLength?: number;
    preview?: string;
  } | null;
};

function grokFailureMessage(data: GrokProxyApiResponse, fallback: string, locale: "zh-CN" | "en") {
  const message = String(data.message || fallback).trim();
  const technicalMessage = String(data.technicalMessage || "").trim();
  const suggestion = String(data.suggestion || "").trim();
  const parts = [message];

  if (technicalMessage && !message.toLowerCase().includes(technicalMessage.toLowerCase())) {
    parts.push(locale === "en" ? `Technical cause: ${technicalMessage}` : `技术原因：${technicalMessage}`);
  }
  if (suggestion) {
    parts.push(locale === "en" ? `What to check: ${suggestion}` : `建议检查：${suggestion}`);
  }
  if (data.diagnosticId) {
    parts.push(locale === "en" ? `Local log #${data.diagnosticId}` : `本机日志 #${data.diagnosticId}`);
  }

  return parts.join(" ");
}

type Signal = {
  id: string;
  source: string;
  platform: string;
  author: string;
  url: string;
  text: string;
  importedAt: string;
  status: string;
  tags: string[];
  sourceLanguage?: string;
  reason?: string;
  confidence?: number;
  processedAt?: string;
  processedAction?: string;
  feedback?: string;
  feedbackAt?: string;
  replyUrl?: string;
  replyUrlAt?: string;
  usedDraft?: string;
  usedDraftAt?: string;
};

type SignalState = Record<Mode, Signal[]>;

type GrokProxySearchResult = {
  text: string;
  model: string;
  structured: boolean;
  signals: Signal[];
  rawText?: string;
  parseError?: string;
  pulledProfile?: GrokProxyApiResponse["pulledProfile"];
  accountRadar?: AccountRadarInsight | null;
};

type AiScore = {
  itemId: string;
  score: number;
  label: string;
  targetFit: number;
  painIntensity: number;
  replyValue: number;
  contentPotential: number;
  timingRisk: number;
  recommendedAction: string;
  reason: string;
  suggestedAngle: string;
};

type AiScoreState = Record<Mode, Record<string, AiScore>>;

type AiDraft = {
  itemId: string;
  draft?: string;
  replyDraft?: string;
  quoteDraft?: string;
  postIdea?: string;
  outreachDraft?: string;
  rationale?: string;
  toneNotes?: string;
  model?: string;
  generatedAt?: string;
};

type AiDraftState = Record<Mode, Record<string, AiDraft>>;

type ScoreApiResponse = {
  ok?: boolean;
  configured?: boolean;
  model?: string;
  message?: string;
  scores?: AiScore[];
};

type AiScoreRunResult = {
  count: number;
  model: string;
};

type DraftApiResponse = {
  ok?: boolean;
  configured?: boolean;
  diagnosticId?: number;
  model?: string;
  message?: string;
  drafts?: AiDraft[];
};

type AiDraftRunResult = {
  count: number;
  model: string;
  failedCount?: number;
  failedDiagnosticIds?: number[];
};

type AiProfile = Pick<FormState, "productName" | "description" | "targetCustomer" | "competitors" | "painPoints" | "replyGoal" | "productContext"> & {
  reasoning?: string;
};

type ProfileApiResponse = {
  ok?: boolean;
  configured?: boolean;
  diagnosticId?: number;
  model?: string;
  message?: string;
  profile?: Partial<AiProfile>;
  retryable?: boolean;
  status?: string;
};

type AiProfileRetryProgress = {
  maxRetries: number;
  reason: string;
  retryNumber: number;
};

type AiProfileRetryHandler = (progress: AiProfileRetryProgress) => void;

type AiProfileRunResult = {
  model: string;
  profile: AiProfile;
};

type DraftSource = {
  label: string;
  detail: string;
  tone: "ai" | "local";
};

type GrowthMemoryRule = {
  pattern: string;
  reason: string;
  weight: number;
  status: "active" | "watch" | "paused";
  confidence: number;
  positiveEvidence: number;
  negativeEvidence: number;
  lastValidatedAt: string;
};

type GrowthMemoryMergeStats = {
  added: number;
  merged: number;
  strengthened: number;
  weakened: number;
  paused: number;
};

type GrowthMemoryState = {
  active: boolean;
  generatedAt: string;
  appliedAt: string;
  sampleCount: number;
  positiveCount: number;
  noReplyCount: number;
  learningRunCount: number;
  lastBatchSampleCount: number;
  learnedSampleKeys: string[];
  lastMergeStats: GrowthMemoryMergeStats;
  summary: string;
  effectiveKeywords: string[];
  weakKeywords: string[];
  accountRadarKeywords: string[];
  scoreBoostRules: GrowthMemoryRule[];
  scorePenaltyRules: GrowthMemoryRule[];
  replyStyleRules: string[];
  avoidReplyPatterns: string[];
  nextExperiment: string;
};

type GrowthMemoryApiResponse = {
  ok?: boolean;
  configured?: boolean;
  status?: string;
  diagnosticId?: number;
  model?: string;
  message?: string;
  technicalMessage?: string;
  suggestion?: string;
  retryable?: boolean;
  memory?: GrowthMemoryState;
};

type GrowthMemoryRunResult = {
  count: number;
  totalCount: number;
  model: string;
  stats: GrowthMemoryMergeStats;
};

type GrowthMemoryRetryProgress = {
  maxRetries: number;
  reason: string;
  retryNumber: number;
};

type GrowthMemoryRetryHandler = (progress: GrowthMemoryRetryProgress) => void;

type XFeedbackPullUpdate = {
  itemId: string;
  feedback: SignalFeedbackStatus;
  status?: SignalExecutionStatus;
  checkedAt?: string;
  skipped?: boolean;
  reason?: string;
  confidence?: number;
};

type XFeedbackPullApiResponse = {
  ok?: boolean;
  message?: string;
  updatedCount?: number;
  skippedCount?: number;
  results?: XFeedbackPullUpdate[];
};

type XFeedbackPullRunResult = {
  updatedCount: number;
  skippedCount: number;
};

type SignalImportPreviewData = {
  parsedCount: number;
  importableCount: number;
  updatedCount: number;
  duplicateCount: number;
  excludedOwnCount: number;
  candidates: Signal[];
  importable: Signal[];
  updated: Signal[];
  duplicates: Signal[];
  excludedOwn: Signal[];
};

type Query = {
  channel: string;
  intent: string;
  query: string;
};

type OutboundLead = {
  platform: string;
  name: string;
  url: string;
  note: string;
  score: number;
  label: string;
  reasons: string[];
  draft: string;
  sourceLanguage?: string;
};

type GrowthOpportunity = {
  platform: string;
  name: string;
  url: string;
  note: string;
  score: number;
  label: string;
  reasons: string[];
  action: string;
  replyDraft: string;
  quoteDraft: string;
  postIdea: string;
  outreachDraft: string;
  sourceLanguage?: string;
};

type QueueItem = OutboundLead | GrowthOpportunity;

type OutboundResult = {
  mode: "outbound";
  queries: Query[];
  leads: OutboundLead[];
};

type GrowthResult = {
  mode: "growth";
  queries: Query[];
  opportunities: GrowthOpportunity[];
};

type WorkbenchResult = OutboundResult | GrowthResult;
type SignalExecutionStatus = "new" | "replied" | "quoted" | "saved" | "deferred" | "skipped";
type SignalFeedbackStatus = "none" | "got_reply" | "no_reply" | "followed" | "reshared";
type SignalFeedbackFilter = SignalFeedbackStatus | "all";
type ProcessFilterKey = "pending" | "processed" | "engaged" | "saved" | "deferred" | "skipped";
type PriorityFilterKey = "hot" | "warm" | "low";
type QueueTimeRangeKey = "today" | "yesterday" | "7d" | "30d" | "all";
type FilterOption<T extends string> = { key: T | "all"; label: string; count: number };
type OwnAccountIdentity = { handles: string[]; names: string[]; label: string };

type ExecutionStats = {
  total: number;
  pending: number;
  processed: number;
  processedToday: number;
  repliedToday: number;
  quotedToday: number;
  savedToday: number;
  skippedToday: number;
  completionRate: number;
  byStatus: Record<SignalExecutionStatus, number>;
  feedbackToday: number;
  positiveFeedback: number;
  byFeedback: Record<SignalFeedbackStatus, number>;
};

const feedbackOptions: Array<{ value: SignalFeedbackStatus; label: string }> = [
  { value: "got_reply", label: "有回复" },
  { value: "no_reply", label: "无回复" },
  { value: "followed", label: "被关注" },
  { value: "reshared", label: "被转发" },
  { value: "none", label: "清除" },
];
const executionOptions: Record<Mode, Array<{ value: SignalExecutionStatus; label: string }>> = {
  outbound: [
    { value: "new", label: "未执行" },
    { value: "replied", label: "已触达" },
    { value: "saved", label: "已收藏" },
    { value: "deferred", label: "搁置" },
    { value: "skipped", label: "跳过" },
  ],
  growth: [
    { value: "new", label: "未执行" },
    { value: "replied", label: "已互动" },
    { value: "quoted", label: "已引用" },
    { value: "saved", label: "已收藏" },
    { value: "deferred", label: "搁置" },
    { value: "skipped", label: "跳过" },
  ],
};

function normalizeFeedbackStatus(value: unknown): SignalFeedbackStatus {
  return ["none", "got_reply", "no_reply", "followed", "reshared"].includes(String(value)) ? (String(value) as SignalFeedbackStatus) : "none";
}

function feedbackStatusLabel(status: SignalFeedbackStatus) {
  return feedbackOptions.find((option) => option.value === status)?.label ?? "未记录";
}

function feedbackStatusClass(status: SignalFeedbackStatus) {
  if (status === "got_reply") return "border-emerald-500/10 bg-emerald-500/10 text-emerald-300";
  if (status === "followed") return "border-blue-500/10 bg-blue-500/10 text-blue-200";
  if (status === "reshared") return "border-blue-500/10 bg-blue-500/10 text-blue-200";
  if (status === "no_reply") return "border-amber-500/10 bg-amber-500/10 text-amber-200";
  return "border-white/[0.08] bg-white/[0.03] text-white/45";
}

function emptyFeedbackCounts(): Record<SignalFeedbackStatus, number> {
  return {
    none: 0,
    got_reply: 0,
    no_reply: 0,
    followed: 0,
    reshared: 0,
  };
}
function normalizeExecutionStatus(value: unknown): SignalExecutionStatus {
  return ["new", "replied", "quoted", "saved", "deferred", "skipped"].includes(String(value)) ? (String(value) as SignalExecutionStatus) : "new";
}

function executionStatusLabel(status: SignalExecutionStatus, mode: Mode) {
  return executionOptions[mode].find((option) => option.value === status)?.label ?? "未执行";
}

function executionStatusClass(status: SignalExecutionStatus) {
  if (status === "new") return "border-white/[0.08] bg-white/[0.04] text-white/65";
  if (status === "skipped") return "border-rose-500/10 bg-rose-500/10 text-rose-200";
  if (status === "deferred") return "border-amber-500/10 bg-amber-500/10 text-amber-200";
  if (status === "saved") return "border-blue-500/10 bg-blue-500/10 text-blue-200";
  return "border-emerald-500/10 bg-emerald-500/10 text-emerald-300";
}

function queueItemSignalKey(item: QueueItem) {
  return signalDedupKey({ platform: item.platform, author: item.name, url: item.url, text: item.note });
}

function dedupeQueueItems<T extends QueueItem>(items: T[]): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  items.forEach((item) => {
    const key = queueItemSignalKey(item);
    if (seen.has(key)) return;
    seen.add(key);
    result.push(item);
  });
  return result;
}

function toggleFilterSelection<T extends string>(values: T[], key: T) {
  return values.includes(key) ? values.filter((value) => value !== key) : [...values, key];
}
const DEMO_SOURCE_URLS = new Set([
  "https://x.com/maker/status/1",
  "https://x.com/founder/status/1",
  "https://x.com/founder/status/2",
  "https://x.com/builder/status/3",
  "https://x.com/cursor/status/2",
  "https://x.com/saas/status/3",
]);

function normalizeSourceUrl(value: string) {
  return String(value ?? "").trim().replace(/\/$/, "");
}

function openableSourceUrl(value: string) {
  const url = normalizeSourceUrl(value);
  if (!/^https?:\/\//i.test(url)) return "";
  return DEMO_SOURCE_URLS.has(url) ? "" : url;
}

function stripDemoSourceUrls(value: string) {
  let next = value;
  DEMO_SOURCE_URLS.forEach((url) => {
    next = next.replaceAll(url, "");
  });
  return next;
}

function createSignalPreviewFromCandidates(candidates: Signal[], existingSignals: Signal[], excludedOwn: Signal[] = []): SignalImportPreviewData {
  const result = mergeSignals(existingSignals, candidates) as { signals: Signal[]; imported: Signal[]; updated: Signal[]; duplicates: Signal[] };
  return {
    parsedCount: candidates.length + excludedOwn.length,
    importableCount: result.imported.length,
    updatedCount: result.updated.length,
    duplicateCount: result.duplicates.length,
    excludedOwnCount: excludedOwn.length,
    candidates,
    importable: result.imported,
    updated: result.updated,
    duplicates: result.duplicates,
    excludedOwn,
  };
}

function mergeLeadInputWithSignals(leadInput: string, modeSignals: Signal[]) {
  const manualSignals = parseSignalsFromText(leadInput, { source: "manual" }) as Signal[];
  const merged = mergeSignals(modeSignals ?? [], manualSignals) as { signals: Signal[] };
  return formatSignalsAsLeadInput(merged.signals);
}

function formatProcessedAt(value?: string) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function isToday(value?: string) {
  if (!value) return false;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;
  const today = new Date();
  return date.getFullYear() === today.getFullYear() && date.getMonth() === today.getMonth() && date.getDate() === today.getDate();
}

function emptyExecutionCounts(): Record<SignalExecutionStatus, number> {
  return { new: 0, replied: 0, quoted: 0, saved: 0, deferred: 0, skipped: 0 };
}

type ModeContent = {
  badge: string;
  title: string;
  description: string;
  heroTitle: string;
  heroDescription: string;
  primaryLabel: string;
  secondaryLabel: string;
  descriptionLabel: string;
  targetLabel: string;
  pillarLabel: string;
  candidateLabel: string;
  resultTitle: string;
  queueDescription: string;
  hotLabel: string;
  csvName: string;
};

const modeCopy: Record<Mode, ModeContent> = {
  outbound: {
    badge: "主动获客",
    title: "填写定位",
    description: "先说清楚你要找谁，系统会据此生成 Grok 搜索 Prompt、评分和草稿。",
    heroTitle: "在用户主动搜索前找到买家。",
    heroDescription: "一个轻量的 GTM 工作台，用来发现高意向讨论、排序线索，并快速生成有上下文的第一条消息。",
    primaryLabel: "产品名称",
    secondaryLabel: "竞品 / 替代方案",
    descriptionLabel: "产品描述",
    targetLabel: "目标客户",
    pillarLabel: "核心痛点",
    candidateLabel: "已导入 X 线索",
    resultTitle: "线索指挥队列",
    queueDescription: "按购买意图和痛点强度排序。",
    hotLabel: "高意向",
    csvName: "主动获客线索.csv",
  },
  growth: {
    badge: "增长机会",
    title: "填写增长定位",
    description: "说清楚你是谁、想影响谁和能解决什么问题，再去 Grok 找值得互动或跟进的 X 讨论。",
    heroTitle: "把 X 上的讨论变成增长机会。",
    heroDescription: "从公开讨论中找到相关用户，判断互动与潜在需求价值，生成回复、引用、选题和私下跟进草稿。",
    primaryLabel: "账号 / 产品名称",
    secondaryLabel: "增长目标",
    descriptionLabel: "定位描述",
    targetLabel: "目标人群",
    pillarLabel: "主题 / 痛点",
    candidateLabel: "已导入 X 信号",
    resultTitle: "增长机会队列",
    queueDescription: "按相关性、互动价值、潜在需求和内容延展性排序。",
    hotLabel: "优先处理",
    csvName: "增长机会.csv",
  },
};
const initialState: Record<Mode, FormState> = {
  outbound: {
    productName: "示例 SaaS",
    description: "帮助独立开发者从公开讨论中发现高意向需求，并准备相关的首次触达草稿。",
    targetCustomer: "刚上线 SaaS、正在验证获客渠道的独立开发者",
    competitors: "现有工作流、替代方案或手动研究",
    painPoints: "没有流量, 找不到付费用户, SEO 太慢, 第一批客户",
    replyGoal: "先围绕对方的具体问题提供有用信息，再确认是否适合继续交流。",
    productContext: "只在与当前问题直接相关时说明正在构建的产品或经验；不要承诺未提供的服务、结果或免费试用。",
    leadInput: `X | 独立开发者 |  | 刚上线一个 SaaS 但没有流量，想找到付费用户，SEO 太慢
X | SaaS 创始人 |  | 正在寻找第一批付费用户，想验证主动获客渠道
X | AI 产品开发者 |  | 用 AI Coding 做了产品，但不知道怎么找到真实需求`,
  },
  growth: {
    productName: "Growth OS 示例账号",
    description: "分享 AI 工具、独立开发和产品增长的可验证实践。",
    targetCustomer: "独立开发者, AI 工具用户, 正在验证产品市场的开发者",
    competitors: "提升互动质量, 获得相关关注, 沉淀内容选题",
    painPoints: "AI 工具, 独立开发, 用户研究, 产品增长",
    replyGoal: "先贡献一个具体、可执行的观点；只在相关时引导对方继续讨论或关注。",
    productContext: "只在有助于理解回复时说明身份、产品或经验；不使用广告式表达，也不作无法验证的承诺。",
    leadInput: `X | AI 独立开发者 |  | 用 AI Coding 做完产品但上线后 0 流量，想知道怎么找到第一批用户
X | Cursor 用户 |  | 用 Cursor 做了一个小工具，但不知道怎么验证需求
X | SaaS 开发者 |  | 产品上线后没有流量，想知道怎么获得第一批用户`,
  },
};
function migrateStoredForms(forms: Record<Mode, FormState>): Record<Mode, FormState> {
  const next: Record<Mode, FormState> = {
    outbound: { ...initialState.outbound, ...(forms.outbound ?? {}) },
    growth: { ...initialState.growth, ...(forms.growth ?? {}) },
  };

  if (next.outbound.description.includes("监控 X、Reddit 和 GitHub")) {
    next.outbound.description = initialState.outbound.description;
  }
  if (next.outbound.leadInput.includes("reddit.com/r/SaaS/comments/1") && next.outbound.leadInput.includes("github.com/example/ui")) {
    next.outbound.leadInput = initialState.outbound.leadInput;
  }
  if (next.growth.leadInput.includes("reddit.com/r/SaaS/comments/2")) {
    next.growth.leadInput = initialState.growth.leadInput;
  }

  next.outbound.leadInput = stripDemoSourceUrls(next.outbound.leadInput);
  next.growth.leadInput = stripDemoSourceUrls(next.growth.leadInput);

  return next;
}

function fallbackCopyText(value: string, successMessage: string) {
  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();

  try {
    const copied = document.execCommand("copy");
    showToast(copied ? successMessage : "复制失败，请手动选择内容复制。", copied ? "success" : "error");
  } finally {
    document.body.removeChild(textarea);
  }
}

function copyText(value: string, successMessage = "已复制到剪贴板。") {
  if (!value) {
    showToast("没有可复制的内容。", "error");
    return;
  }

  if (navigator.clipboard?.writeText) {
    navigator.clipboard
      .writeText(value)
      .then(() => showToast(successMessage, "success"))
      .catch(() => fallbackCopyText(value, successMessage));
    return;
  }

  fallbackCopyText(value, successMessage);
}

function formatActionError(error: unknown, fallback: string) {
  const message = error instanceof Error && error.message.trim() ? error.message : fallback;
  if (/aborted|operation was aborted|timeout|timed out/i.test(message)) {
    return "AI 请求等待时间过长，已经自动停止。可以稍后重试，或先少选几条再跑。";
  }
  return message;
}
function csvEscape(value: unknown) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

function downloadFile(filename: string, rows: string[]) {
  const blob = new Blob([rows.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function downloadTextFile(filename: string, content: string, type = "text/plain;charset=utf-8") {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function scoreVariant(label: string) {
  if (label === "High intent" || label === "Engage now") return "success";
  if (label === "Low" || label === "Skip") return "danger";
  return "warning";
}

function toneFor(label: string) {
  if (label === "High intent" || label === "Engage now") {
    return {
      border: "border-emerald-300/80",
      strip: "bg-emerald-500",
      soft: "bg-emerald-50 text-emerald-800 border-emerald-200",
      fill: "bg-emerald-500",
    };
  }

  if (label === "Low" || label === "Skip") {
    return {
      border: "border-rose-200",
      strip: "bg-rose-500",
      soft: "bg-rose-50 text-rose-700 border-rose-200",
      fill: "bg-rose-500",
    };
  }

  return {
    border: "border-amber-200",
    strip: "bg-amber-500",
    soft: "bg-amber-50 text-amber-800 border-amber-200",
    fill: "bg-amber-500",
  };
}

const labelCopy: Record<string, string> = {
  "High intent": "高意向",
  Warm: "可跟进",
  Low: "低优先级",
  "Engage now": "立即互动",
  Watch: "观察",
  Skip: "跳过",
};

function displayLabel(label: string) {
  return labelCopy[label] ?? label;
}
function itemDraft(item: QueueItem) {
  return "draft" in item ? item.draft : item.replyDraft;
}

function draftSourceForItem(item: QueueItem): DraftSource {
  const aiDraft = (item as QueueItem & { aiDraft?: AiDraft }).aiDraft;
  if (aiDraft) {
    return {
      label: "AI 草稿",
      detail: aiDraft.model ? `${aiDraft.model} 生成` : "GPT-5.5 生成",
      tone: "ai",
    };
  }

  return {
    label: "本地草稿",
    detail: "规则兜底",
    tone: "local",
  };
}

function itemAction(item: QueueItem) {
  return "action" in item ? item.action : "首轮触达草稿";
}

const LEGACY_DEFAULT_KEYWORDS = "AI Coding, indie dev, 0 traffic, Cursor alternative, first users";

function deriveGrokKeywords(current: FormState) {
  const rawTerms = [
    current.productName,
    current.competitors,
    current.targetCustomer,
    current.painPoints,
  ]
    .join("，")
    .split(/[,\n，、;；|/]+/)
    .map((term) => term.trim())
    .filter(Boolean);

  return Array.from(new Set(rawTerms)).slice(0, 8).join(", ");
}

function repairAutoFeedbackExecutionStatus(signal: Signal) {
  const status = normalizeExecutionStatus(signal.status);
  const action = normalizeExecutionStatus(signal.processedAction);
  if (status === "new" && action !== "new") return { ...signal, status: action };
  if (status === "new" && signal.replyUrl) {
    return {
      ...signal,
      status: "replied",
      processedAction: "replied",
      processedAt: signal.processedAt || signal.replyUrlAt || signal.feedbackAt || new Date().toISOString(),
    };
  }
  return signal;
}

function repairAutoFeedbackState(state: SignalState) {
  return {
    outbound: (state.outbound ?? []).map(repairAutoFeedbackExecutionStatus),
    growth: (state.growth ?? []).map(repairAutoFeedbackExecutionStatus),
  } as SignalState;
}

function mergeLeadInputTexts(...values: string[]) {
  return Array.from(
    new Set(
      values
        .flatMap((value) => String(value ?? "").split(/\r?\n/))
        .map((line) => line.trim())
        .filter(Boolean)
    )
  ).join("\n");
}

function convertLegacyAiScores(scores: Record<string, AiScore>) {
  return Object.fromEntries(
    Object.entries(scores ?? {}).map(([key, score]) => [
      key,
      {
        ...score,
        label: score.label === "High intent" ? "Engage now" : score.label === "Warm" ? "Watch" : score.label === "Low" ? "Skip" : score.label,
      },
    ])
  ) as Record<string, AiScore>;
}

function convertLegacyAiDrafts(drafts: Record<string, AiDraft>) {
  return Object.fromEntries(
    Object.entries(drafts ?? {}).map(([key, draft]) => [
      key,
      {
        ...draft,
        outreachDraft: draft.outreachDraft || draft.draft || "",
      },
    ])
  ) as Record<string, AiDraft>;
}

function unifyRestoredWorkbenchState(restored: unknown) {
  const source = restored as Partial<{
    mode: unknown;
    forms: Record<Mode, FormState>;
    grokBridge: GrokBridgeState;
    signals: SignalState;
    aiScores: AiScoreState;
    aiDrafts: AiDraftState;
    growthMemory: GrowthMemoryState;
    onboarding: OnboardingState;
  }>;
  const sourceMode: Mode = source.mode === "outbound" ? "outbound" : "growth";
  const forms = migrateStoredForms((source.forms ?? initialState) as Record<Mode, FormState>);
  const repairedSignals = repairAutoFeedbackState((source.signals ?? DEFAULT_SIGNAL_STATE) as SignalState);
  const restoredScores = (source.aiScores ?? DEFAULT_AI_SCORE_STATE) as AiScoreState;
  const restoredDrafts = (source.aiDrafts ?? DEFAULT_AI_DRAFT_STATE) as AiDraftState;
  const secondaryMode: Mode = sourceMode === "outbound" ? "growth" : "outbound";
  const unifiedSignals = mergeSignals(repairedSignals[sourceMode] ?? [], repairedSignals[secondaryMode] ?? []).signals as Signal[];
  const convertedOutboundScores = convertLegacyAiScores(restoredScores.outbound ?? {});
  const convertedOutboundDrafts = convertLegacyAiDrafts(restoredDrafts.outbound ?? {});
  const unifiedScores = sourceMode === "outbound"
    ? { ...(restoredScores.growth ?? {}), ...convertedOutboundScores }
    : { ...convertedOutboundScores, ...(restoredScores.growth ?? {}) };
  const unifiedDrafts = sourceMode === "outbound"
    ? { ...(restoredDrafts.growth ?? {}), ...convertedOutboundDrafts }
    : { ...convertedOutboundDrafts, ...(restoredDrafts.growth ?? {}) };

  return {
    forms: {
      ...forms,
      growth: {
        ...forms[sourceMode],
        leadInput: mergeLeadInputTexts(forms[sourceMode].leadInput, forms[secondaryMode].leadInput),
      },
    } as Record<Mode, FormState>,
    grokBridge: (source.grokBridge ?? DEFAULT_GROK_BRIDGE_STATE) as GrokBridgeState,
    signals: { ...repairedSignals, growth: unifiedSignals } as SignalState,
    aiScores: { ...restoredScores, growth: unifiedScores } as AiScoreState,
    aiDrafts: { ...restoredDrafts, growth: unifiedDrafts } as AiDraftState,
    growthMemory: (source.growthMemory ?? DEFAULT_GROWTH_MEMORY_STATE) as GrowthMemoryState,
    onboarding: (source.onboarding ?? DEFAULT_ONBOARDING_STATE) as OnboardingState,
  };
}

const workflowDashboardTabs: Array<{ value: DashboardTab; label: string; shortLabel: string; icon: ReactNode }> = [
  { value: "overview", label: "总览", shortLabel: "总览", icon: <HomeIcon className="h-5 w-5" /> },
  { value: "search", label: "定位找人", shortLabel: "找人", icon: <Search className="h-5 w-5" /> },
  { value: "engage", label: "互动队列", shortLabel: "互动", icon: <MessageSquareText className="h-5 w-5" /> },
];
const insightDashboardTabs: Array<{ value: DashboardTab; label: string; shortLabel: string; icon: ReactNode }> = [
  { value: "account", label: "竞品洞察", shortLabel: "竞品", icon: <Radar className="h-5 w-5" /> },
];
const dashboardTabs = [...workflowDashboardTabs, ...insightDashboardTabs];

function localizedDashboardTabs(locale: "zh-CN" | "en") {
  if (locale !== "en") return dashboardTabs;
  const labels: Record<DashboardTab, { label: string; shortLabel: string }> = {
    overview: { label: "Overview", shortLabel: "Home" },
    search: { label: "Find people", shortLabel: "Find" },
    engage: { label: "Engagement queue", shortLabel: "Queue" },
    account: { label: "Competitor insights", shortLabel: "Insights" },
  };
  return dashboardTabs.map((tab) => ({ ...tab, ...labels[tab.value] }));
}

function dashboardTabLabel(tab: DashboardTab, locale: "zh-CN" | "en" = "zh-CN") {
  return localizedDashboardTabs(locale).find((item) => item.value === tab)?.label ?? (locale === "en" ? "Overview" : "总览");
}
export default function Home() {
  const { locale } = useI18n();
  const mode: Mode = "growth";
  const [activeTab, setActiveTab] = useState<DashboardTab>("overview");
  const [forms, setForms] = useState<Record<Mode, FormState>>(DEFAULT_WORKBENCH_STATE.forms as Record<Mode, FormState>);
  const [grokBridge, setGrokBridge] = useState<GrokBridgeState>(DEFAULT_GROK_BRIDGE_STATE);
  const [signals, setSignals] = useState<SignalState>(DEFAULT_SIGNAL_STATE as SignalState);
  const [aiScores, setAiScores] = useState<AiScoreState>(DEFAULT_AI_SCORE_STATE as AiScoreState);
  const [aiDrafts, setAiDrafts] = useState<AiDraftState>(DEFAULT_AI_DRAFT_STATE as AiDraftState);
  const [growthMemory, setGrowthMemory] = useState<GrowthMemoryState>(DEFAULT_GROWTH_MEMORY_STATE as GrowthMemoryState);
  const [onboarding, setOnboarding] = useState<OnboardingState>(DEFAULT_ONBOARDING_STATE as OnboardingState);
  const [showWelcomeGuide, setShowWelcomeGuide] = useState(false);
  const [showOnboardingTasks, setShowOnboardingTasks] = useState(false);
  const [highlightedOnboardingTarget, setHighlightedOnboardingTarget] = useState<OnboardingTarget | null>(null);
  const [savedPositioningVersion, setSavedPositioningVersion] = useState(0);
  const [isWorkbenchReady, setIsWorkbenchReady] = useState(false);
  const [canPersistWorkbench, setCanPersistWorkbench] = useState(false);
  const [busyOverlay, setBusyOverlay] = useState<BusyOverlayState>(null);
  const savedPositioningFormsRef = useRef<Record<Mode, FormState>>(DEFAULT_WORKBENCH_STATE.forms as Record<Mode, FormState>);
  const workbenchWriteQueueRef = useRef<Promise<void>>(Promise.resolve());
  const workbenchRevisionRef = useRef<string | null>(null);
  const lastPersistedWorkbenchRef = useRef(serializeWorkbenchState(DEFAULT_WORKBENCH_STATE));
  const autoSaveErrorShownRef = useRef(false);
  const onboardingHighlightTimerRef = useRef<number | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const requestedTab = params.get("tab") as DashboardTab | null;
    if (requestedTab && ["overview", "search", "engage", "account"].includes(requestedTab)) {
      setActiveTab(requestedTab);
    }
    if (params.get("guide") === "1") {
      setShowOnboardingTasks(true);
    }
  }, []);

  const persistWorkbenchSnapshot = useCallback(async (value: object) => {
    const nextWrite = workbenchWriteQueueRef.current
      .catch(() => undefined)
      .then(async () => {
        const localSerialized = serializeWorkbenchState(value);
        if (localSerialized === lastPersistedWorkbenchRef.current) return;
        let base = parseStoredWorkbenchState(lastPersistedWorkbenchRef.current, DEFAULT_WORKBENCH_STATE);
        let candidate = parseStoredWorkbenchState(localSerialized, DEFAULT_WORKBENCH_STATE);
        let expectedUpdatedAt = workbenchRevisionRef.current;
        let mergedConcurrentChanges = false;

        for (let attempt = 1; attempt <= 5; attempt += 1) {
          const candidateSerialized = serializeWorkbenchState(candidate);
          try {
            const result = await writeLocalState(
              "workbench",
              JSON.parse(candidateSerialized) as object,
              { expectedUpdatedAt }
            );
            workbenchRevisionRef.current = result.updatedAt;
            lastPersistedWorkbenchRef.current = candidateSerialized;

            if (mergedConcurrentChanges) {
              const unified = unifyRestoredWorkbenchState(candidate);
              savedPositioningFormsRef.current = unified.forms;
              setSavedPositioningVersion((currentVersion) => currentVersion + 1);
              setForms((previous) => ({
                outbound: { ...previous.outbound, leadInput: unified.forms.outbound.leadInput },
                growth: { ...previous.growth, leadInput: unified.forms.growth.leadInput },
              }));
              setGrokBridge(unified.grokBridge);
              setSignals(unified.signals);
              setAiScores(unified.aiScores);
              setAiDrafts(unified.aiDrafts);
              setGrowthMemory(unified.growthMemory);
              setOnboarding(unified.onboarding);
              showToast("检测到其他页面同时更新，已自动合并双方数据，没有覆盖队列。", "success");
            }
            return;
          } catch (error) {
            if (!(error instanceof LocalStateConflictError)) throw error;
            if (attempt === 5) {
              throw new Error("工作台同时更新过于频繁，已停止写入以避免覆盖数据。请关闭其他页面后重试。");
            }
          }

          const latest = await readLocalState<unknown>("workbench");
          const remote = parseStoredWorkbenchState(
            latest.exists && latest.value ? JSON.stringify(latest.value) : null,
            DEFAULT_WORKBENCH_STATE
          );
          candidate = mergeConcurrentWorkbenchState(base, candidate, remote);
          base = remote;
          expectedUpdatedAt = latest.updatedAt;
          mergedConcurrentChanges = true;
        }
      });
    workbenchWriteQueueRef.current = nextWrite;
    await nextWrite;
  }, []);

  useEffect(() => {
    let cancelled = false;

    void loadSharedSettings().catch(() => {
      if (!cancelled) showToast("共享设置读取失败，请确认本地服务仍在运行。", "error");
    });

    async function restoreWorkbench() {
      try {
        const response = await readLocalState<unknown>("workbench");
        const restored = parseStoredWorkbenchState(
          response.exists && response.value ? JSON.stringify(response.value) : null,
          DEFAULT_WORKBENCH_STATE
        );
        const unified = unifyRestoredWorkbenchState(restored);
        if (cancelled) return;
        workbenchRevisionRef.current = response.updatedAt;
        lastPersistedWorkbenchRef.current = serializeWorkbenchState(restored);
        savedPositioningFormsRef.current = unified.forms;
        setSavedPositioningVersion((value) => value + 1);
        setForms(unified.forms);
        setGrokBridge(unified.grokBridge);
        setSignals(unified.signals);
        setAiScores(unified.aiScores);
        setAiDrafts(unified.aiDrafts);
        setGrowthMemory(unified.growthMemory);
        setOnboarding(unified.onboarding);
        setCanPersistWorkbench(true);
      } catch {
        if (!cancelled) {
          setCanPersistWorkbench(false);
          showToast("本地工作台读取失败，暂时显示空白状态。请确认本地服务仍在运行。", "error");
        }
      } finally {
        if (!cancelled) setIsWorkbenchReady(true);
      }
    }

    void restoreWorkbench();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    async function reloadFromExtensionSync() {
      try {
        const response = await readLocalState<unknown>("workbench");
        if (!response.exists || !response.value) return;
        const restored = parseStoredWorkbenchState(JSON.stringify(response.value), DEFAULT_WORKBENCH_STATE);
        const unified = unifyRestoredWorkbenchState(restored);
        workbenchRevisionRef.current = response.updatedAt;
        lastPersistedWorkbenchRef.current = serializeWorkbenchState(restored);
        setForms((previous) => ({
          outbound: { ...previous.outbound, leadInput: unified.forms.outbound.leadInput },
          growth: { ...previous.growth, leadInput: unified.forms.growth.leadInput },
        }));
        setGrokBridge(unified.grokBridge);
        setSignals(unified.signals);
        setAiScores(unified.aiScores);
        setAiDrafts(unified.aiDrafts);
        setGrowthMemory(unified.growthMemory);
        setOnboarding(unified.onboarding);
        showToast("插件同步的反馈已更新到页面。", "success");
      } catch {
        showToast("插件反馈已收到，但页面重新读取本地数据失败。", "error");
      }
    }

    const handleExtensionSync = () => void reloadFromExtensionSync();
    window.addEventListener("ray-growth-os:extension-sync", handleExtensionSync);
    return () => window.removeEventListener("ray-growth-os:extension-sync", handleExtensionSync);
  }, []);

  useEffect(() => {
    if (!isWorkbenchReady || !canPersistWorkbench) return;

    const operationalSnapshot = createOperationalWorkbenchSnapshot(
      { mode, forms, grokBridge, signals, aiScores, aiDrafts, growthMemory, onboarding },
      savedPositioningFormsRef.current
    );
    const serialized = serializeWorkbenchState(operationalSnapshot);
    if (serialized === lastPersistedWorkbenchRef.current) return;
    const value = JSON.parse(serialized) as object;

    void persistWorkbenchSnapshot(value)
      .then(() => {
        autoSaveErrorShownRef.current = false;
      })
      .catch(() => {
        if (autoSaveErrorShownRef.current) return;
        autoSaveErrorShownRef.current = true;
        showToast("队列自动保存失败：请确认本地服务仍在运行。当前页面数据尚未丢失，请不要刷新。", "error");
      });
  }, [
    aiDrafts,
    aiScores,
    canPersistWorkbench,
    forms.growth.leadInput,
    forms.outbound.leadInput,
    grokBridge,
    growthMemory,
    isWorkbenchReady,
    mode,
    onboarding,
    persistWorkbenchSnapshot,
    signals,
  ]);

  const current = forms[mode];
  const copy = modeCopy[mode];
  const savedPositioning = useMemo(() => {
    void savedPositioningVersion;
    return savedPositioningFormsRef.current[mode];
  }, [mode, savedPositioningVersion]);
  const savedPositioningHasContent = ["productName", "description", "targetCustomer", "painPoints"].some((field) =>
    String(savedPositioning[field as keyof FormState] ?? "").trim()
  );
  const positioningTaskComplete = ["productName", "description", "targetCustomer", "painPoints"].every((field) =>
    String(savedPositioning[field as keyof FormState] ?? "").trim()
  );
  const discoveryTaskComplete = (signals[mode] ?? []).length > 0;
  const scoringTaskComplete = Object.keys(aiScores[mode] ?? {}).length > 0;
  const engagementTaskComplete = (signals[mode] ?? []).some((signal) => {
    const status = normalizeExecutionStatus(signal.status);
    return Boolean(signal.replyUrl) || status === "replied" || status === "quoted";
  });
  const hasMeaningfulUsage = savedPositioningHasContent
    || discoveryTaskComplete
    || scoringTaskComplete
    || Object.keys(aiDrafts[mode] ?? {}).length > 0
    || Boolean(growthMemory.generatedAt);
  const onboardingTasks = useMemo<OnboardingTask[]>(() => {
    const tr = (zh: string, en: string) => (locale === "en" ? en : zh);
    return [
      {
        key: "positioning",
        title: tr("完善账号定位", "Complete account positioning"),
        description: tr("填写账号、目标用户和能解决的问题，并保存。", "Define the account, target audience, and problems you can solve, then save."),
        tab: "search",
        target: "positioning",
        complete: positioningTaskComplete,
      },
      {
        key: "discovery",
        title: tr("找到目标讨论", "Discover target discussions"),
        description: tr("手动或自动搜索，并至少导入 1 条真实 X 讨论。", "Search manually or automatically and import at least one real X discussion."),
        tab: "search",
        target: "discovery",
        complete: discoveryTaskComplete,
      },
      {
        key: "scoring",
        title: tr("筛出高价值机会", "Prioritize high-value opportunities"),
        description: tr("在互动队列完成一次 AI 评分。", "Run AI scoring once in the engagement queue."),
        tab: "engage",
        target: "queue",
        complete: scoringTaskComplete,
      },
      {
        key: "engagement",
        title: tr("完成首次互动", "Complete the first engagement"),
        description: tr("复制回复并打开来源，回复后记录结果。", "Copy a reply, open the source, and record the result after responding."),
        tab: "engage",
        target: "queue",
        complete: engagementTaskComplete,
      },
    ];
  }, [discoveryTaskComplete, engagementTaskComplete, locale, positioningTaskComplete, scoringTaskComplete]);
  const completedOnboardingCount = onboardingTasks.filter((task) => task.complete).length;
  const onboardingComplete = completedOnboardingCount === onboardingTasks.length;
  const firstIncompleteOnboardingTask = onboardingTasks.find((task) => !task.complete) ?? onboardingTasks[onboardingTasks.length - 1];
  const onboardingQuestActive = Boolean(onboarding.startedAt) && !onboardingComplete;

  useEffect(() => {
    if (!isWorkbenchReady || onboarding.startedAt || onboarding.welcomeDismissedAt || hasMeaningfulUsage) return;
    setShowWelcomeGuide(true);
  }, [hasMeaningfulUsage, isWorkbenchReady, onboarding.startedAt, onboarding.welcomeDismissedAt]);

  useEffect(() => () => {
    if (onboardingHighlightTimerRef.current) window.clearTimeout(onboardingHighlightTimerRef.current);
  }, []);

  function ensureOnboardingStarted() {
    setOnboarding((previous) => {
      if (previous.startedAt && previous.welcomeDismissedAt) return previous;
      const now = new Date().toISOString();
      return {
        startedAt: previous.startedAt || now,
        welcomeDismissedAt: previous.welcomeDismissedAt || now,
      };
    });
  }

  function navigateToOnboardingTask(task: OnboardingTask) {
    ensureOnboardingStarted();
    setShowWelcomeGuide(false);
    setShowOnboardingTasks(false);
    setActiveTab(task.tab);
    setHighlightedOnboardingTarget(task.target);

    window.setTimeout(() => {
      document.querySelector(`[data-onboarding-target="${task.target}"]`)?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 100);

    if (onboardingHighlightTimerRef.current) window.clearTimeout(onboardingHighlightTimerRef.current);
    onboardingHighlightTimerRef.current = window.setTimeout(() => {
      setHighlightedOnboardingTarget(null);
      onboardingHighlightTimerRef.current = null;
    }, 5000);
  }

  function dismissWelcomeGuide(startFirstTask: boolean) {
    ensureOnboardingStarted();
    setShowWelcomeGuide(false);
    if (startFirstTask) navigateToOnboardingTask(firstIncompleteOnboardingTask);
  }

  function openOnboardingTasks() {
    ensureOnboardingStarted();
    setShowOnboardingTasks(true);
  }

  const workflowLeadInput = useMemo(
    () => mergeLeadInputWithSignals(current.leadInput, signals[mode] ?? []),
    [current.leadInput, mode, signals]
  );
  const signalByKey = useMemo(() => {
    const map = new Map<string, Signal>();
    for (const signal of signals[mode] ?? []) {
      map.set(signalDedupKey(signal), signal);
    }
    return map;
  }, [mode, signals]);

  const localResult = useMemo((): GrowthResult => {
    const workflow = runGrowthWorkflow(
      {
        accountName: current.productName,
        positioning: current.description,
        targetReaders: current.targetCustomer,
        growthGoals: current.competitors,
        contentPillars: current.painPoints,
      },
      workflowLeadInput
    ) as { queries: Query[]; opportunities: GrowthOpportunity[] };
    return {
      mode: "growth",
      ...workflow,
      opportunities: workflow.opportunities.map((item) => {
        const sourceLanguage = signalByKey.get(queueItemSignalKey(item))?.sourceLanguage;
        return sourceLanguage ? { ...item, sourceLanguage } : item;
      }),
    };
  }, [current, mode, signalByKey, workflowLeadInput]);

  const scoredResult = useMemo(() => applyAiScoreOverrides(localResult, aiScores[mode]) as WorkbenchResult, [aiScores, localResult, mode]);
  const memoryAdjustedResult = useMemo(() => applyGrowthMemoryToQueueItems(scoredResult, growthMemory) as WorkbenchResult, [growthMemory, scoredResult]);
  const result = useMemo(() => applyAiDraftOverrides(memoryAdjustedResult, aiDrafts[mode]) as WorkbenchResult, [aiDrafts, mode, memoryAdjustedResult]);
  const scoreSourceItems: QueueItem[] = localResult.opportunities;
  const draftSourceItems: QueueItem[] = memoryAdjustedResult.mode === "outbound" ? memoryAdjustedResult.leads : memoryAdjustedResult.opportunities;
  const items: QueueItem[] = result.mode === "outbound" ? result.leads : result.opportunities;
  const hotCount = items.filter((item) => item.label === (result.mode === "outbound" ? "High intent" : "Engage now")).length;
  const draftCount = result.mode === "outbound" ? result.leads.length : result.opportunities.length * 4;
  const averageScore = items.length ? Math.round(items.reduce((sum, item) => sum + item.score, 0) / items.length) : 0;
  const topItem = items[0];
  const ownAccountIdentity = useMemo(() => buildOwnAccountIdentity(current, loadXProfileConfig().profileUrl), [current]);
  const dailyItems = useMemo(
    () => items.filter((item) => normalizeExecutionStatus(signalByKey.get(queueItemSignalKey(item))?.status) === "new").slice(0, 5),
    [items, signalByKey]
  );
  const executionStats = useMemo((): ExecutionStats => {
    const byStatus = emptyExecutionCounts();
    const byFeedback = emptyFeedbackCounts();
    for (const item of items) {
      const signal = signalByKey.get(queueItemSignalKey(item));
      const status = normalizeExecutionStatus(signal?.status);
      const feedback = normalizeFeedbackStatus(signal?.feedback);
      byStatus[status] += 1;
      byFeedback[feedback] += 1;
    }

    const todaySignals = (signals[mode] ?? []).filter((signal) => normalizeExecutionStatus(signal.status) !== "new" && isToday(signal.processedAt));
    const todayFeedbackSignals = (signals[mode] ?? []).filter((signal) => normalizeFeedbackStatus(signal.feedback) !== "none" && isToday(signal.feedbackAt));
    const total = items.length;
    const pending = byStatus.new;
    const processed = Math.max(0, total - pending);

    return {
      total,
      pending,
      processed,
      processedToday: todaySignals.length,
      repliedToday: todaySignals.filter((signal) => normalizeExecutionStatus(signal.status) === "replied").length,
      quotedToday: todaySignals.filter((signal) => normalizeExecutionStatus(signal.status) === "quoted").length,
      savedToday: todaySignals.filter((signal) => normalizeExecutionStatus(signal.status) === "saved").length,
      skippedToday: todaySignals.filter((signal) => normalizeExecutionStatus(signal.status) === "skipped").length,
      completionRate: total > 0 ? Math.round((processed / total) * 100) : 0,
      byStatus,
      feedbackToday: todayFeedbackSignals.length,
      positiveFeedback: byFeedback.got_reply + byFeedback.followed + byFeedback.reshared,
      byFeedback,
    };
  }, [items, mode, signalByKey, signals]);
  const recentProcessedSignals = useMemo(
    () =>
      [...(signals[mode] ?? [])]
        .filter((signal) => normalizeExecutionStatus(signal.status) !== "new" && Boolean(signal.processedAt))
        .sort((left, right) => new Date(right.processedAt || 0).getTime() - new Date(left.processedAt || 0).getTime())
        .slice(0, 5),
    [mode, signals]
  );

  const stages = [
    { label: "监听", value: result.queries.length, detail: "Grok 提示词" },
    { label: "排序", value: items.length, detail: result.mode === "outbound" ? "线索" : "信号" },
    { label: "生成", value: draftCount, detail: "内容资产" },
    { label: "执行", value: hotCount, detail: copy.hotLabel },
  ];

  function updateField(field: keyof FormState, value: string) {
    setForms((previous) => ({
      ...previous,
      [mode]: {
        ...previous[mode],
        [field]: value,
      },
    }));
  }

  async function saveCurrentWorkbench() {
    if (!isWorkbenchReady) {
      showToast("工作台还在加载，请稍后再保存。", "info");
      return;
    }

    try {
      savedPositioningFormsRef.current = forms;
      setSavedPositioningVersion((value) => value + 1);
      const value = JSON.parse(
        serializeWorkbenchState({
          mode,
          forms,
          grokBridge,
          signals,
          aiScores,
          aiDrafts,
          growthMemory,
          onboarding,
        })
      ) as object;
      await persistWorkbenchSnapshot(value);
      showToast("已保存当前定位。", "success");
    } catch {
      showToast("保存失败：无法写入本机数据库，请确认本地服务仍在运行。", "error");
    }
  }

  async function runAiProfileAutofill(onRetry?: AiProfileRetryHandler): Promise<AiProfileRunResult> {
    const xProfileConfig = loadXProfileConfig();
    if (!xProfileConfig.profileUrl.trim()) {
      throw new Error("请先到设置页保存 X 主页地址，再让 AI 帮你生成定位。");
    }

    const aiConfig = loadAiResponseConfig();
    if (!aiConfig.apiKey.trim()) {
      throw new Error("请先到设置页配置 GPT-5.5 / codeproxy 密钥，再用 AI 生成定位。");
    }

    const requestBody = JSON.stringify({
      mode,
      locale,
      xProfileUrl: xProfileConfig.profileUrl,
      current: {
        productName: current.productName,
        description: current.description,
        targetCustomer: current.targetCustomer,
        competitors: current.competitors,
        painPoints: current.painPoints,
        replyGoal: current.replyGoal,
        productContext: current.productContext,
      },
      apiKey: aiConfig.apiKey,
      model: aiConfig.model,
      endpoint: aiConfig.endpoint,
    });

    let data: ProfileApiResponse = {};
    let lastMessage = locale === "en" ? "AI positioning generation failed." : "AI 定位生成失败。";

    for (let attempt = 0; attempt <= PROFILE_MAX_RETRIES; attempt += 1) {
      let responseStatus = 0;
      try {
        const response = await fetch("/api/profile", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: requestBody,
        });
        responseStatus = response.status;
        data = (await response.json().catch(() => ({
          message: locale === "en" ? "The AI service returned an unreadable response." : "AI 服务返回了无法读取的响应。",
          retryable: response.ok || response.status >= 500,
          status: "invalid_response",
        }))) as ProfileApiResponse;

        if (response.ok && data.ok && data.profile) break;

        lastMessage = data.message || (locale === "en" ? "AI positioning generation failed." : "AI 定位生成失败。");
        const retryable = isRetryableProfileFailure({
          httpStatus: responseStatus,
          retryable: data.retryable,
          status: data.status,
        });
        if (!retryable) throw new Error(lastMessage);
      } catch (error) {
        if (error instanceof Error && responseStatus > 0) throw error;
        lastMessage = error instanceof Error && error.message
          ? error.message
          : locale === "en"
            ? "The AI request could not reach the local service."
            : "AI 请求未能连接到本地服务。";
      }

      const retryNumber = attempt + 1;
      if (retryNumber > PROFILE_MAX_RETRIES) {
        throw new Error(locale === "en"
          ? `Still unsuccessful after ${PROFILE_MAX_RETRIES} automatic retries. Last error: ${lastMessage}`
          : `自动重试 ${PROFILE_MAX_RETRIES} 次后仍未成功。最后一次错误：${lastMessage}`);
      }

      onRetry?.({ maxRetries: PROFILE_MAX_RETRIES, reason: lastMessage, retryNumber });
      await new Promise((resolve) => window.setTimeout(resolve, profileRetryDelayMs(retryNumber)));
    }

    if (!data.ok || !data.profile) {
      throw new Error(lastMessage);
    }

    const profile = data.profile as AiProfile;
    const autofillFields = ["productName", "competitors", "description", "targetCustomer", "painPoints", "replyGoal", "productContext"] as const;
    setForms((previous) => {
      const nextModeForm = { ...previous[mode] };
      for (const field of autofillFields) {
        const value = String(profile[field] ?? "").trim();
        if (value) nextModeForm[field] = value;
      }
      return { ...previous, [mode]: nextModeForm };
    });

    return { model: data.model || "AI", profile };
  }

  function downloadCsv() {
    if (result.mode === "outbound") {
      const header = ["平台", "名称", "链接", "分数", "标签", "原因", "备注", "草稿"];
      const rows = result.leads.map((lead) =>
        [lead.platform, lead.name, lead.url, lead.score, displayLabel(lead.label), lead.reasons.join("; "), lead.note, lead.draft]
          .map(csvEscape)
          .join(",")
      );
      downloadFile(copy.csvName, [header.join(","), ...rows]);
      return;
    }

    const header = ["平台", "名称", "链接", "分数", "标签", "动作", "原因", "备注", "回复", "引用", "选题", "私下跟进"];
    const rows = result.opportunities.map((item) =>
      [
        item.platform,
        item.name,
        item.url,
        item.score,
        displayLabel(item.label),
        item.action,
        item.reasons.join("; "),
        item.note,
        item.replyDraft,
        item.quoteDraft,
        item.postIdea,
        item.outreachDraft,
      ]
        .map(csvEscape)
        .join(",")
    );
    downloadFile(copy.csvName, [header.join(","), ...rows]);
  }

  function copyAllDrafts() {
    if (result.mode === "outbound") {
      copyText(result.leads.map((lead, index) => `${index + 1}. ${lead.name}\n${lead.draft}`).join("\n\n"));
      return;
    }
    copyText(
      result.opportunities
        .map((item, index) => `${index + 1}. ${item.name}\n直接回复：${item.replyDraft}\n引用转发：${item.quoteDraft}\n内容选题：${item.postIdea}\n私下跟进：${item.outreachDraft}`)
        .join("\n\n")
    );
  }

  function replaceModeSignals(nextSignals: Signal[]) {
    setSignals((previous) => ({ ...previous, [mode]: nextSignals }));
    updateField("leadInput", formatSignalsAsLeadInput(nextSignals));
  }

  function deleteSignalItems(targetItems: QueueItem[], options?: { silent?: boolean }) {
    if (targetItems.length === 0) return;

    const targetKeys = new Set(targetItems.map((item) => queueItemSignalKey(item)));
    const manualSignals = parseSignalsFromText(current.leadInput, { source: "manual" }) as Signal[];
    const existingSignals = mergeSignals(signals[mode] ?? [], manualSignals).signals as Signal[];
    const nextSignals = existingSignals.filter((signal) => !targetKeys.has(signalDedupKey(signal)));

    replaceModeSignals(nextSignals);
    setAiScores((previous) => {
      const nextModeScores = { ...(previous[mode] ?? {}) };
      targetKeys.forEach((key) => delete nextModeScores[key]);
      return { ...previous, [mode]: nextModeScores };
    });
    setAiDrafts((previous) => {
      const nextModeDrafts = { ...(previous[mode] ?? {}) };
      targetKeys.forEach((key) => delete nextModeDrafts[key]);
      return { ...previous, [mode]: nextModeDrafts };
    });

    if (!options?.silent) showToast("已删除 " + targetKeys.size + " 条线索。", "success");
  }

  function updateSignalStatuses(items: QueueItem[], status: SignalExecutionStatus, options?: { silent?: boolean }) {
    if (items.length === 0) return;

    const now = new Date().toISOString();
    const targetItems = new Map(items.map((item) => [queueItemSignalKey(item), item]));
    const manualSignals = parseSignalsFromText(current.leadInput, { source: "manual" }) as Signal[];
    const existingSignals = mergeSignals(signals[mode] ?? [], manualSignals).signals as Signal[];
    const updatedKeys = new Set<string>();
    const nextSignals = existingSignals.map((signal) => {
      const key = signalDedupKey(signal);
      if (!targetItems.has(key)) return signal;

      updatedKeys.add(key);
      const updated: Signal = { ...signal, status };
      if (status === "new") {
        delete updated.processedAt;
        delete updated.processedAction;
        delete updated.feedback;
        delete updated.feedbackAt;
        delete updated.usedDraft;
        delete updated.usedDraftAt;
      } else {
        updated.processedAt = now;
        updated.processedAction = status;
      }
      return updated;
    });

    [...items].reverse().forEach((item) => {
      const key = queueItemSignalKey(item);
      if (updatedKeys.has(key)) return;
      nextSignals.unshift(
        createSignal({
          platform: item.platform,
          author: item.name,
          url: item.url,
          text: item.note,
          source: "manual",
          status,
          processedAt: status === "new" ? "" : now,
          processedAction: status === "new" ? "" : status,
        }) as Signal
      );
    });

    replaceModeSignals(nextSignals);
    if (!options?.silent) {
      const countText = items.length > 1 ? items.length + " 条" : "";
      showToast("已" + countText + "标记为" + executionStatusLabel(status, mode) + "。", "success");
    }
  }

  function updateSignalStatus(item: QueueItem, status: SignalExecutionStatus, options?: { silent?: boolean }) {
    updateSignalStatuses([item], status, options);
  }
  function updateSignalFeedback(item: QueueItem, feedback: SignalFeedbackStatus) {
    const targetKey = queueItemSignalKey(item);
    const now = new Date().toISOString();
    const manualSignals = parseSignalsFromText(current.leadInput, { source: "manual" }) as Signal[];
    const existingSignals = mergeSignals(signals[mode] ?? [], manualSignals).signals as Signal[];
    let found = false;
    const nextSignals = existingSignals.map((signal) => {
      if (signalDedupKey(signal) !== targetKey) return signal;
      found = true;
      const updated: Signal = { ...signal };
      if (feedback === "none") {
        delete updated.feedback;
        delete updated.feedbackAt;
      } else {
        updated.feedback = feedback;
        updated.feedbackAt = now;
      }
      return updated;
    });

    if (!found) {
      nextSignals.unshift(
        createSignal({
          platform: item.platform,
          author: item.name,
          url: item.url,
          text: item.note,
          source: "manual",
          status: "new",
          feedback: feedback === "none" ? "" : feedback,
          feedbackAt: feedback === "none" ? "" : now,
        }) as Signal
      );
    }

    replaceModeSignals(nextSignals);
    showToast(feedback === "none" ? "已清除反馈结果。" : `已标记反馈：${feedbackStatusLabel(feedback)}。`, feedback === "none" ? "info" : "success");
  }

  function updateSignalUsedDraft(item: QueueItem, usedDraft: string) {
    const targetKey = queueItemSignalKey(item);
    const value = usedDraft.trim();
    const now = new Date().toISOString();
    const manualSignals = parseSignalsFromText(current.leadInput, { source: "manual" }) as Signal[];
    const existingSignals = mergeSignals(signals[mode] ?? [], manualSignals).signals as Signal[];
    let found = false;
    const nextSignals = existingSignals.map((signal) => {
      if (signalDedupKey(signal) !== targetKey) return signal;
      found = true;
      const updated: Signal = { ...signal };
      if (value) {
        updated.usedDraft = value;
        updated.usedDraftAt = now;
      } else {
        delete updated.usedDraft;
        delete updated.usedDraftAt;
      }
      return updated;
    });

    if (!found && value) {
      nextSignals.unshift(
        createSignal({
          platform: item.platform,
          author: item.name,
          url: item.url,
          text: item.note,
          source: "manual",
          status: "new",
          usedDraft: value,
          usedDraftAt: now,
        }) as Signal
      );
    }

    replaceModeSignals(nextSignals);
    showToast(value ? "已保存实际采用的话术。" : "已清除实际采用的话术。", value ? "success" : "info");
  }

  async function withBusyOverlay<T>(overlay: NonNullable<BusyOverlayState>, task: () => Promise<T>): Promise<T> {
    setBusyOverlay(overlay);
    try {
      return await task();
    } finally {
      setBusyOverlay(null);
    }
  }

  async function runAiScoring(targetItems: QueueItem[] = scoreSourceItems): Promise<AiScoreRunResult> {
    const payload = buildScoreRequestInput({
      mode,
      locale,
      profile: {
        productName: current.productName,
        description: current.description,
        targetCustomer: current.targetCustomer,
        competitors: current.competitors,
        painPoints: current.painPoints,
      },
      items: targetItems,
      growthMemory,
    });

    if (payload.items.length === 0) {
      throw new Error("当前队列没有可评分的信号。");
    }

    const aiConfig = loadAiResponseConfig();
    if (!aiConfig.apiKey.trim()) {
      throw new Error("请先到设置页面配置 GPT-5.5 / codeproxy 密钥，再运行 AI 评分。");
    }

    return withBusyOverlay(
      {
        title: "AI 正在评分",
        message: `正在分析 ${Math.min(payload.items.length, AI_SCORE_LIMIT)} 条互动信号，并判断优先级。`,
        detail: "这一步会请求 GPT-5.5，可能需要 30-120 秒。请保持页面打开，完成后会自动回到队列。",
      },
      async () => {
        const response = await fetch("/api/score", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...payload, apiKey: aiConfig.apiKey, model: aiConfig.model, endpoint: aiConfig.endpoint }),
        });
        const data = (await response.json().catch(() => ({ message: "AI 评分请求失败。" }))) as ScoreApiResponse;

        if (!response.ok || !data.ok || !Array.isArray(data.scores)) {
          throw new Error(data.message || "AI 评分失败，已保留本地规则评分。");
        }

        const nextScores = Object.fromEntries(data.scores.map((score) => [score.itemId, score]));
        setAiScores((previous) => ({
          ...previous,
          [mode]: {
            ...previous[mode],
            ...nextScores,
          },
        }));

        return { count: data.scores.length, model: data.model || "AI" };
      }
    );
  }

  async function runAiDrafting(targetItems: QueueItem[] = draftSourceItems): Promise<AiDraftRunResult> {
    const payload = buildDraftRequestInput({
      mode,
      locale,
      profile: {
        productName: current.productName,
        description: current.description,
        targetCustomer: current.targetCustomer,
        competitors: current.competitors,
        painPoints: current.painPoints,
        replyGoal: current.replyGoal,
        productContext: current.productContext,
      },
      items: targetItems,
      feedbackSignals: signals[mode] ?? [],
      growthMemory,
    });

    if (payload.items.length === 0) {
      throw new Error("当前队列没有可生成草稿的信号。");
    }

    const aiConfig = loadAiResponseConfig();
    if (!aiConfig.apiKey.trim()) {
      throw new Error("请先到设置页面配置 GPT-5.5 / codeproxy 密钥，再运行 AI 草稿生成。");
    }

    const draftItems = payload.items.slice(0, AI_DRAFT_LIMIT);
    const totalCount = draftItems.length;

    return withBusyOverlay(
      {
        title: "AI 正在生成草稿",
        message: `正在为 ${totalCount} 条互动信号生成回复角度。`,
        detail: "现在会逐条生成、逐条保存。某条超时不会影响已经生成成功的草稿。",
      },
      async () => {
        let nextIndex = 0;
        let completedCount = 0;
        let savedCount = 0;
        let resolvedModel = "AI";
        const failedItems: string[] = [];
        const failedDiagnosticIds = new Set<number>();
        const concurrency = Math.min(2, totalCount);

        async function generateOneDraft(index: number) {
          const item = draftItems[index];
          const displayName = item.name || item.platform || `第 ${index + 1} 条`;
          setBusyOverlay({
            title: "AI 正在生成草稿",
            message: `正在生成第 ${index + 1}/${totalCount} 条：${displayName}`,
            detail: `已完成 ${completedCount}/${totalCount} 条，已保存 ${savedCount} 条。成功的草稿会立即进入队列。`,
          });

          try {
            const response = await fetch("/api/drafts", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ ...payload, items: [item], apiKey: aiConfig.apiKey, model: aiConfig.model, endpoint: aiConfig.endpoint }),
            });
            const data = (await response.json().catch(() => ({ message: "AI 草稿生成请求失败。" }))) as DraftApiResponse;

            if (!response.ok || !data.ok || !Array.isArray(data.drafts)) {
              if (data.diagnosticId) failedDiagnosticIds.add(data.diagnosticId);
              const diagnosticLabel = data.diagnosticId ? `（日志 #${data.diagnosticId}）` : "";
              throw new Error(`${data.message || "AI 草稿生成失败，已保留本地规则草稿。"}${diagnosticLabel}`);
            }

            if (data.model) resolvedModel = data.model;
            const generatedAt = new Date().toISOString();
            const nextDrafts = Object.fromEntries(data.drafts.map((draft) => [draft.itemId, { ...draft, model: data.model || resolvedModel, generatedAt }]));
            const generatedCount = Object.keys(nextDrafts).length;

            if (generatedCount === 0) {
              failedItems.push(displayName);
              if (data.diagnosticId) failedDiagnosticIds.add(data.diagnosticId);
              return;
            }

            savedCount += generatedCount;
            setAiDrafts((previous) => ({
              ...previous,
              [mode]: {
                ...previous[mode],
                ...nextDrafts,
              },
            }));
          } catch (error) {
            failedItems.push(displayName);
            const errorMessage = formatActionError(error, "AI 草稿生成失败。");
            showToast(`${displayName} 草稿生成失败：${errorMessage}`, "error");
          } finally {
            completedCount += 1;
            setBusyOverlay({
              title: "AI 正在生成草稿",
              message: `已完成 ${completedCount}/${totalCount} 条，已保存 ${savedCount} 条。`,
              detail: completedCount < totalCount ? "剩余条目还在继续生成，成功结果会继续自动保存。" : "正在收尾并刷新队列。",
            });
          }
        }

        async function worker() {
          while (nextIndex < totalCount) {
            const index = nextIndex;
            nextIndex += 1;
            await generateOneDraft(index);
          }
        }

        await Promise.all(Array.from({ length: concurrency }, () => worker()));

        if (savedCount === 0) {
          const diagnosticLabel = failedDiagnosticIds.size
            ? ` 日志编号：${Array.from(failedDiagnosticIds).map((id) => `#${id}`).join("、")}。`
            : "";
          throw new Error(`AI 草稿生成没有成功保存任何结果。${diagnosticLabel}可以稍后重试，或先少选几条再跑。`);
        }

        return {
          count: savedCount,
          model: resolvedModel,
          failedCount: failedItems.length,
          failedDiagnosticIds: Array.from(failedDiagnosticIds),
        };
      }
    );
  }

  function applyXFeedbackPullUpdates(targetItems: QueueItem[], updates: XFeedbackPullUpdate[]) {
    const validUpdates = updates.filter((update) => !update.skipped && update.itemId && normalizeFeedbackStatus(update.feedback) !== "none");
    if (validUpdates.length === 0) return;

    const itemByKey = new Map(targetItems.map((item) => [queueItemSignalKey(item), item]));
    const updateByKey = new Map(validUpdates.map((update) => [update.itemId, update]));
    const manualSignals = parseSignalsFromText(current.leadInput, { source: "manual" }) as Signal[];
    const existingSignals = mergeSignals(signals[mode] ?? [], manualSignals).signals as Signal[];
    const foundKeys = new Set<string>();

    const nextSignals = existingSignals.map((signal) => {
      const key = signalDedupKey(signal);
      const update = updateByKey.get(key);
      if (!update) return signal;

      foundKeys.add(key);
      const checkedAt = update.checkedAt || new Date().toISOString();
      return {
        ...signal,
        feedback: normalizeFeedbackStatus(update.feedback),
        feedbackAt: checkedAt,
      };
    });

    for (const update of validUpdates) {
      if (foundKeys.has(update.itemId)) continue;
      const item = itemByKey.get(update.itemId);
      if (!item) continue;
      const checkedAt = update.checkedAt || new Date().toISOString();
      nextSignals.unshift(
        createSignal({
          platform: item.platform,
          author: item.name,
          url: item.url,
          text: item.note,
          source: "x-feedback",
          status: normalizeExecutionStatus(update.status),
          feedback: normalizeFeedbackStatus(update.feedback),
          feedbackAt: checkedAt,
        }) as Signal
      );
    }

    replaceModeSignals(nextSignals);
  }

  async function runGrowthMemoryLearning(onRetry?: GrowthMemoryRetryHandler): Promise<GrowthMemoryRunResult> {
    const payload = buildGrowthMemoryRequestInput({
      mode,
      locale,
      profile: {
        productName: current.productName,
        description: current.description,
        targetCustomer: current.targetCustomer,
        competitors: current.competitors,
        painPoints: current.painPoints,
        replyGoal: current.replyGoal,
        productContext: current.productContext,
      },
      signals: signals[mode] ?? [],
      aiScores: aiScores[mode] ?? {},
      aiDrafts: aiDrafts[mode] ?? {},
      previousMemory: growthMemory,
    });

    if (payload.samples.length === 0) {
      const hasFeedback = (signals[mode] ?? []).some((signal) => normalizeFeedbackStatus(signal.feedback) !== "none");
      throw new Error(hasFeedback
        ? "当前反馈已经学习过了。请先处理新的互动并标记反馈，再增长到下一轮。"
        : "还没有可学习的反馈样本。先在互动队列里标记有回复、无回复、被关注或被转发。");
    }

    const aiConfig = loadAiResponseConfig();
    if (!aiConfig.apiKey.trim()) {
      throw new Error("请先到设置页面配置 GPT-5.5 / codeproxy 密钥，再生成增长记忆。");
    }

    const requestBody = JSON.stringify({ ...payload, apiKey: aiConfig.apiKey, model: aiConfig.model, endpoint: aiConfig.endpoint });
    let data: GrowthMemoryApiResponse = {};
    let lastMessage = locale === "en" ? "Growth-memory generation failed." : "增长记忆生成失败。";
    let lastDiagnosticId: number | undefined;

    for (let attempt = 0; attempt <= PROFILE_MAX_RETRIES; attempt += 1) {
      let responseStatus = 0;
      try {
        const response = await fetch("/api/memory", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: requestBody,
        });
        responseStatus = response.status;
        data = (await response.json().catch(() => ({
          message: locale === "en" ? "The growth-memory service returned an unreadable response." : "增长记忆服务返回了无法读取的响应。",
          retryable: response.ok || response.status >= 500,
          status: "invalid_response",
        }))) as GrowthMemoryApiResponse;

        if (response.ok && data.ok && data.memory) break;

        lastDiagnosticId = data.diagnosticId;
        lastMessage = grokFailureMessage(data, locale === "en" ? "Growth-memory generation failed." : "增长记忆生成失败。", locale);
        const retryable = isRetryableProfileFailure({
          httpStatus: responseStatus,
          retryable: data.retryable,
          status: data.status,
        });
        if (!retryable) {
          const error = new Error(lastMessage) as Error & { diagnosticId?: number };
          error.diagnosticId = lastDiagnosticId;
          throw error;
        }
      } catch (error) {
        if (error instanceof Error && responseStatus > 0) throw error;
        lastMessage = error instanceof Error && error.message
          ? error.message
          : locale === "en"
            ? "The growth-memory request could not reach the local service."
            : "增长记忆请求未能连接到本地服务。";
      }

      const retryNumber = attempt + 1;
      if (retryNumber > PROFILE_MAX_RETRIES) {
        const error = new Error(locale === "en"
          ? `Still unsuccessful after ${PROFILE_MAX_RETRIES} automatic retries. Last error: ${lastMessage}`
          : `自动重试 ${PROFILE_MAX_RETRIES} 次后仍未成功。最后一次错误：${lastMessage}`) as Error & { diagnosticId?: number };
        error.diagnosticId = lastDiagnosticId;
        throw error;
      }

      onRetry?.({ maxRetries: PROFILE_MAX_RETRIES, reason: lastMessage, retryNumber });
      await new Promise((resolve) => window.setTimeout(resolve, profileRetryDelayMs(retryNumber)));
    }

    if (!data.ok || !data.memory) {
      const error = new Error(lastMessage) as Error & { diagnosticId?: number };
      error.diagnosticId = lastDiagnosticId;
      throw error;
    }

    const mergedMemory = mergeGrowthMemoryState(growthMemory, data.memory, payload) as GrowthMemoryState;
    const nextMemory = normalizeGrowthMemoryState({
      ...mergedMemory,
      active: true,
      appliedAt: new Date().toISOString(),
    }) as GrowthMemoryState;
    setGrowthMemory(nextMemory);
    return {
      count: payload.samples.length,
      totalCount: nextMemory.sampleCount,
      model: data.model || "AI",
      stats: nextMemory.lastMergeStats,
    };
  }

  function clearGrowthMemory() {
    setGrowthMemory(DEFAULT_GROWTH_MEMORY_STATE as GrowthMemoryState);
  }

  async function runXFeedbackPull(targetItems: QueueItem[]): Promise<XFeedbackPullRunResult> {
    if (targetItems.length === 0) {
      throw new Error("请先勾选要自动拉取反馈的条目。");
    }

    const payloadItems = targetItems.map((item) => {
      const key = queueItemSignalKey(item);
      const signal = signalByKey.get(key);
      return {
        itemId: key,
        platform: item.platform,
        name: item.name,
        url: item.url,
        note: item.note,
        status: normalizeExecutionStatus(signal?.status),
        sourceUrl: item.url,
        replyUrl: signal?.replyUrl || "",
      };
    });
    const xProfileConfig = loadXProfileConfig();

    return withBusyOverlay(
      {
        title: "正在检查已保存回复链接",
        message: `正在检查 ${Math.min(payloadItems.length, 10)} 条已保存回复链接。`,
        detail: "只检查已经保存下来的你的回复链接，不再用原帖热度误判反馈，也不会替你自动回复。",
      },
      async () => {
        const response = await fetch("/api/feedback", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mode, items: payloadItems, selfProfileUrl: xProfileConfig.profileUrl }),
        });
        const data = (await response.json().catch(() => ({ message: "X 反馈拉取失败。" }))) as XFeedbackPullApiResponse;

        if (!response.ok || !data.ok || !Array.isArray(data.results)) {
          throw new Error(data.message || "X 反馈拉取失败。");
        }

        applyXFeedbackPullUpdates(targetItems, data.results);
        return { updatedCount: data.updatedCount ?? 0, skippedCount: data.skippedCount ?? 0 };
      }
    );
  }
  function exportWorkbenchBackup() {
    const backup = createWorkbenchBackup({ mode, forms, grokBridge, signals, aiScores, aiDrafts, growthMemory, onboarding });
    downloadTextFile(backup.filename, backup.json, "application/json;charset=utf-8");
  }

  function restoreWorkbenchBackupText(rawText: string) {
    const restored = parseWorkbenchBackup(rawText, {
      version: CURRENT_VERSION,
      mode: "growth",
      forms: initialState,
      grokBridge: DEFAULT_GROK_BRIDGE_STATE,
      signals: DEFAULT_SIGNAL_STATE,
      aiScores: DEFAULT_AI_SCORE_STATE,
      aiDrafts: DEFAULT_AI_DRAFT_STATE,
      growthMemory: DEFAULT_GROWTH_MEMORY_STATE,
      onboarding: DEFAULT_ONBOARDING_STATE,
    });

    if (!restored.ok || !restored.state) {
      return { ok: false, message: "备份文件不是有效的 Ray Growth OS JSON。" };
    }

    const unified = unifyRestoredWorkbenchState(restored.state);
    savedPositioningFormsRef.current = unified.forms;
    setSavedPositioningVersion((value) => value + 1);
    setForms(unified.forms);
    setGrokBridge(unified.grokBridge);
    setSignals(unified.signals);
    setAiScores(unified.aiScores);
    setAiDrafts(unified.aiDrafts);
    setGrowthMemory(unified.growthMemory);
    setOnboarding(unified.onboarding);
    const value = JSON.parse(
      serializeWorkbenchState({
        mode,
        forms: unified.forms,
        grokBridge: unified.grokBridge,
        signals: unified.signals,
        aiScores: unified.aiScores,
        aiDrafts: unified.aiDrafts,
        growthMemory: unified.growthMemory,
        onboarding: unified.onboarding,
      })
    ) as object;
    void persistWorkbenchSnapshot(value).catch(() => {
      showToast("备份已恢复到当前页面，但写入本机数据库失败，请暂时不要刷新。", "error");
    });
    return { ok: true, message: "已恢复本地备份，历史模式数据已合并到增长机会工作台。" };
  }
  return (
    <main className="tech-shell surface-grid relative flex h-screen overflow-hidden text-foreground">
      <ActionToastHost />
      {busyOverlay ? <LongTaskOverlay title={busyOverlay.title} message={busyOverlay.message} detail={busyOverlay.detail} /> : null}
      {showWelcomeGuide ? (
        <WelcomeOnboardingModal
          onClose={() => dismissWelcomeGuide(false)}
          onStart={() => dismissWelcomeGuide(true)}
        />
      ) : null}
      {showOnboardingTasks ? (
        <OnboardingTaskPanel
          tasks={onboardingTasks}
          completedCount={completedOnboardingCount}
          onClose={() => setShowOnboardingTasks(false)}
          onOpenWelcome={() => {
            setShowOnboardingTasks(false);
            setShowWelcomeGuide(true);
          }}
          onSelectTask={navigateToOnboardingTask}
        />
      ) : null}
      <DashboardSidebar activeTab={activeTab} setActiveTab={setActiveTab} />

      <div className="relative z-10 flex min-w-0 flex-1 flex-col">
        <DashboardTopbar
          activeTab={activeTab}
          urgentCount={hotCount}
          downloadCsv={downloadCsv}
          completedOnboardingCount={completedOnboardingCount}
          onboardingTaskCount={onboardingTasks.length}
          onboardingQuestActive={onboardingQuestActive}
          onOpenGuide={openOnboardingTasks}
        />

        <section key={activeTab} className="min-h-0 flex-1 overflow-y-auto px-4 py-4 pb-24 md:px-6 md:pb-6 lg:px-8">
          <div className="mx-auto grid max-w-[1480px] animate-fade-in-up gap-4">
            {onboardingQuestActive ? (
              <OnboardingQuestBanner
                completedCount={completedOnboardingCount}
                task={firstIncompleteOnboardingTask}
                onContinue={() => navigateToOnboardingTask(firstIncompleteOnboardingTask)}
                onOpenTasks={openOnboardingTasks}
              />
            ) : null}
            {activeTab === "overview" ? (
              <OverviewTab mode={mode} copy={copy} result={result} topItem={topItem} averageScore={averageScore} hotCount={hotCount} setActiveTab={setActiveTab} />
            ) : null}

            {activeTab === "search" ? (
              <SearchRadarTab
                mode={mode}
                copy={copy}
                current={current}
                updateField={updateField}
                onGenerateProfile={runAiProfileAutofill}
                onSaveProfile={saveCurrentWorkbench}
                grokBridge={grokBridge}
                setGrokBridge={setGrokBridge}
                modeSignals={signals[mode]}
                setModeSignals={replaceModeSignals}
                exportBackup={exportWorkbenchBackup}
                restoreBackupText={restoreWorkbenchBackupText}
                growthMemory={growthMemory}
                highlightedTarget={highlightedOnboardingTarget}
              />
            ) : null}

            {activeTab === "account" ? (
              <GrokBridgePanel
                variant="account"
                mode={mode}
                current={current}
                updateField={updateField}
                grokBridge={grokBridge}
                setGrokBridge={setGrokBridge}
                modeSignals={signals[mode]}
                setModeSignals={replaceModeSignals}
                growthMemory={growthMemory}
              />
            ) : null}

            {activeTab === "engage" ? (
              <div
                data-onboarding-target="queue"
                className={cn("relative scroll-mt-24 rounded-lg", highlightedOnboardingTarget === "queue" && "onboarding-target-active")}
              >
                {highlightedOnboardingTarget === "queue" ? <OnboardingTargetMarker /> : null}
                <EngageTab
                  mode={mode}
                  result={result}
                  signalByKey={signalByKey}
                  onUpdateSignalStatus={updateSignalStatus}
                  onBatchUpdateSignalStatus={updateSignalStatuses}
                  onUpdateSignalFeedback={updateSignalFeedback}
                  onUpdateSignalUsedDraft={updateSignalUsedDraft}
                  onDeleteItems={deleteSignalItems}
                  ownAccountIdentity={ownAccountIdentity}
                  copyAllDrafts={copyAllDrafts}
                  aiScoreCount={Object.keys(aiScores[mode]).length}
                  aiDraftCount={Object.keys(aiDrafts[mode]).length}
                  styleSampleCount={(signals[mode] ?? []).filter((signal) => ["got_reply", "followed", "reshared"].includes(normalizeFeedbackStatus(signal.feedback)) && Boolean(signal.usedDraft)).length}
                  runAiScoring={runAiScoring}
                  runAiDrafting={runAiDrafting}
                  runGrowthMemoryLearning={runGrowthMemoryLearning}
                  clearGrowthMemory={clearGrowthMemory}
                  onFindPeople={() => setActiveTab("search")}
                  growthMemory={growthMemory}
                  executionStats={executionStats}
                  recentProcessedSignals={recentProcessedSignals}
                  signals={signals[mode] ?? []}
                />
              </div>
            ) : null}


          </div>
        </section>
      </div>

      <MobileDashboardNav activeTab={activeTab} setActiveTab={setActiveTab} />
    </main>
  );
}

function DashboardSidebar({ activeTab, setActiveTab }: { activeTab: DashboardTab; setActiveTab: Dispatch<SetStateAction<DashboardTab>> }) {
  const { locale, t } = useI18n();
  const [contactOpen, setContactOpen] = useState(false);
  const tabs = localizedDashboardTabs(locale);
  const workflowTabs = tabs.filter((tab) => tab.value !== "account");
  const insightTabs = tabs.filter((tab) => tab.value === "account");
  return (
    <>
    <aside className="group/sidebar relative z-20 hidden h-screen w-16 shrink-0 overflow-hidden border-r border-white/[0.08] bg-[#08090d]/95 pl-3 pr-2 pb-20 backdrop-blur-xl transition-[width] duration-300 ease-out hover:w-44 md:flex md:flex-col md:items-start md:gap-2 md:pt-4">
      <div className="grid h-10 w-10 place-items-center rounded-lg border border-white/[0.08] bg-white/[0.045] text-white transition-transform duration-200 hover:scale-105 [&_svg]:transition-transform [&_svg]:duration-200 hover:[&_svg]:scale-125">
        <Command className="h-5 w-5" />
      </div>
      <nav className="mt-4 grid gap-2">
        <div className="grid gap-2">
          {workflowTabs.map((tab) => (
            <SidebarTabButton key={tab.value} tab={tab} activeTab={activeTab} setActiveTab={setActiveTab} />
          ))}
        </div>
        <div className="my-1 h-px w-10 bg-white/[0.08] transition-[width] duration-300 group-hover/sidebar:w-36" />
        <p className="hidden px-3 text-[10px] font-bold uppercase tracking-[0.16em] text-white/25 opacity-0 transition-opacity duration-200 group-hover/sidebar:block group-hover/sidebar:opacity-100">{t("insightTools")}</p>
        <div className="grid gap-2">
          {insightTabs.map((tab) => (
            <SidebarTabButton key={tab.value} tab={tab} activeTab={activeTab} setActiveTab={setActiveTab} />
          ))}
        </div>
      </nav>
      <div className="mt-auto mb-4 grid gap-2">
        <button
          type="button"
          onClick={() => setContactOpen(true)}
          aria-label={locale === "en" ? "Contact me" : "联系我"}
          title={locale === "en" ? "Contact me" : "联系我"}
          className="flex h-10 w-10 items-center justify-center gap-3 overflow-hidden rounded-lg border border-emerald-300/15 bg-emerald-400/[0.06] px-0 text-emerald-100/70 transition-all duration-200 hover:scale-105 hover:border-emerald-200/30 hover:bg-emerald-400/12 hover:text-emerald-100 active:scale-95 group-hover/sidebar:w-36 group-hover/sidebar:justify-start group-hover/sidebar:px-3 [&_svg]:shrink-0 [&_svg]:transition-transform [&_svg]:duration-200 hover:[&_svg]:scale-125 active:[&_svg]:scale-110"
        >
          <MessageCircle className="h-5 w-5" />
          <span className="hidden min-w-0 truncate text-sm font-bold opacity-0 transition-opacity duration-200 group-hover/sidebar:block group-hover/sidebar:opacity-100">{locale === "en" ? "Contact me" : "联系我"}</span>
        </button>
        <Link
          href="/help"
          aria-label={locale === "en" ? "Help" : "帮助"}
          title={locale === "en" ? "Help" : "帮助"}
          className="flex h-10 w-10 items-center justify-center gap-3 overflow-hidden rounded-lg border border-white/[0.08] bg-white/[0.025] px-0 text-white/50 transition-all duration-200 hover:scale-105 hover:border-white/[0.16] hover:bg-white/[0.06] hover:text-white active:scale-95 group-hover/sidebar:w-36 group-hover/sidebar:justify-start group-hover/sidebar:px-3 [&_svg]:shrink-0 [&_svg]:transition-transform [&_svg]:duration-200 hover:[&_svg]:scale-125 active:[&_svg]:scale-110"
        >
          <CircleHelp className="h-5 w-5" />
          <span className="hidden min-w-0 truncate text-sm font-bold opacity-0 transition-opacity duration-200 group-hover/sidebar:block group-hover/sidebar:opacity-100">{locale === "en" ? "Help" : "帮助"}</span>
        </Link>
        <Link
          href="/settings"
          aria-label={t("settings")}
          title={t("settings")}
          className="flex h-11 w-10 items-center justify-center gap-3 overflow-hidden rounded-lg border border-blue-300/25 bg-blue-400/12 px-0 text-blue-100 shadow-lg shadow-blue-500/10 transition-all duration-200 hover:scale-105 hover:border-blue-200/45 hover:bg-blue-400/20 hover:text-white active:scale-95 group-hover/sidebar:w-36 group-hover/sidebar:justify-start group-hover/sidebar:px-3 [&_svg]:shrink-0 [&_svg]:transition-transform [&_svg]:duration-200 hover:[&_svg]:scale-125 active:[&_svg]:scale-110"
        >
          <Settings className="h-5 w-5" />
          <span className="hidden min-w-0 truncate text-sm font-bold opacity-0 transition-opacity duration-200 group-hover/sidebar:block group-hover/sidebar:opacity-100">{t("settings")}</span>
        </Link>
      </div>
    </aside>
    <ContactMeDialog open={contactOpen} onClose={() => setContactOpen(false)} />
    </>
  );
}

function SidebarTabButton({
  tab,
  activeTab,
  setActiveTab,
}: {
  tab: { value: DashboardTab; label: string; icon: ReactNode };
  activeTab: DashboardTab;
  setActiveTab: Dispatch<SetStateAction<DashboardTab>>;
}) {
  return (
    <button
      type="button"
      aria-label={tab.label}
      title={tab.label}
      onClick={() => setActiveTab(tab.value)}
      className={cn(
        "group relative flex h-10 w-10 items-center justify-center gap-3 overflow-hidden rounded-lg transition-all duration-200 hover:scale-105 active:scale-95 group-hover/sidebar:w-36 group-hover/sidebar:justify-start group-hover/sidebar:px-3 [&_svg]:shrink-0 [&_svg]:transition-transform [&_svg]:duration-200 hover:[&_svg]:scale-125 active:[&_svg]:scale-110",
        activeTab === tab.value ? "bg-blue-400/10 text-blue-100" : "text-white/40 hover:bg-white/[0.05] hover:text-white/70"
      )}
    >
      {activeTab === tab.value ? <span className="absolute -left-2 top-2 h-6 w-0.5 rounded-full bg-blue-300" /> : null}
      {tab.icon}
      <span className="hidden min-w-0 truncate text-sm font-semibold opacity-0 transition-opacity duration-200 group-hover/sidebar:block group-hover/sidebar:opacity-100">{tab.label}</span>
    </button>
  );
}

function MobileDashboardNav({ activeTab, setActiveTab }: { activeTab: DashboardTab; setActiveTab: Dispatch<SetStateAction<DashboardTab>> }) {
  const { locale } = useI18n();
  const [contactOpen, setContactOpen] = useState(false);
  const tabs = localizedDashboardTabs(locale);
  return (
    <>
    <nav className="fixed inset-x-3 bottom-3 z-50 grid grid-cols-6 rounded-lg border border-white/[0.08] bg-[#08090d]/90 p-1 shadow-2xl shadow-black/40 backdrop-blur-xl md:hidden">
      {tabs.map((tab) => (
        <button
          key={tab.value}
          type="button"
          onClick={() => setActiveTab(tab.value)}
          className={cn("grid h-[3.25rem] place-items-center rounded-md px-1 text-[10px] font-semibold transition-all duration-200", activeTab === tab.value ? "bg-blue-400/10 text-blue-100" : "text-white/45")}
          aria-label={tab.label}
        >
          {tab.icon}
          <span className="mt-1 leading-none">{tab.shortLabel}</span>
        </button>
      ))}
      <Link
        href="/help"
        className="grid h-[3.25rem] place-items-center rounded-md px-1 text-[10px] font-semibold text-white/45 transition-all duration-200"
        aria-label={locale === "en" ? "Help" : "帮助"}
      >
        <CircleHelp className="h-5 w-5" />
        <span className="mt-1 leading-none">{locale === "en" ? "Help" : "帮助"}</span>
      </Link>
      <button
        type="button"
        onClick={() => setContactOpen(true)}
        className="grid h-[3.25rem] place-items-center rounded-md px-1 text-[10px] font-semibold text-emerald-100/70 transition-all duration-200 hover:bg-emerald-400/[0.06]"
        aria-label={locale === "en" ? "Contact me" : "联系我"}
      >
        <MessageCircle className="h-5 w-5" />
        <span className="mt-1 leading-none">{locale === "en" ? "Contact" : "联系"}</span>
      </button>
    </nav>
    <ContactMeDialog open={contactOpen} onClose={() => setContactOpen(false)} />
    </>
  );
}

function ContactMeDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { locale } = useI18n();
  const tr = (zh: string, en: string) => (locale === "en" ? en : zh);

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [onClose, open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[110] grid place-items-center overflow-y-auto bg-black/75 p-4 backdrop-blur-md" role="dialog" aria-modal="true" aria-labelledby="contact-me-title">
      <button type="button" className="absolute inset-0 cursor-default" onClick={onClose} aria-label={tr("关闭联系窗口", "Close contact dialog")} />
      <div className="relative w-full max-w-md overflow-hidden rounded-xl border border-blue-300/20 bg-[#0b0d12] text-white shadow-2xl shadow-black/60">
        <button type="button" onClick={onClose} aria-label={tr("关闭", "Close")} className="absolute right-4 top-4 z-10 grid h-9 w-9 place-items-center rounded-lg border border-white/10 bg-black/35 text-white/60 backdrop-blur-sm transition-colors hover:bg-white/[0.1] hover:text-white">
          <X className="h-4 w-4" />
        </button>
        <div className="border-b border-white/[0.08] bg-blue-400/[0.06] px-5 py-5 sm:px-6">
          <Badge variant="outline" className="rounded-md border-emerald-300/20 bg-emerald-400/10 text-emerald-100">
            <MessageCircle className="mr-1 h-3.5 w-3.5" /> {tr("联系作者", "Contact the author")}
          </Badge>
          <h2 id="contact-me-title" className="mt-3 text-2xl font-black">{tr("微信扫码联系我", "Scan to contact me on WeChat")}</h2>
          <p className="mt-2 pr-8 text-sm leading-6 text-white/50">{tr("欢迎交流使用问题、反馈建议、合作与项目赞助。", "Questions, feedback, partnerships, and project sponsorships are welcome.")}</p>
        </div>
        <div className="p-5 sm:p-6">
          <div className="overflow-hidden rounded-xl border border-white/[0.08] bg-white p-3">
            <Image src="/contact-wechat.jpg" alt={tr("联系作者的微信二维码", "WeChat QR code to contact the author")} width={958} height={766} className="h-auto w-full" priority />
          </div>
          <p className="mt-4 text-center text-xs leading-5 text-white/40">{tr("请使用微信扫描二维码添加好友", "Scan this QR code with WeChat to add the author")}</p>
        </div>
      </div>
    </div>
  );
}

function DashboardTopbar({
  activeTab,
  urgentCount,
  downloadCsv,
  completedOnboardingCount,
  onboardingTaskCount,
  onboardingQuestActive,
  onOpenGuide,
}: {
  activeTab: DashboardTab;
  urgentCount: number;
  downloadCsv: () => void;
  completedOnboardingCount: number;
  onboardingTaskCount: number;
  onboardingQuestActive: boolean;
  onOpenGuide: () => void;
}) {
  const { locale, t } = useI18n();
  const tr = (zh: string, en: string) => (locale === "en" ? en : zh);
  return (
    <header className="relative z-20 flex h-auto shrink-0 flex-col gap-3 border-b border-white/[0.07] bg-[#08090d]/90 px-4 py-3 backdrop-blur-xl md:h-16 md:flex-row md:items-center md:justify-between md:px-6 lg:px-8">
      <div className="flex min-w-0 items-center gap-3">
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-white/[0.08] bg-white/[0.045] text-white md:hidden">
          <Command className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate text-sm font-black text-white">Ray Growth OS</p>
            <Badge variant="outline" className="rounded-md border-white/[0.08] bg-white/[0.04] text-white/50">{t("localMvp")}</Badge>
          </div>
          <p className="mt-1 text-xs font-semibold uppercase tracking-wide text-white/40">{dashboardTabLabel(activeTab, locale)}</p>
        </div>
      </div>

      <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:flex-nowrap">
        <Button
          type="button"
          size="sm"
          onClick={onOpenGuide}
          className={cn("h-9", onboardingQuestActive ? "tech-cta" : "tech-secondary")}
        >
          <CircleHelp className="h-4 w-4" />
          <span className="sm:hidden">
            {onboardingQuestActive
              ? tr(`新手 ${completedOnboardingCount}/${onboardingTaskCount}`, `Start ${completedOnboardingCount}/${onboardingTaskCount}`)
              : tr("指南", "Guide")}
          </span>
          <span className="hidden sm:inline">
            {onboardingQuestActive
              ? tr(`新手任务 ${completedOnboardingCount}/${onboardingTaskCount}`, `Getting started ${completedOnboardingCount}/${onboardingTaskCount}`)
              : tr("使用指南", "Guide")}
          </span>
        </Button>
        <Badge variant="outline" className="h-9 rounded-lg border-blue-300/15 bg-blue-400/10 px-3 text-blue-100">
          <Radar className="mr-1.5 h-3.5 w-3.5" /> {t("growthOpportunities")}
        </Badge>
        <LanguageToggle />
        <Button variant="outline" size="sm" onClick={downloadCsv} className="tech-secondary h-9">
          <Download className="h-4 w-4" /> {t("csv")}
        </Button>
        <Badge variant="outline" className="h-9 rounded-lg border-amber-300/15 bg-amber-400/10 px-3 text-amber-100">
          {urgentCount} {t("urgentActions")}
        </Badge>
      </div>
    </header>
  );
}

function WelcomeOnboardingModal({ onClose, onStart }: { onClose: () => void; onStart: () => void }) {
  const { locale } = useI18n();
  const tr = (zh: string, en: string) => (locale === "en" ? en : zh);
  const pages = [
    {
      title: tr("总览", "Overview"),
      description: tr("看清增长闭环、当前进度和下一步动作。", "See the growth loop, current progress, and next action."),
      icon: <HomeIcon className="h-5 w-5" />,
    },
    {
      title: tr("定位找人", "Find people"),
      description: tr("完善账号定位，再发现值得互动的潜在客户。", "Define positioning, then discover potential customers worth engaging."),
      icon: <Search className="h-5 w-5" />,
    },
    {
      title: tr("互动队列", "Engagement queue"),
      description: tr("给机会排序、生成草稿并记录回复结果。", "Prioritize opportunities, draft replies, and record outcomes."),
      icon: <MessageSquareText className="h-5 w-5" />,
    },
    {
      title: tr("竞品洞察", "Competitor insights"),
      description: tr("从竞品、KOL 或社区受众中补充机会，可选使用。", "Find extra opportunities around competitors, KOLs, or communities. Optional."),
      icon: <Radar className="h-5 w-5" />,
    },
  ];

  return (
    <div className="fixed inset-0 z-[90] grid items-start justify-items-center overflow-y-auto bg-black/75 p-4 backdrop-blur-md sm:place-items-center" role="dialog" aria-modal="true" aria-labelledby="welcome-guide-title">
      <div className="relative w-full max-w-3xl overflow-hidden rounded-xl border border-blue-300/20 bg-[#0b0d12] text-white shadow-2xl shadow-black/60">
        <button type="button" onClick={onClose} aria-label={tr("关闭介绍", "Close introduction")} className="absolute right-4 top-4 z-10 grid h-9 w-9 place-items-center rounded-lg border border-white/10 bg-white/[0.04] text-white/55 transition-colors hover:bg-white/[0.08] hover:text-white">
          <X className="h-4 w-4" />
        </button>

        <div className="border-b border-white/[0.08] bg-blue-400/[0.06] px-5 py-6 sm:px-8 sm:py-8">
          <Badge variant="outline" className="rounded-md border-emerald-300/20 bg-emerald-400/10 text-emerald-100">
            <Trophy className="mr-1 h-3.5 w-3.5" /> {tr("首次使用", "First run")}
          </Badge>
          <h2 id="welcome-guide-title" className="mt-4 max-w-2xl text-2xl font-black leading-tight sm:text-4xl">
            {tr("先用 30 秒认识 Ray Growth OS", "Meet Ray Growth OS in 30 seconds")}
          </h2>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-white/60 sm:text-base">
            {tr("它会把 X 上的公开讨论整理成值得行动的机会：先找对人，再判断优先级，最后完成回复并记录结果。", "It turns public X discussions into actionable opportunities: find the right people, prioritize them, then reply and record the outcome.")}
          </p>
        </div>

        <div className="grid gap-5 p-5 sm:p-8">
          <div className="grid gap-3 sm:grid-cols-2">
            {pages.map((page) => (
              <div key={page.title} className="flex gap-3 rounded-lg border border-white/[0.07] bg-white/[0.025] p-4">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-blue-300/15 bg-blue-400/10 text-blue-100">{page.icon}</span>
                <div>
                  <p className="font-bold text-white">{page.title}</p>
                  <p className="mt-1 text-xs leading-5 text-white/50">{page.description}</p>
                </div>
              </div>
            ))}
          </div>

          <div className="flex items-start gap-3 rounded-lg border border-amber-300/15 bg-amber-400/[0.06] p-4 text-sm leading-6 text-amber-100/75">
            <Settings className="mt-0.5 h-4 w-4 shrink-0" />
            <p>{tr("需要 AI 搜索、评分或草稿时，再到设置里填写自己的 API 配置；你也可以先走手动流程。", "Add your own API settings when you want AI search, scoring, or drafts. You can start with the manual flow.")}</p>
          </div>

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="outline" className="tech-secondary" onClick={onClose}>{tr("先自己看看", "Explore first")}</Button>
            <Button type="button" className="tech-cta" onClick={onStart}>
              {tr("开始第 1 个任务", "Start the first task")} <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function OnboardingTaskPanel({
  tasks,
  completedCount,
  onClose,
  onOpenWelcome,
  onSelectTask,
}: {
  tasks: OnboardingTask[];
  completedCount: number;
  onClose: () => void;
  onOpenWelcome: () => void;
  onSelectTask: (task: OnboardingTask) => void;
}) {
  const { locale } = useI18n();
  const tr = (zh: string, en: string) => (locale === "en" ? en : zh);
  const progress = tasks.length ? Math.round((completedCount / tasks.length) * 100) : 0;

  return (
    <div className="fixed inset-0 z-[85] flex justify-end" role="dialog" aria-modal="true" aria-labelledby="onboarding-task-title">
      <button type="button" className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} aria-label={tr("关闭新手任务", "Close getting-started tasks")} />
      <aside className="relative flex h-full w-full max-w-[430px] flex-col border-l border-white/[0.08] bg-[#090b10] text-white shadow-2xl shadow-black/60">
        <div className="border-b border-white/[0.08] p-5 sm:p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <Badge variant="outline" className="rounded-md border-blue-300/15 bg-blue-400/10 text-blue-100">
                <Trophy className="mr-1 h-3.5 w-3.5" /> {tr("新手任务", "Getting started")}
              </Badge>
              <h2 id="onboarding-task-title" className="mt-3 text-2xl font-black">{tr("完成你的第一次增长闭环", "Complete your first growth loop")}</h2>
              <p className="mt-2 text-sm leading-6 text-white/50">{tr("任务会根据真实操作自动完成，不需要手动打勾。", "Tasks complete automatically from real actions. No manual checkboxes.")}</p>
            </div>
            <button type="button" onClick={onClose} aria-label={tr("关闭", "Close")} className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-white/10 bg-white/[0.04] text-white/55 hover:bg-white/[0.08] hover:text-white">
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="mt-5">
            <div className="flex items-center justify-between text-xs font-bold text-white/55">
              <span>{tr("任务进度", "Progress")}</span>
              <span>{completedCount}/{tasks.length}</span>
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/[0.06]">
              <div className="h-full rounded-full bg-emerald-400 transition-[width] duration-500" style={{ width: `${progress}%` }} />
            </div>
          </div>
        </div>

        <div className="grid flex-1 content-start gap-3 overflow-y-auto p-5 sm:p-6">
          {tasks.map((task, index) => (
            <button
              key={task.key}
              type="button"
              onClick={() => onSelectTask(task)}
              className={cn(
                "group flex gap-3 rounded-lg border p-4 text-left transition-all hover:-translate-y-0.5",
                task.complete
                  ? "border-emerald-300/15 bg-emerald-400/[0.06]"
                  : "border-white/[0.08] bg-white/[0.025] hover:border-blue-300/25 hover:bg-blue-400/[0.05]"
              )}
            >
              <span className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-lg border", task.complete ? "border-emerald-300/20 bg-emerald-400/10 text-emerald-300" : "border-white/10 bg-white/[0.04] text-white/40")}>
                {task.complete ? <CheckCircle2 className="h-5 w-5" /> : <span className="text-sm font-black">{index + 1}</span>}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center justify-between gap-2">
                  <span className="font-bold text-white">{task.title}</span>
                  <ArrowRight className="h-4 w-4 shrink-0 text-white/25 transition-transform group-hover:translate-x-1 group-hover:text-blue-200" />
                </span>
                <span className="mt-1 block text-xs leading-5 text-white/45">{task.description}</span>
                <span className={cn("mt-2 block text-[11px] font-bold", task.complete ? "text-emerald-300" : "text-amber-200/80")}>
                  {task.complete ? tr("已完成", "Completed") : tr("未完成 · 点击前往", "Not completed · Open task")}
                </span>
              </span>
            </button>
          ))}
        </div>

        <div className="border-t border-white/[0.08] p-5 sm:p-6">
          <Button type="button" variant="outline" className="tech-secondary w-full" onClick={onOpenWelcome}>
            <CircleHelp className="h-4 w-4" /> {tr("重看系统介绍", "View system introduction")}
          </Button>
        </div>
      </aside>
    </div>
  );
}

function OnboardingQuestBanner({
  completedCount,
  task,
  onContinue,
  onOpenTasks,
}: {
  completedCount: number;
  task: OnboardingTask;
  onContinue: () => void;
  onOpenTasks: () => void;
}) {
  const { locale } = useI18n();
  const tr = (zh: string, en: string) => (locale === "en" ? en : zh);
  return (
    <div className="flex flex-col gap-4 rounded-lg border border-blue-300/20 bg-blue-400/[0.07] p-4 text-white shadow-xl shadow-blue-950/20 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-start gap-3">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-lg border border-blue-300/20 bg-blue-400/10 text-blue-100">
          <CircleHelp className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <p className="font-black text-white">{tr("还不知道先做什么？", "Not sure what to do next?")}</p>
          <p className="mt-1 text-sm leading-6 text-white/55">
            {tr(`下一步：${task.title}。先完善定位，再找出值得互动的潜在客户。`, `Next: ${task.title}. Define positioning, then discover potential customers worth engaging.`)}
          </p>
        </div>
      </div>
      <div className="flex shrink-0 flex-col gap-2 sm:flex-row">
        <Button type="button" variant="outline" className="tech-secondary" onClick={onOpenTasks}>{tr(`全部任务 ${completedCount}/4`, `All tasks ${completedCount}/4`)}</Button>
        <Button type="button" className="tech-cta" onClick={onContinue}>{tr("继续下一步", "Continue")} <ArrowRight className="h-4 w-4" /></Button>
      </div>
    </div>
  );
}

function OnboardingTargetMarker() {
  const { locale } = useI18n();
  return (
    <div className="pointer-events-none absolute right-3 top-0 z-40 flex -translate-y-1/2 items-center gap-1 rounded-full border border-blue-200/35 bg-blue-500 px-3 py-1.5 text-xs font-black text-white shadow-lg shadow-blue-500/30">
      <ArrowRight className="h-3.5 w-3.5 rotate-90" /> {locale === "en" ? "Start here" : "从这里开始"}
    </div>
  );
}

function OverviewTab({
  mode,
  copy,
  result,
  topItem,
  averageScore,
  hotCount,
  setActiveTab,
}: {
  variant?: "search" | "account";
  mode: Mode;
  copy: ModeContent;
  result: WorkbenchResult;
  topItem?: QueueItem;
  averageScore: number;
  hotCount: number;
  setActiveTab: (tab: DashboardTab) => void;
}) {
  const { locale, t } = useI18n();
  const tr = (zh: string, en: string) => (locale === "en" ? en : zh);
  const overviewCopy = locale === "en"
    ? { badge: "Growth opportunities", heroDescription: "Find relevant people in public discussions, prioritize interaction and demand signals, then generate replies, quotes, content ideas, and respectful follow-ups." }
    : copy;
  const queueCount = result.mode === "outbound" ? result.leads.length : result.opportunities.length;
  const overviewStages: Array<{ label: string; value: number; detail: string; help: string; targetTab: DashboardTab }> = [
    { label: tr("定位找人", "Find people"), value: result.queries.length, detail: tr("账号 + Grok", "Positioning + Grok"), help: tr("填清楚定位，用 Grok 搜公开讨论并导入互动队列。", "Define positioning, discover public discussions with Grok, and import them into the queue."), targetTab: "search" },
    { label: tr("竞品洞察", "Competitor insights"), value: queueCount, detail: tr("可选洞察工具", "Optional insight tool"), help: tr("对比竞品、KOL 或目标账号的定位和受众，从机会空白里挖可互动线索。", "Compare a competitor, KOL, or target account to discover engagement opportunities in audience gaps."), targetTab: "account" },
    { label: tr("互动队列", "Engagement queue"), value: queueCount, detail: tr("评分 + 草稿 + 执行", "Score + draft + execute"), help: tr("在一个队列里看优先级、运行 AI 评分/草稿、打开来源并标记处理结果。", "Review priority in one queue, run AI scoring and drafts, open sources, and record outcomes."), targetTab: "engage" },
  ];

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1.28fr)_410px]">
      <div className="hero-card relative overflow-hidden rounded-lg border text-white shadow-soft">
        <div className="relative z-10 grid min-h-[560px] gap-7 p-5 lg:p-7">
          <div className="grid gap-6">
            <div className="flex flex-wrap items-center gap-2">
              <Badge className="rounded-md border-emerald-300/20 bg-emerald-400/10 text-emerald-100">{overviewCopy.badge}</Badge>
              <Badge variant="outline" className="rounded-md border-blue-300/15 bg-blue-400/10 text-blue-100">
                <Sparkles className="mr-1 h-3.5 w-3.5" /> {t("aiWorkflow")}
              </Badge>
            </div>

            <div className="max-w-4xl space-y-4">
              <h2 className="text-4xl font-black leading-[1.04] text-white sm:text-5xl lg:text-[3.5rem]">
                {tr("把 X 上的真实讨论，变成", "Turn real X discussions into")} <span className="gradient-text">{tr("值得行动的增长机会。", "growth opportunities worth acting on.")}</span>
              </h2>
              <p className="max-w-[640px] text-sm leading-6 text-slate-300 sm:text-base">{overviewCopy.heroDescription}</p>
            </div>
          </div>

          <OverviewLoopVisual result={result} averageScore={averageScore} hotCount={hotCount} queueCount={queueCount} setActiveTab={setActiveTab} />
          <WorkflowStrip stages={overviewStages} onSelectTab={setActiveTab} />
        </div>
      </div>
      <CopilotPanel mode={mode} topItem={topItem} averageScore={averageScore} hotCount={hotCount} />
    </div>
  );
}

function OverviewLoopVisual({
  result,
  averageScore,
  hotCount,
  queueCount,
  setActiveTab,
}: {
  result: WorkbenchResult;
  averageScore: number;
  hotCount: number;
  queueCount: number;
  setActiveTab: (tab: DashboardTab) => void;
}) {
  const { locale } = useI18n();
  const tr = (zh: string, en: string) => (locale === "en" ? en : zh);
  const loopSteps: Array<{ label: string; value: number; detail: string; icon: ReactNode; targetTab: DashboardTab }> = [
    { label: tr("填定位", "Position"), value: result.queries.length, detail: tr("生成 Grok Prompt", "Generate Grok prompt"), icon: <Target className="h-5 w-5" />, targetTab: "search" },
    { label: tr("找讨论", "Discover"), value: queueCount, detail: tr("导入 X 结果", "Import X results"), icon: <Radar className="h-5 w-5" />, targetTab: "search" },
    { label: tr("竞品洞察", "Insights"), value: queueCount, detail: tr("可选支线", "Optional path"), icon: <Users className="h-5 w-5" />, targetTab: "account" },
    { label: tr("AI 排序", "AI ranking"), value: averageScore, detail: tr("平均优先级", "Average priority"), icon: <Gauge className="h-5 w-5" />, targetTab: "engage" },
    { label: tr("去互动", "Engage"), value: hotCount, detail: tr("高分未执行", "High-score, unprocessed"), icon: <MessageSquareText className="h-5 w-5" />, targetTab: "engage" },
  ];
  const queryPreview = result.queries.slice(0, 3);

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
      <div className="relative overflow-hidden rounded-lg border border-white/[0.06] bg-white/[0.018] p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-white/40">{tr("增长闭环", "Growth loop")}</p>
            <p className="mt-1 text-sm font-semibold text-white">{tr("从找人到回复，不再分散在几个页面里。", "From discovery to reply, in one workflow.")}</p>
          </div>
          <Badge variant="outline" className="rounded-md border-emerald-500/10 bg-emerald-500/10 text-emerald-200">{tr("今日工作台", "Today")}</Badge>
        </div>

        <div className="relative mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <div className="pointer-events-none absolute left-[10%] right-[10%] top-8 hidden h-px bg-gradient-to-r from-blue-300/0 via-blue-300/25 to-emerald-300/0 xl:block" />
          {loopSteps.map((step, index) => (
            <button
              key={step.label}
              type="button"
              onClick={() => setActiveTab(step.targetTab)}
              className="group relative grid min-h-[132px] gap-2 rounded-lg border border-white/[0.06] bg-[#0d0d10]/55 p-3 text-left transition-all duration-200 hover:-translate-y-1 hover:border-blue-300/25 hover:bg-blue-400/[0.05] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300/40"
            >
              <span className="grid h-10 w-10 place-items-center rounded-md border border-white/[0.08] bg-white/[0.04] text-blue-100 shadow-lg shadow-blue-500/5 transition-transform duration-200 group-hover:scale-110">{step.icon}</span>
              <span className="metric-number text-2xl font-black text-white">{step.value}</span>
              <span className="text-sm font-bold text-white">{step.label}</span>
              <span className="text-xs leading-5 text-white/45">{step.detail}</span>
              {index < loopSteps.length - 1 ? <ArrowRight className="absolute right-3 top-4 hidden h-4 w-4 text-white/25 transition-transform duration-200 group-hover:translate-x-1 xl:block" /> : <CheckCircle2 className="absolute right-3 top-4 h-4 w-4 text-emerald-300" />}
            </button>
          ))}
        </div>
      </div>

      <div className="rounded-lg border border-white/[0.06] bg-white/[0.018] p-4">
        <div className="flex items-center justify-between gap-2">
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-white/40">{tr("Grok 会搜什么", "What Grok will search")}</p>
            <p className="mt-1 text-sm font-semibold text-white">{tr("根据定位自动生成", "Generated from positioning")}</p>
          </div>
          <Button type="button" size="sm" variant="ghost" className="text-blue-100 hover:bg-blue-400/10 hover:text-white" onClick={() => setActiveTab("search")}>{tr("去调整", "Edit")}</Button>
        </div>
        <div className="mt-3 grid gap-2">
          {queryPreview.map((query, index) => (
            <div key={`${query.channel}-${index}`} className="rounded-md border border-white/[0.05] bg-[#0d0d10]/55 px-3 py-2">
              <p className="truncate text-xs font-bold text-white/75">{query.channel}</p>
              <p className="mt-1 line-clamp-2 text-xs leading-5 text-white/45">{query.intent}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function SearchRadarTab({
  mode,
  copy,
  current,
  updateField,
  onGenerateProfile,
  onSaveProfile,
  grokBridge,
  setGrokBridge,
  modeSignals,
  setModeSignals,
  exportBackup,
  restoreBackupText,
  growthMemory,
  highlightedTarget,
}: {
  variant?: "search" | "account";
  mode: Mode;
  copy: ModeContent;
  current: FormState;
  updateField: (field: keyof FormState, value: string) => void;
  onGenerateProfile: (onRetry?: AiProfileRetryHandler) => Promise<AiProfileRunResult>;
  onSaveProfile: () => void;
  grokBridge: GrokBridgeState;
  setGrokBridge: Dispatch<SetStateAction<GrokBridgeState>>;
  modeSignals: Signal[];
  setModeSignals: (signals: Signal[]) => void;
  exportBackup: () => void;
  restoreBackupText: (rawText: string) => { ok: boolean; message: string };
  growthMemory: GrowthMemoryState;
  highlightedTarget: OnboardingTarget | null;
}) {
  const { locale } = useI18n();
  const tr = (zh: string, en: string) => (locale === "en" ? en : zh);
  const flowSteps = [
    { label: tr("1 填写定位", "1 Define positioning"), detail: tr("产品/账号、目标用户、痛点", "Account or product, audience, pain points") },
    { label: tr("2 去 Grok 找人", "2 Discover on Grok"), detail: tr("复制 Prompt 或中转查询", "Copy the prompt or run proxy search") },
    { label: tr("3 导入结果", "3 Import results"), detail: tr("粘贴 X 结果并去重", "Paste X results and deduplicate") },
    { label: tr("4 互动队列", "4 Engagement queue"), detail: tr("评分、草稿和执行记录", "Score, draft, and log outcomes") },
  ];

  return (
    <div className="grid gap-4">
      <div className="grid gap-4 xl:grid-cols-[430px_minmax(0,1fr)]">
        <div
          data-onboarding-target="positioning"
          className={cn("relative min-w-0 scroll-mt-24 rounded-lg", highlightedTarget === "positioning" && "onboarding-target-active")}
        >
          {highlightedTarget === "positioning" ? <OnboardingTargetMarker /> : null}
          <InputPanel mode={mode} copy={copy} current={current} updateField={updateField} onGenerateProfile={onGenerateProfile} onSaveProfile={onSaveProfile} />
        </div>
        <div className="grid content-start gap-4">
          <Card className="overflow-hidden border border-white/[0.08] bg-white/[0.03] text-white shadow-2xl shadow-blue-500/5 backdrop-blur-md">
            <CardHeader className="border-b border-white/[0.08] bg-[#0d0d10]/70">
              <Badge variant="outline" className="w-fit rounded-md border-blue-500/10 bg-blue-500/10 text-blue-200"><Radar className="mr-1 h-3.5 w-3.5" /> {tr("定位找人流程", "Discovery flow")}</Badge>
              <CardTitle className="mt-3 text-xl text-white">{tr("先填定位，再用 Grok 找真实 X 用户", "Define positioning, then discover real X users with Grok")}</CardTitle>
              <CardDescription className="mt-2 text-white/55">{tr("定位会自动生成 Grok Prompt；找到结果后直接进入互动队列。", "Positioning generates the Grok prompt. Imported results go directly into the engagement queue.")}</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 p-4 md:grid-cols-4">
              {flowSteps.map((step) => (
                <div key={step.label} className="rounded-lg border border-white/[0.06] bg-white/[0.025] p-3">
                  <p className="text-sm font-bold text-white">{step.label}</p>
                  <p className="mt-1 text-xs leading-5 text-white/45">{step.detail}</p>
                </div>
              ))}
            </CardContent>
          </Card>

          <div
            data-onboarding-target="discovery"
            className={cn("relative scroll-mt-24 rounded-lg", highlightedTarget === "discovery" && "onboarding-target-active")}
          >
            {highlightedTarget === "discovery" ? <OnboardingTargetMarker /> : null}
            <GrokBridgePanel variant="search" mode={mode} current={current} updateField={updateField} grokBridge={grokBridge} setGrokBridge={setGrokBridge} modeSignals={modeSignals} setModeSignals={setModeSignals} growthMemory={growthMemory} />
          </div>
        </div>
      </div>

      <WorkbenchBackupPanel exportBackup={exportBackup} restoreBackupText={restoreBackupText} />
    </div>
  );
}

function EngageTab({
  mode,
  result,
  signalByKey,
  onUpdateSignalStatus,
  onBatchUpdateSignalStatus,
  onUpdateSignalFeedback,
  onUpdateSignalUsedDraft,
  onDeleteItems,
  ownAccountIdentity,
  copyAllDrafts,
  aiScoreCount,
  aiDraftCount,
  styleSampleCount,
  runAiScoring,
  runAiDrafting,
  runGrowthMemoryLearning,
  clearGrowthMemory,
  onFindPeople,
  growthMemory,
  executionStats,
  recentProcessedSignals,
  signals,
}: {
  variant?: "search" | "account";
  mode: Mode;
  result: WorkbenchResult;
  signalByKey: Map<string, Signal>;
  onUpdateSignalStatus: (item: QueueItem, status: SignalExecutionStatus, options?: { silent?: boolean }) => void;
  onBatchUpdateSignalStatus: (items: QueueItem[], status: SignalExecutionStatus, options?: { silent?: boolean }) => void;
  onUpdateSignalFeedback: (item: QueueItem, feedback: SignalFeedbackStatus) => void;
  onUpdateSignalUsedDraft: (item: QueueItem, usedDraft: string) => void;
  onDeleteItems: (items: QueueItem[], options?: { silent?: boolean }) => void;
  ownAccountIdentity: OwnAccountIdentity;
  copyAllDrafts: () => void;
  aiScoreCount: number;
  aiDraftCount: number;
  styleSampleCount: number;
  runAiScoring: (items?: QueueItem[]) => Promise<AiScoreRunResult>;
  runAiDrafting: (items?: QueueItem[]) => Promise<AiDraftRunResult>;
  runGrowthMemoryLearning: (onRetry?: GrowthMemoryRetryHandler) => Promise<GrowthMemoryRunResult>;
  clearGrowthMemory: () => void;
  onFindPeople: () => void;
  growthMemory: GrowthMemoryState;
  executionStats: ExecutionStats;
  recentProcessedSignals: Signal[];
  signals: Signal[];
}) {
  const { locale } = useI18n();
  const tr = (zh: string, en: string) => (locale === "en" ? en : zh);
  const [engageView, setEngageView] = useState<"queue" | "feedback" | "memory" | "stats">("queue");
  const [timeRange, setTimeRange] = useState<QueueTimeRangeKey>("today");
  const autoTimeRangeResolvedRef = useRef<Record<Mode, boolean>>({ outbound: false, growth: false });
  const [priorityFilters, setPriorityFilters] = useState<PriorityFilterKey[]>([]);
  const [processFilters, setProcessFilters] = useState<ProcessFilterKey[]>([]);
  const [feedbackFilters, setFeedbackFilters] = useState<SignalFeedbackStatus[]>([]);
  const [expandedKey, setExpandedKey] = useState<string>("");
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [queuePage, setQueuePage] = useState(1);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; key: string } | null>(null);
  const [aiActionState, setAiActionState] = useState<"idle" | "loading" | "error">("idle");
  const [aiActionMessage, setAiActionMessage] = useState("先筛选并勾选要处理的条目，再运行 AI 评分、生成草稿或批量标记状态。");
  const hotLabel = mode === "outbound" ? "High intent" : "Engage now";
  const warmLabel = mode === "outbound" ? "Warm" : "Watch";
  const rawItems: QueueItem[] = result.mode === "outbound" ? result.leads : result.opportunities;
  const items = useMemo(() => dedupeQueueItems(rawItems), [rawItems]);
  const isEngagedStatus = (status: SignalExecutionStatus) => status === "replied" || status === "quoted";
  const itemStatus = (item: QueueItem) => normalizeExecutionStatus(signalByKey.get(queueItemSignalKey(item))?.status);
  const itemFeedback = (item: QueueItem) => normalizeFeedbackStatus(signalByKey.get(queueItemSignalKey(item))?.feedback);
  const itemImportedAt = (item: QueueItem) => {
    const signal = signalByKey.get(queueItemSignalKey(item));
    // Legacy text rows are reconstructed as `manual` and may carry the time
    // they were reloaded or merged, not their real historical import time.
    return signal && signal.source !== "manual" ? signal.importedAt : undefined;
  };
  const timeScopedItems = items.filter((item) => matchesQueueTimeRange(itemImportedAt(item), timeRange));
  const filteredItems = timeScopedItems.filter((item) => {
    const status = itemStatus(item);
    const feedback = itemFeedback(item);
    const priorityMatched =
      priorityFilters.length === 0 ||
      priorityFilters.some(
        (priority) =>
          (priority === "hot" && item.label === hotLabel) ||
          (priority === "warm" && item.label === warmLabel) ||
          (priority === "low" && item.label !== hotLabel && item.label !== warmLabel)
      );
    const processMatched =
      processFilters.length === 0 ||
      processFilters.some(
        (process) =>
          (process === "pending" && status === "new") ||
          (process === "processed" && status !== "new") ||
          (process === "engaged" && isEngagedStatus(status)) ||
          (process === "saved" && status === "saved") ||
          (process === "deferred" && status === "deferred") ||
          (process === "skipped" && status === "skipped")
      );
    const feedbackMatched = feedbackFilters.length === 0 || feedbackFilters.includes(feedback);
    return priorityMatched && processMatched && feedbackMatched;
  });
  const pageCount = Math.max(1, Math.ceil(filteredItems.length / 50));
  const safePage = Math.min(queuePage, pageCount);
  const pageStart = (safePage - 1) * 50;
  const pageEnd = Math.min(pageStart + 50, filteredItems.length);
  const pageStartDisplay = filteredItems.length ? pageStart + 1 : 0;
  const pagedItems = filteredItems.slice(pageStart, pageEnd);
  const queuePageSnapshot = {
    mode,
    timeRange,
    page: safePage,
    pageSize: 50,
    pageStart: pageStartDisplay,
    pageEnd,
    total: filteredItems.length,
    itemKeys: pagedItems.map((item) => queueItemSignalKey(item)),
    urls: pagedItems.map((item) => item.url).filter(Boolean),
  };
  const queuePageSignature = JSON.stringify(queuePageSnapshot);
  const selectedKeySet = useMemo(() => new Set(selectedKeys), [selectedKeys]);
  const selectedItems = useMemo(() => pagedItems.filter((item) => selectedKeySet.has(queueItemSignalKey(item))), [pagedItems, selectedKeySet]);
  const ownAccountItems = useMemo(() => timeScopedItems.filter((item) => signalMatchesOwnAccount(item, ownAccountIdentity)), [timeScopedItems, ownAccountIdentity]);
  const visibleKeys = pagedItems.map((item) => queueItemSignalKey(item));
  const allVisibleSelected = visibleKeys.length > 0 && visibleKeys.every((key) => selectedKeySet.has(key));
  const allItemsSelected = pagedItems.length > 0 && pagedItems.every((item) => selectedKeySet.has(queueItemSignalKey(item)));
  const contextItem = contextMenu ? items.find((item) => queueItemSignalKey(item) === contextMenu.key) : undefined;
  const contextUsesSelection = Boolean(contextMenu && selectedKeySet.has(contextMenu.key) && selectedItems.length > 0);
  const contextActionCount = contextUsesSelection ? selectedItems.length : contextItem ? 1 : selectedItems.length;
  const unknownTimeCount = items.filter((item) => !itemImportedAt(item)).length;
  const preferredTimeRange = preferredVisibleQueueTimeRange(items.map((item) => itemImportedAt(item)));
  const timeRangeOptions: Array<{ key: QueueTimeRangeKey; label: string; count: number }> = [
    { key: "today", label: tr("今天", "Today"), count: items.filter((item) => matchesQueueTimeRange(itemImportedAt(item), "today")).length },
    { key: "yesterday", label: tr("昨天", "Yesterday"), count: items.filter((item) => matchesQueueTimeRange(itemImportedAt(item), "yesterday")).length },
    { key: "7d", label: tr("近 7 天", "Last 7 days"), count: items.filter((item) => matchesQueueTimeRange(itemImportedAt(item), "7d")).length },
    { key: "30d", label: tr("近 30 天", "Last 30 days"), count: items.filter((item) => matchesQueueTimeRange(itemImportedAt(item), "30d")).length },
    { key: "all", label: tr("全部", "All time"), count: items.length },
  ];
  const activeTimeRangeLabel = timeRangeOptions.find((option) => option.key === timeRange)?.label ?? tr("今天", "Today");
  const preferredTimeRangeOption = timeRangeOptions.find((option) => option.key === preferredTimeRange) ?? timeRangeOptions[4];
  const processOptions: Array<FilterOption<ProcessFilterKey>> = [
    { key: "all", label: "全部", count: timeScopedItems.length },
    { key: "pending", label: "未处理", count: timeScopedItems.filter((item) => itemStatus(item) === "new").length },
    { key: "processed", label: "已处理", count: timeScopedItems.filter((item) => itemStatus(item) !== "new").length },
    { key: "engaged", label: "已互动", count: timeScopedItems.filter((item) => isEngagedStatus(itemStatus(item))).length },
    { key: "saved", label: "已收藏", count: timeScopedItems.filter((item) => itemStatus(item) === "saved").length },
    { key: "deferred", label: "搁置", count: timeScopedItems.filter((item) => itemStatus(item) === "deferred").length },
    { key: "skipped", label: "跳过", count: timeScopedItems.filter((item) => itemStatus(item) === "skipped").length },
  ];
  const feedbackFilterOptions: Array<FilterOption<SignalFeedbackStatus>> = [
    { key: "all", label: "全部", count: timeScopedItems.length },
    { key: "none", label: "未拉取", count: timeScopedItems.filter((item) => itemFeedback(item) === "none").length },
    { key: "got_reply", label: "有回复", count: timeScopedItems.filter((item) => itemFeedback(item) === "got_reply").length },
    { key: "no_reply", label: "无回复", count: timeScopedItems.filter((item) => itemFeedback(item) === "no_reply").length },
    { key: "followed", label: "被关注", count: timeScopedItems.filter((item) => itemFeedback(item) === "followed").length },
    { key: "reshared", label: "被转发", count: timeScopedItems.filter((item) => itemFeedback(item) === "reshared").length },
  ];
  const priorityOptions: Array<FilterOption<PriorityFilterKey>> = [
    { key: "all", label: "全部", count: timeScopedItems.length },
    { key: "hot", label: mode === "outbound" ? "高意向" : "立即互动", count: timeScopedItems.filter((item) => item.label === hotLabel).length },
    { key: "warm", label: mode === "outbound" ? "跟进观察" : "观察", count: timeScopedItems.filter((item) => item.label === warmLabel).length },
    { key: "low", label: "低评分", count: timeScopedItems.filter((item) => item.label !== hotLabel && item.label !== warmLabel).length },
  ];
  const priorityFilterSignature = priorityFilters.join("|");
  const processFilterSignature = processFilters.join("|");
  const feedbackFilterSignature = feedbackFilters.join("|");
  const engageViews: Array<{ key: typeof engageView; label: string; description: string; icon: ReactNode; stat: string }> = [
    { key: "queue", label: "互动列表", description: "筛选、评分、生成草稿、批量处理。", icon: <MessageSquareText className="h-4 w-4" />, stat: `${items.length} 条` },
    { key: "feedback", label: "反馈复盘", description: "看有回复、无回复、关注和转发结果。", icon: <Activity className="h-4 w-4" />, stat: `${executionStats.feedbackToday} 今日` },
    { key: "memory", label: "增长记忆", description: "让反馈反过来调整评分和关键词。", icon: <Sparkles className="h-4 w-4" />, stat: growthMemory.active ? "已应用" : "未应用" },
    { key: "stats", label: "执行统计", description: "查看处理量、正反馈和最近动作。", icon: <Gauge className="h-4 w-4" />, stat: `${executionStats.processed}/${executionStats.total}` },
  ];

  useEffect(() => {
    if (items.length === 0 || autoTimeRangeResolvedRef.current[mode]) return;
    autoTimeRangeResolvedRef.current[mode] = true;
    if (timeRange !== "today" || preferredTimeRange === "today") return;

    setTimeRange(preferredTimeRange);
    setAiActionState("idle");
    const message = tr(
      `今天没有新条目，已自动显示“${preferredTimeRangeOption.label}”中的 ${preferredTimeRangeOption.count} 条历史数据。`,
      `There are no new items today. Showing ${preferredTimeRangeOption.count} historical items from ${preferredTimeRangeOption.label} instead.`
    );
    setAiActionMessage(message);
    showToast(message, "info");
  }, [items.length, mode, preferredTimeRange, preferredTimeRangeOption.count, preferredTimeRangeOption.label, timeRange]);

  useEffect(() => {
    setQueuePage(1);
    setSelectedKeys([]);
    setExpandedKey("");
  }, [timeRange, priorityFilterSignature, processFilterSignature, feedbackFilterSignature, mode]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(
      "ray-growth-os:queue-page:v1",
      JSON.stringify({
        ...queuePageSnapshot,
        updatedAt: new Date().toISOString(),
      })
    );
  }, [safePage, queuePageSignature]);

  useEffect(() => {
    setSelectedKeys((previous) => {
      const validKeys = new Set(items.map((item) => queueItemSignalKey(item)));
      const next = previous.filter((key) => validKeys.has(key));
      return next.length === previous.length ? previous : next;
    });
  }, [items]);

  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };

    window.addEventListener("click", close);
    window.addEventListener("scroll", close, true);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [contextMenu]);

  function toggleItemSelection(key: string) {
    setSelectedKeys((previous) => (previous.includes(key) ? previous.filter((itemKey) => itemKey !== key) : [...previous, key]));
  }

  function selectAllItems() {
    const allKeys = pagedItems.map((item) => queueItemSignalKey(item));
    setSelectedKeys(allKeys);
    showToast(`已全选当前页 ${allKeys.length} 条。`, "success");
  }

  function toggleVisibleSelection() {
    setSelectedKeys((previous) => {
      const visibleSet = new Set(visibleKeys);
      if (allVisibleSelected) return previous.filter((key) => !visibleSet.has(key));
      return Array.from(new Set([...previous, ...visibleKeys]));
    });
    showToast(allVisibleSelected ? "已取消当前页选择。" : "已选择当前页结果。", "info");
  }

  function clearSelection() {
    setSelectedKeys([]);
    showToast("已清空选择。", "info");
  }

  function batchUpdateStatus(status: SignalExecutionStatus) {
    if (selectedItems.length === 0) {
      setAiActionState("error");
      setAiActionMessage("请先勾选至少 1 条，再批量标记状态。");
      return;
    }

    onBatchUpdateSignalStatus(selectedItems, status, { silent: true });
    setSelectedKeys([]);
    setAiActionState("idle");
    setAiActionMessage("已将当前页选中的 " + selectedItems.length + " 条批量标记为" + executionStatusLabel(status, mode) + "。");
    showToast("已批量标记 " + selectedItems.length + " 条为" + executionStatusLabel(status, mode) + "。", "success");
  }

  function deleteSelectedItems() {
    if (selectedItems.length === 0) {
      setAiActionState("error");
      setAiActionMessage("请先勾选至少 1 条，再批量删除。");
      return;
    }

    const count = selectedItems.length;
    onDeleteItems(selectedItems, { silent: true });
    setSelectedKeys([]);
    setAiActionState("idle");
    setAiActionMessage("已删除当前页选中的 " + count + " 条线索。");
    showToast("已删除 " + count + " 条线索。", "success");
  }

  function cleanOwnAccountItems() {
    if (ownAccountItems.length === 0) {
      setAiActionState("idle");
      setAiActionMessage("当前队列没有识别到自己的账号数据。");
      showToast("当前队列没有识别到自己的账号数据。", "info");
      return;
    }

    const count = ownAccountItems.length;
    onDeleteItems(ownAccountItems, { silent: true });
    setSelectedKeys([]);
    setAiActionState("idle");
    setAiActionMessage("已按自己的账号清理 " + count + " 条污染线索。");
    showToast("已清理自己的账号线索 " + count + " 条。", "success");
  }

  function contextTargetItems() {
    if (contextItem && contextUsesSelection) return selectedItems;
    if (contextItem) return [contextItem];
    return selectedItems;
  }

  async function scoreTargets(targetItems: QueueItem[] = selectedItems) {
    if (targetItems.length === 0) {
      setAiActionState("error");
      setAiActionMessage("请先勾选至少 1 条，再运行 AI 评分。");
      return;
    }

    const limitCount = Math.min(targetItems.length, AI_SCORE_LIMIT);
    setAiActionState("loading");
    setAiActionMessage(`正在对已选 ${limitCount} 条做 AI 语义评分...`);
    try {
      const result = await runAiScoring(targetItems);
      setAiActionState("idle");
      const successMessage = `已用 ${result.model} 完成 ${result.count} 条 AI 评分，队列排序和每条详情已更新。`;
      setAiActionMessage(successMessage);
      showToast(successMessage, "success");
    } catch (error) {
      setAiActionState("error");
      const errorMessage = formatActionError(error, "AI 评分失败，已保留本地规则评分。");
      setAiActionMessage(errorMessage);
      showToast(errorMessage, "error");
    }
  }

  async function draftTargets(targetItems: QueueItem[] = selectedItems) {
    if (targetItems.length === 0) {
      setAiActionState("error");
      setAiActionMessage("请先勾选至少 1 条，再生成回复草稿。");
      return;
    }

    const limitCount = Math.min(targetItems.length, AI_DRAFT_LIMIT);
    setAiActionState("loading");
    setAiActionMessage(`正在为已选 ${limitCount} 条生成 AI 回复草稿...`);
    try {
      const result = await runAiDrafting(targetItems);
      setAiActionState("idle");
      const successMessage = result.failedCount ? `已生成 ${result.count} 组草稿，${result.failedCount} 条未成功。成功结果已保存，可重试失败条目。` : `已用 ${result.model} 生成 ${result.count} 组草稿，展开条目即可查看。`;
      setAiActionMessage(successMessage);
      showToast(successMessage, "success");
    } catch (error) {
      setAiActionState("error");
      const errorMessage = formatActionError(error, "AI 草稿生成失败，已保留本地规则草稿。");
      setAiActionMessage(errorMessage);
      showToast(errorMessage, "error");
    }
  }

  function openContextMenu(event: ReactMouseEvent<HTMLDivElement>, key: string) {
    event.preventDefault();
    event.stopPropagation();
    if (!selectedKeySet.has(key)) setSelectedKeys([key]);
    const maxX = Math.max(8, window.innerWidth - 240);
    const maxY = Math.max(8, window.innerHeight - 210);
    setContextMenu({ x: Math.min(event.clientX, maxX), y: Math.min(event.clientY, maxY), key });
  }

  function FilterGroup<T extends string>({ label, values, options, onChange, columns = "auto" }: { label: string; values: T[]; options: Array<FilterOption<T>>; onChange: (next: T[]) => void; columns?: "auto" | "compact" }) {
    return (
      <div className="rounded-lg border border-white/[0.08] bg-[#0b1118]/70 p-3 shadow-inner shadow-white/[0.02]">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="text-xs font-black uppercase text-white/45">{label}</div>
          <div className="h-px flex-1 bg-white/[0.06]" />
        </div>
        <div className={cn("grid gap-2", columns === "compact" ? "grid-cols-2" : "grid-cols-2 min-[1500px]:grid-cols-3")}>
          {options.map((option) => {
            const active = option.key === "all" ? values.length === 0 : values.includes(option.key as T);
            const fullLabel = option.label + " " + option.count + " 条";
            return (
              <Button
                key={option.key}
                type="button"
                variant="outline"
                size="sm"
                aria-pressed={active}
                title={fullLabel}
                onClick={() => onChange(option.key === "all" ? [] : toggleFilterSelection(values, option.key as T))}
                className={cn(
                  "tech-secondary h-9 justify-between gap-2 rounded-md px-3 text-left transition-all duration-200",
                  "hover:-translate-y-px hover:border-blue-300/35 hover:bg-blue-400/[0.08]",
                  active && "!border-blue-300/70 !bg-blue-500/22 !text-white shadow-[0_0_0_1px_rgba(147,197,253,0.35),0_10px_24px_rgba(37,99,235,0.18)]"
                )}
              >
                <span className="flex min-w-0 items-center gap-1.5" title={option.label}>
                  {active ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-blue-100" /> : <span className="h-2 w-2 shrink-0 rounded-full bg-white/18" />}
                  <span className="truncate">{option.label}</span>
                </span>
                <span className={cn("rounded px-1.5 py-0.5 text-xs font-black", active ? "bg-blue-100/18 text-blue-50" : "bg-white/[0.06] text-white/40")}>{option.count}</span>
              </Button>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-4">
      <div className="rounded-lg border border-white/[0.08] bg-white/[0.03] p-4 text-white backdrop-blur-md">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <h2 className="text-2xl font-black text-white">互动工作台</h2>
            <p className="mt-1 text-sm text-white/50">把线索处理、反馈复盘、增长记忆和执行统计拆开看，队列里每页最多 50 条，插件巡检也只处理当前页。</p>
          </div>
          <Button variant="outline" size="sm" className="tech-secondary h-8" onClick={copyAllDrafts}>
            <Copy className="h-3.5 w-3.5" /> 复制全部草稿
          </Button>
        </div>
        <div className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-4">
          {engageViews.map((view) => (
            <button
              key={view.key}
              type="button"
              onClick={() => setEngageView(view.key)}
              className={cn(
                "rounded-lg border border-white/[0.08] bg-white/[0.025] p-3 text-left transition duration-200 hover:border-blue-300/25 hover:bg-blue-400/[0.05]",
                engageView === view.key && "border-blue-300/30 bg-blue-400/[0.10] shadow-lg shadow-blue-950/20"
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2 text-sm font-black text-white">{view.icon}{view.label}</span>
                <Badge variant="outline" className="rounded-md border-blue-300/15 bg-blue-400/10 text-blue-100">{view.stat}</Badge>
              </div>
              <p className="mt-2 text-xs leading-5 text-white/45">{view.description}</p>
            </button>
          ))}
        </div>
      </div>

      {engageView === "queue" ? (
        <>
          <div className="rounded-lg border border-white/[0.08] bg-white/[0.025] p-4 text-white backdrop-blur-md">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
              <div>
                <h3 className="text-xl font-black text-white">互动列表</h3>
                <p className="mt-1 text-sm text-white/50">先按处理、反馈和优先级筛选，再对当前页做批量操作。</p>
              </div>
              <div className="rounded-md border border-blue-300/15 bg-blue-400/[0.06] px-3 py-2 text-xs text-blue-100">
                {activeTimeRangeLabel} {timeScopedItems.length} / 筛选后 {filteredItems.length} / 当前页 {pageStartDisplay}-{pageEnd} / 全部 {items.length}
              </div>
            </div>
            <div className="mt-4 rounded-lg border border-white/[0.08] bg-[#0b1118]/70 p-3">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <div className="flex shrink-0 items-center gap-2 text-xs font-black uppercase text-white/45">
                  <Clock3 className="h-3.5 w-3.5 text-blue-200" />
                  {tr("时间范围", "Time range")}
                </div>
                <div className="hidden h-px flex-1 bg-white/[0.06] sm:block" />
                <div className="grid flex-1 grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:justify-end">
                  {timeRangeOptions.map((option) => {
                    const active = timeRange === option.key;
                    return (
                      <Button
                        key={option.key}
                        type="button"
                        variant="outline"
                        size="sm"
                        aria-pressed={active}
                        onClick={() => setTimeRange(option.key)}
                        className={cn(
                          "tech-secondary h-8 justify-between gap-3 rounded-md px-3 transition-all duration-200 sm:justify-center",
                          active && "!border-blue-300/70 !bg-blue-500/22 !text-white shadow-[0_0_0_1px_rgba(147,197,253,0.35),0_8px_20px_rgba(37,99,235,0.16)]"
                        )}
                      >
                        <span>{option.label}</span>
                        <span className={cn("rounded px-1.5 py-0.5 text-xs font-black", active ? "bg-blue-100/18 text-blue-50" : "bg-white/[0.06] text-white/40")}>{option.count}</span>
                      </Button>
                    );
                  })}
                </div>
              </div>
              {unknownTimeCount > 0 ? (
                <p className="mt-2 border-t border-white/[0.06] pt-2 text-xs leading-5 text-amber-100/65">
                  {tr(`${unknownTimeCount} 条历史或手动数据没有可信导入时间，仅计入“全部”。`, `${unknownTimeCount} historical or manual items have no reliable import time and appear only in All time.`)}
                </p>
              ) : null}
            </div>
            <div className="mt-4 grid gap-3 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1.15fr)_minmax(280px,0.85fr)]">
              <FilterGroup label="处理状态" values={processFilters} options={processOptions} onChange={setProcessFilters} />
              <FilterGroup label="反馈状态" values={feedbackFilters} options={feedbackFilterOptions} onChange={setFeedbackFilters} />
              <FilterGroup label="优先级" values={priorityFilters} options={priorityOptions} onChange={setPriorityFilters} columns="compact" />
            </div>
          </div>

          <AiQueueActionBar
            selectedCount={selectedItems.length}
            visibleCount={pagedItems.length}
            totalCount={filteredItems.length}
            allVisibleSelected={allVisibleSelected}
            allItemsSelected={allItemsSelected}
            aiScoreCount={aiScoreCount}
            aiDraftCount={aiDraftCount}
            styleSampleCount={styleSampleCount}
            ownAccountCount={ownAccountItems.length}
            state={aiActionState}
            message={aiActionMessage}
            onSelectAll={selectAllItems}
            onToggleVisibleSelection={toggleVisibleSelection}
            onClearSelection={clearSelection}
            onRunScoring={() => void scoreTargets()}
            onRunDrafting={() => void draftTargets()}
            onBatchStatus={batchUpdateStatus}
            onDeleteSelected={deleteSelectedItems}
            onCleanOwnAccount={cleanOwnAccountItems}
          />

          <div className="flex flex-col gap-3 rounded-lg border border-white/[0.08] bg-white/[0.03] p-3 text-white/60 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm">第 {safePage}/{pageCount} 页，本页 {pageStartDisplay}-{pageEnd} 条。选择、AI 操作、插件巡检都只作用于当前页，避免一次扫太多。</p>
            <div className="flex gap-2">
              <Button type="button" variant="outline" size="sm" className="tech-secondary h-8" onClick={() => setQueuePage((page) => Math.max(1, page - 1))} disabled={safePage <= 1}>上一页</Button>
              <Button type="button" variant="outline" size="sm" className="tech-secondary h-8" onClick={() => setQueuePage((page) => Math.min(pageCount, page + 1))} disabled={safePage >= pageCount}>下一页</Button>
            </div>
          </div>

          <div className="grid gap-3">
            {pagedItems.length ? pagedItems.map((item, index) => {
              const key = queueItemSignalKey(item);
              const signal = signalByKey.get(key);
              return (
                <EngagementAccordionCard
                  key={`${key}-${index}`}
                  mode={mode}
                  item={item}
                  signal={signal}
                  selected={selectedKeySet.has(key)}
                  expanded={expandedKey === key}
                  onToggle={() => setExpandedKey((current) => (current === key ? "" : key))}
                  onSelectedChange={() => toggleItemSelection(key)}
                  onContextMenu={(event) => openContextMenu(event, key)}
                  onStatusChange={(status) => onUpdateSignalStatus(item, status)}
                  onFeedbackChange={(feedback) => onUpdateSignalFeedback(item, feedback)}
                  onUsedDraftChange={(usedDraft) => onUpdateSignalUsedDraft(item, usedDraft)}
                  onDelete={() => onDeleteItems([item])}
                />
              );
            }) : timeRange === "today" && timeScopedItems.length === 0 ? (
              <div className="rounded-lg border border-amber-300/15 bg-amber-400/[0.05] p-8 text-center text-sm text-amber-50/75">
                <p className="text-base font-bold text-amber-50">{tr("今天暂无数据", "No data today")}</p>
                <p className="mt-2 text-sm leading-6 text-amber-50/60">
                  {tr("可以查看近 7 天的数据，或者去定位找人拉取新的潜在互动对象。", "Review data from the last 7 days, or find people to pull new engagement opportunities.")}
                </p>
                <div className="mt-4 flex flex-wrap justify-center gap-2">
                  <Button type="button" variant="outline" size="sm" className="tech-secondary h-8" onClick={() => setTimeRange("7d")}>
                    {tr(`查看近 7 天（${timeRangeOptions.find((option) => option.key === "7d")?.count ?? 0}）`, `View last 7 days (${timeRangeOptions.find((option) => option.key === "7d")?.count ?? 0})`)}
                  </Button>
                  <Button type="button" size="sm" className="tech-cta h-8" onClick={onFindPeople}>
                    <Search className="h-3.5 w-3.5" /> {tr("去定位找人", "Find people")}
                  </Button>
                </div>
              </div>
            ) : (
              <div className="rounded-lg border border-white/[0.08] bg-white/[0.025] p-8 text-center text-sm text-white/45">当前时间范围或筛选条件下没有条目，可以切换时间范围，或放宽处理状态、反馈状态和优先级筛选。</div>
            )}
          </div>

          {contextMenu ? (
            <AiQueueContextMenu
              x={contextMenu.x}
              y={contextMenu.y}
              count={contextActionCount}
              selected={Boolean(contextItem && selectedKeySet.has(contextMenu.key))}
              onToggleSelected={() => contextMenu ? toggleItemSelection(contextMenu.key) : undefined}
              onRunScoring={() => void scoreTargets(contextTargetItems())}
              onRunDrafting={() => void draftTargets(contextTargetItems())}
            />
          ) : null}
        </>
      ) : null}

      {engageView === "feedback" ? <FeedbackReviewPanel mode={mode} signals={signals} /> : null}
      {engageView === "memory" ? (
        <GrowthMemoryPanel
          mode={mode}
          memory={growthMemory}
          signals={signals}
          onRunLearning={runGrowthMemoryLearning}
          onClearMemory={clearGrowthMemory}
        />
      ) : null}
      {engageView === "stats" ? <ExecutionStatsPanel mode={mode} stats={executionStats} recentSignals={recentProcessedSignals} /> : null}
    </div>
  );
}
function LongTaskOverlay({ title, message, detail }: { title: string; message: string; detail: string }) {
  return (
    <div className="fixed inset-0 z-[100] grid place-items-center bg-[#030712]/82 p-4 text-white backdrop-blur-sm" role="status" aria-live="polite" aria-busy="true">
      <style>{`
        @keyframes ray-runner-jump {
          0%, 100% { transform: translateY(0); }
          42% { transform: translateY(-26px); }
        }
        @keyframes ray-obstacle-move {
          0% { transform: translateX(250px); opacity: 0; }
          10%, 85% { opacity: 1; }
          100% { transform: translateX(-72px); opacity: 0; }
        }
        @keyframes ray-track-shift {
          from { background-position-x: 0; }
          to { background-position-x: -34px; }
        }
      `}</style>
      <div className="w-full max-w-md rounded-xl border border-blue-300/20 bg-[#07111f]/95 p-5 shadow-2xl shadow-blue-500/20">
        <div className="flex items-start gap-3">
          <div className="grid h-11 w-11 shrink-0 place-items-center rounded-lg border border-blue-300/25 bg-blue-500/15 text-blue-100">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
          <div className="min-w-0">
            <p className="text-base font-black text-white">{title}</p>
            <p className="mt-1 text-sm leading-6 text-white/68">{message}</p>
          </div>
        </div>

        <div className="relative mt-5 h-24 overflow-hidden rounded-lg border border-blue-300/15 bg-[#091522]">
          <div className="absolute inset-0 opacity-35" style={{ backgroundImage: "linear-gradient(to right, rgba(59,130,246,0.16) 1px, transparent 1px)", backgroundSize: "34px 100%", animation: "ray-track-shift 1.2s linear infinite" }} />
          <div className="absolute bottom-6 left-0 right-0 h-px bg-blue-200/25" />
          <div className="absolute bottom-6 left-12 grid h-10 w-10 place-items-center rounded-md border border-blue-200/35 bg-blue-500/20 text-[11px] font-black text-blue-50 shadow-lg shadow-blue-500/20" style={{ animation: "ray-runner-jump 1.05s ease-in-out infinite" }}>
            AI
          </div>
          <div className="absolute bottom-6 left-0 h-7 w-3 rounded-t-sm bg-blue-200/55" style={{ animation: "ray-obstacle-move 1.4s linear infinite" }} />
          <div className="absolute bottom-6 left-0 h-10 w-4 rounded-t-sm bg-cyan-200/45" style={{ animation: "ray-obstacle-move 1.4s linear 0.72s infinite" }} />
        </div>

        <p className="mt-4 rounded-md border border-white/[0.08] bg-white/[0.035] px-3 py-2 text-xs leading-5 text-white/55">{detail}</p>
      </div>
    </div>
  );
}
function AiQueueActionBar({
  selectedCount,
  visibleCount,
  totalCount,
  allVisibleSelected,
  allItemsSelected,
  aiScoreCount,
  aiDraftCount,
  styleSampleCount,
  ownAccountCount,
  state,
  message,
  onSelectAll,
  onToggleVisibleSelection,
  onClearSelection,
  onRunScoring,
  onRunDrafting,
  onBatchStatus,
  onDeleteSelected,
  onCleanOwnAccount,
}: {
  selectedCount: number;
  visibleCount: number;
  totalCount: number;
  allVisibleSelected: boolean;
  allItemsSelected: boolean;
  aiScoreCount: number;
  aiDraftCount: number;
  styleSampleCount: number;
  ownAccountCount: number;
  state: "idle" | "loading" | "error";
  message: string;
  onSelectAll: () => void;
  onToggleVisibleSelection: () => void;
  onClearSelection: () => void;
  onRunScoring: () => void;
  onRunDrafting: () => void;
  onBatchStatus: (status: SignalExecutionStatus) => void;
  onDeleteSelected: () => void;
  onCleanOwnAccount: () => void;
}) {
  const disabled = selectedCount === 0 || state === "loading";
  const scoreCount = Math.min(selectedCount, AI_SCORE_LIMIT);
  const draftCount = Math.min(selectedCount, AI_DRAFT_LIMIT);

  return (
    <div className="sticky top-0 z-20 rounded-lg border border-blue-300/15 bg-[#08090d]/92 p-3 text-white shadow-2xl shadow-black/25 backdrop-blur-xl">
      <div className="flex flex-col gap-3 2xl:flex-row 2xl:items-center 2xl:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="rounded-md border-blue-300/15 bg-blue-400/10 text-blue-100">已选 {selectedCount}</Badge>
            <span className="text-xs text-white/45">当前页 {visibleCount} / 筛选后 {totalCount}</span>
          </div>
          <p className={cn("mt-2 text-xs leading-5", state === "error" ? "text-rose-200" : "text-white/55")}>{message}</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" size="sm" className="tech-secondary h-8" onClick={onToggleVisibleSelection} disabled={visibleCount === 0}>
            {allVisibleSelected ? "取消当前页" : "全选当前页"}
          </Button>
          <Button type="button" variant="outline" size="sm" className="tech-secondary h-8" onClick={onClearSelection} disabled={selectedCount === 0}>
            清空选择
          </Button>
          <Button type="button" variant="outline" size="sm" className="tech-secondary h-8" onClick={() => onBatchStatus("deferred")} disabled={disabled}>
            批量搁置
          </Button>
          <Button type="button" variant="outline" size="sm" className="tech-secondary h-8" onClick={() => onBatchStatus("skipped")} disabled={disabled}>
            批量跳过
          </Button>
          <Button type="button" variant="outline" size="sm" className="tech-secondary h-8 border-rose-400/20 text-rose-100 hover:bg-rose-500/10" onClick={onDeleteSelected} disabled={disabled}>
            <Trash2 className="h-3.5 w-3.5" /> 批量删除
          </Button>
          <Button type="button" variant="outline" size="sm" className="tech-secondary h-8 border-rose-400/20 text-rose-100 hover:bg-rose-500/10" onClick={onCleanOwnAccount} disabled={ownAccountCount === 0 || state === "loading"} title={ownAccountCount ? "删除识别为自己账号的线索" : "当前没有识别到自己的账号线索"}>
            <Trash2 className="h-3.5 w-3.5" /> 清理自己账号 {ownAccountCount ? ownAccountCount : ""}
          </Button>
          <Button type="button" className="tech-cta h-8" onClick={onRunScoring} disabled={disabled}>
            {state === "loading" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Gauge className="h-3.5 w-3.5" />} AI 评分 {scoreCount ? scoreCount : ""}
          </Button>
          <Button type="button" className="tech-cta h-8" onClick={onRunDrafting} disabled={disabled}>
            {state === "loading" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <MessageSquareText className="h-3.5 w-3.5" />} 生成草稿 {draftCount ? draftCount : ""}
          </Button>
          <Button asChild variant="outline" size="sm" className="tech-secondary h-8">
            <Link href="/settings">
              <Settings className="h-3.5 w-3.5" /> 配置
            </Link>
          </Button>
        </div>
      </div>

      <div className="mt-3 grid gap-2 text-xs sm:grid-cols-3">
        <div className="rounded-md border border-white/[0.06] bg-white/[0.025] px-3 py-2 text-white/55">已评分 <span className="font-black text-white">{aiScoreCount}</span></div>
        <div className="rounded-md border border-white/[0.06] bg-white/[0.025] px-3 py-2 text-white/55">已生成草稿 <span className="font-black text-white">{aiDraftCount}</span></div>
        <div className="rounded-md border border-white/[0.06] bg-white/[0.025] px-3 py-2 text-white/55">风格样本 <span className="font-black text-blue-200">{styleSampleCount}</span></div>
      </div>
    </div>
  );
}

function AiQueueContextMenu({
  x,
  y,
  count,
  selected,
  onToggleSelected,
  onRunScoring,
  onRunDrafting,
}: {
  x: number;
  y: number;
  count: number;
  selected: boolean;
  onToggleSelected: () => void;
  onRunScoring: () => void;
  onRunDrafting: () => void;
}) {
  return (
    <div className="fixed z-50 w-56 overflow-hidden rounded-lg border border-white/[0.10] bg-[#08090d]/96 p-1 text-white shadow-2xl shadow-black/45 backdrop-blur-xl" style={{ left: x, top: y }} onClick={(event) => event.stopPropagation()}>
      <div className="px-3 py-2 text-xs text-white/45">操作 {count} 条</div>
      <button type="button" className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-white/75 hover:bg-white/[0.06] hover:text-white" onClick={onToggleSelected}>
        <CheckCircle2 className="h-4 w-4" /> {selected ? "取消选中" : "选中这一条"}
      </button>
      <button type="button" className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-white/75 hover:bg-blue-400/10 hover:text-blue-100" onClick={onRunScoring}>
        <Gauge className="h-4 w-4" /> AI 评分
      </button>
      <button type="button" className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-white/75 hover:bg-blue-400/10 hover:text-blue-100" onClick={onRunDrafting}>
        <MessageSquareText className="h-4 w-4" /> 生成回复草稿
      </button>
    </div>
  );
}

function EngagementAccordionCard({
  mode,
  item,
  signal,
  selected,
  expanded,
  onToggle,
  onSelectedChange,
  onContextMenu,
  onStatusChange,
  onFeedbackChange,
  onUsedDraftChange,
  onDelete,
}: {
  variant?: "search" | "account";
  mode: Mode;
  item: QueueItem;
  signal?: Signal;
  selected: boolean;
  expanded: boolean;
  onToggle: () => void;
  onSelectedChange: () => void;
  onContextMenu: (event: ReactMouseEvent<HTMLDivElement>) => void;
  onStatusChange: (status: SignalExecutionStatus) => void;
  onFeedbackChange: (feedback: SignalFeedbackStatus) => void;
  onUsedDraftChange: (usedDraft: string) => void;
  onDelete: () => void;
}) {
  const isOutbound = mode === "outbound";
  const growthItem = item as GrowthOpportunity;
  const outboundItem = item as OutboundLead;
  const aiScore = (item as QueueItem & { aiScore?: AiScore }).aiScore;
  const aiDraft = (item as QueueItem & { aiDraft?: AiDraft }).aiDraft;
  const hasAiScore = Boolean(aiScore);
  const hasAiDraft = Boolean(aiDraft);
  const status = normalizeExecutionStatus(signal?.status);
  const feedback = normalizeFeedbackStatus(signal?.feedback);
  const processedTime = formatProcessedAt(signal?.processedAt);
  const feedbackTime = formatProcessedAt(signal?.feedbackAt);
  const sourceUrl = openableSourceUrl(item.url);

  return (
    <div onContextMenu={onContextMenu} className={cn("overflow-hidden rounded-lg border border-white/[0.08] bg-[#0d0d10]/72 text-white shadow-2xl shadow-black/20 transition-all duration-300 hover:border-white/[0.15] hover:bg-white/[0.035]", selected && "border-blue-300/30 bg-blue-400/[0.045] shadow-blue-500/10")}>
      <div className="grid w-full gap-3 p-4 md:grid-cols-[auto_minmax(0,1fr)_auto] md:items-center">
        <button
          type="button"
          aria-label={selected ? "取消选择" : "选择条目"}
          onClick={onSelectedChange}
          className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-md border border-white/[0.10] bg-white/[0.035] text-white/45 transition-all duration-200 hover:border-blue-300/35 hover:bg-blue-400/10 hover:text-blue-100", selected && "border-blue-300/35 bg-blue-400/15 text-blue-100")}
        >
          {selected ? <CheckCircle2 className="h-4 w-4" /> : <span className="h-3.5 w-3.5 rounded-sm border border-current" />}
        </button>
        <button type="button" onClick={onToggle} className="min-w-0 text-left">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="rounded-md border-white/[0.08] bg-white/[0.04] text-white/65">{item.platform}</Badge>
            <h3 className="truncate text-base font-black text-white">{item.name}</h3>
            {sourceUrl ? <span className="text-xs text-white/35">已关联来源</span> : null}
            {status !== "new" ? (
              <Badge variant="outline" className={cn("rounded-md text-[11px]", executionStatusClass(status))} title={processedTime ? `处理于 ${processedTime}` : undefined}>
                {executionStatusLabel(status, mode)}{processedTime ? ` · ${processedTime}` : ""}
              </Badge>
            ) : null}
            {feedback !== "none" ? (
              <Badge variant="outline" className={cn("rounded-md text-[11px]", feedbackStatusClass(feedback))} title={feedbackTime ? `反馈于 ${feedbackTime}` : undefined}>
                {feedbackStatusLabel(feedback)}{feedbackTime ? ` · ${feedbackTime}` : ""}
              </Badge>
            ) : null}
            {hasAiScore ? <Badge variant="outline" className="rounded-md border-blue-300/15 bg-blue-400/10 text-[11px] text-blue-100">AI 评分</Badge> : null}
            {hasAiDraft ? <Badge variant="outline" className="rounded-md border-cyan-300/20 bg-cyan-400/10 text-[11px] text-cyan-100"><MessageSquareText className="mr-1 h-3 w-3" /> AI 草稿</Badge> : null}
          </div>
          <p className="mt-2 line-clamp-2 text-sm leading-6 text-white/50">{item.note || "暂无备注"}</p>
        </button>
        <div className="flex flex-wrap items-center gap-2 md:justify-end">
          <button type="button" onClick={onToggle} className="flex flex-wrap items-center gap-2 text-left md:justify-end">
            {sourceUrl ? (
              <span className="rounded-md border border-white/[0.08] bg-white/[0.03] px-2 py-1 text-xs text-white/55">来源</span>
            ) : null}
            <Badge variant={scoreVariant(item.label)} className="w-fit rounded-md">{item.score} 优先级分</Badge>
            <Badge variant="outline" className={cn("rounded-md", item.label === (mode === "outbound" ? "High intent" : "Engage now") ? "border-emerald-500/10 bg-emerald-500/10 text-emerald-300" : "border-amber-500/10 bg-amber-500/10 text-amber-200")}>{displayLabel(item.label)}</Badge>
          </button>
          <Button type="button" variant="outline" size="sm" className="tech-secondary h-8 border-rose-400/20 px-2 text-rose-100 hover:bg-rose-500/10" title="删除这条线索" onClick={(event) => { event.stopPropagation(); onDelete(); }}>
            <Trash2 className="h-3.5 w-3.5" /> 删除
          </Button>
        </div>
      </div>

      {expanded ? (
        <div className="grid gap-4 border-t border-white/[0.08] p-4">
          {sourceUrl ? (
            <Button asChild variant="outline" size="sm" className="tech-secondary w-fit">
              <a href={sourceUrl} target="_blank" rel="noreferrer"><ExternalLink className="h-3.5 w-3.5" /> 来源</a>
            </Button>
          ) : null}
          {aiScore ? (
            <div className="rounded-lg border border-blue-300/15 bg-blue-400/[0.055] p-3 text-sm leading-6 text-blue-50/85">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <Badge variant="outline" className="rounded-md border-blue-300/20 bg-blue-400/10 text-blue-100">AI {aiScore.score} 分</Badge>
                <span className="text-xs font-semibold text-white/50">{aiScore.label}</span>
              </div>
              <p><span className="text-blue-100/55">推荐动作：</span>{aiScore.recommendedAction || itemAction(item)}</p>
              {aiScore.suggestedAngle ? <p className="mt-1"><span className="text-blue-100/55">切入角度：</span>{aiScore.suggestedAngle}</p> : null}
              {aiScore.reason ? <p className="mt-2 border-t border-blue-300/10 pt-2 text-xs leading-5 text-white/50">{aiScore.reason}</p> : null}
            </div>
          ) : null}
          <ReasonList reasons={item.reasons} />
          <ExecutionControls mode={mode} item={item} signal={signal} onStatusChange={onStatusChange} onFeedbackChange={onFeedbackChange} onUsedDraftChange={onUsedDraftChange} />
          <div className={cn("grid gap-3", isOutbound ? "" : "xl:grid-cols-2 2xl:grid-cols-4")}>
            {isOutbound ? (
              <DraftBlock icon={<MessageSquareText className="h-4 w-4" />} title="私信开场" description="发给这个潜在线索的第一句话。" value={outboundItem.draft} source={draftSourceForItem(item)} />
            ) : (
              <>
                <DraftBlock icon={<MessageSquareText className="h-4 w-4" />} title="直接回复" description="发到原帖或评论下面，用来先建立互动。" value={growthItem.replyDraft} source={draftSourceForItem(item)} />
                <DraftBlock icon={<Quote className="h-4 w-4" />} title="引用转发" description="引用这条内容再发表自己的观点。" value={growthItem.quoteDraft} source={draftSourceForItem(item)} />
                <DraftBlock icon={<Lightbulb className="h-4 w-4" />} title="内容选题" description="把这个信号延展成你自己的原创帖。" value={growthItem.postIdea} source={draftSourceForItem(item)} />
                <DraftBlock icon={<Target className="h-4 w-4" />} title="私下跟进" description="对方有明确需求时用于私信或后续交流，不要硬卖。" value={growthItem.outreachDraft} source={draftSourceForItem(item)} />
              </>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function AudienceTab({
  mode,
  copy,
  current,
  updateField,
  queryCount,
  itemCount,
  hotCount,
  draftCount,
  averageScore,
  stages,
}: {
  variant?: "search" | "account";
  mode: Mode;
  copy: ModeContent;
  current: FormState;
  updateField: (field: keyof FormState, value: string) => void;
  queryCount: number;
  itemCount: number;
  hotCount: number;
  draftCount: number;
  averageScore: number;
  stages: Array<{ label: string; value: number; detail: string }>;
}) {
  return (
    <div className="grid gap-4 xl:grid-cols-[430px_minmax(0,1fr)]">
      <InputPanel mode={mode} copy={copy} current={current} updateField={updateField} />
      <div className="grid content-start gap-4">
        <MetricGrid queryCount={queryCount} itemCount={itemCount} hotCount={hotCount} draftCount={draftCount} averageScore={averageScore} mode={mode} />
        <PipelinePanel mode={mode} stages={stages} />
      </div>
    </div>
  );
}
function HeroPanel({
  mode,
  copy,
  stages,
  result,
  hotCount,
  averageScore,
}: {
  variant?: "search" | "account";
  mode: Mode;
  copy: ModeContent;
  stages: Array<{ label: string; value: number; detail: string }>;
  result: WorkbenchResult;
  hotCount: number;
  averageScore: number;
}) {
  return (
    <div className="hero-card fade-up delay-1 relative overflow-hidden rounded-lg border text-white shadow-soft">
      <div className="absolute inset-x-0 top-0 z-10 h-px bg-gradient-to-r from-transparent via-white/25 to-transparent" />
      <div className="relative z-10 grid gap-6 p-5 lg:grid-cols-[minmax(0,1fr)_340px] lg:p-7">
        <div className="grid content-between gap-6">
          <div className="space-y-5">
            <div className="flex flex-wrap items-center gap-2">
              <Badge className="rounded-md border-emerald-300/20 bg-emerald-400/10 text-emerald-100">{copy.badge}</Badge>
              <Badge variant="outline" className="rounded-md border-blue-300/15 bg-blue-400/10 text-blue-100">
                <Sparkles className="mr-1 h-3.5 w-3.5" /> AI 工作流
              </Badge>
              <Badge variant="outline" className="rounded-md border-blue-300/15 bg-blue-400/10 text-blue-100">
                {hotCount} 个待执行动作
              </Badge>
            </div>

            <div className="max-w-3xl space-y-3">
              <h2 className="max-w-3xl text-4xl font-black leading-[1.04] sm:text-5xl lg:text-6xl">{mode === "outbound" ? <>在用户主动搜索前<span className="gradient-text">找到买家。</span></> : <>把 X 上的讨论变成<span className="gradient-text">粉丝增长。</span></>}</h2>
              <p className="max-w-[600px] text-sm leading-6 text-slate-300 sm:text-base">{copy.heroDescription}</p>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button className="tech-cta" onClick={() => copyText(result.queries.map((query) => query.query).join("\n"))}>
                <Search className="h-4 w-4" /> 复制完整 Grok Prompt
              </Button>
              <Button variant="outline" className="tech-secondary" onClick={() => copyText(`${copy.title}：平均分 ${averageScore}`)}>
                <Gauge className="h-4 w-4" /> 复制评分简报
              </Button>
            </div>
          </div>

          <WorkflowStrip stages={stages} />
        </div>

        <SignalMap result={result} averageScore={averageScore} hotCount={hotCount} />
      </div>
    </div>
  );
}

function WorkflowStrip({ stages, onSelectTab }: { stages: Array<{ label: string; value: number; detail: string; help?: string; targetTab?: DashboardTab }>; onSelectTab?: (tab: DashboardTab) => void }) {
  const gridClass = stages.length <= 2 ? "sm:grid-cols-2" : stages.length === 3 ? "sm:grid-cols-3" : "sm:grid-cols-4";

  return (
    <div className={cn("grid gap-2", gridClass)}>
      {stages.map((stage, index) => (
        <button
          key={stage.label}
          type="button"
          aria-label={`打开${stage.label}`}
          title={`打开${stage.label}`}
          onClick={() => stage.targetTab ? onSelectTab?.(stage.targetTab) : undefined}
          className="micro-glass group animate-fade-in-up grid min-h-[132px] cursor-pointer gap-y-1.5 rounded-lg border border-white/[0.06] bg-white/[0.02] p-4 text-left backdrop-blur-md transition-all duration-200 hover:-translate-y-1 hover:border-blue-300/25 hover:bg-blue-400/[0.04] hover:shadow-2xl hover:shadow-blue-500/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300/40 active:translate-y-0"
          style={{ animationDelay: `${180 + index * 100}ms` }}
        >
          <div className="flex items-start justify-between gap-2 text-xs font-semibold uppercase text-slate-400">
            <span className="transition-colors duration-200 group-hover:text-blue-100">0{index + 1}</span>
            <span className="flex items-center gap-2">
              {stage.help ? (
                <span className="group/help relative grid h-6 w-6 place-items-center rounded-md border border-white/[0.06] bg-white/[0.025] text-white/40 transition-colors duration-200 hover:border-blue-300/25 hover:bg-blue-400/10 hover:text-blue-100" title={stage.help} aria-label={`${stage.label}说明`}>
                  <CircleHelp className="h-3.5 w-3.5" />
                  <span className="pointer-events-none absolute right-0 top-7 z-30 w-56 rounded-md border border-white/[0.08] bg-[#08090d]/95 p-3 text-left text-xs font-medium normal-case leading-5 text-white/70 opacity-0 shadow-2xl shadow-black/40 backdrop-blur-md transition-opacity duration-150 group-hover/help:opacity-100">
                    {stage.help}
                  </span>
                </span>
              ) : null}
              {index < stages.length - 1 ? <ArrowRight className="h-3.5 w-3.5 transition-transform duration-200 group-hover:translate-x-1 group-hover:text-blue-200" /> : <CheckCircle2 className="h-3.5 w-3.5 text-emerald-300 transition-transform duration-200 group-hover:scale-110" />}
            </span>
          </div>
          <p className="metric-number mt-2 text-2xl font-bold leading-none transition-colors duration-200 group-hover:text-blue-100">{stage.value}</p>
          <p className="mt-1 text-sm font-semibold text-white">{stage.label}</p>
          <p className="mt-1 text-xs text-slate-400 transition-colors duration-200 group-hover:text-slate-300">{stage.detail}</p>
        </button>
      ))}
    </div>
  );
}
function SignalMap({ result, averageScore, hotCount }: { result: WorkbenchResult; averageScore: number; hotCount: number }) {
  const channels = result.queries.slice(0, 4);

  return (
    <div className="micro-glass animate-fade-in-up delay-3 relative overflow-hidden rounded-lg border border-white/[0.06] bg-white/[0.02] p-4 shadow-2xl shadow-blue-500/5 backdrop-blur-md">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-widest text-white/40">信号地图</p>
          <p className="mt-1 text-sm font-semibold text-white">实时工作流预览</p>
        </div>
        <div className="grid h-10 w-10 place-items-center rounded-full border border-white/[0.08] bg-white/[0.02] text-white/70 transition-transform duration-300 hover:scale-110">
          <Radar className="h-5 w-5" />
        </div>
      </div>

      <div className="mt-5 grid gap-y-3">
        {channels.map((query, index) => (
          <div key={`${query.channel}-${index}`} className="signal-row grid grid-cols-[36px_1fr_auto] items-center gap-3 rounded-lg p-2.5 transition-colors duration-200 hover:bg-white/[0.02]">
            <span className="grid h-9 w-9 place-items-center rounded-md border border-white/[0.06] bg-white/[0.03] text-sm font-black text-white/60">{index + 1}</span>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-white">{query.channel}</p>
              <p className="truncate text-xs text-slate-400">{query.intent}</p>
            </div>
            <span className="ready-pill animate-pulse rounded-md px-2 py-1 text-[11px] font-bold">就绪</span>
          </div>
        ))}
      </div>

      <div className="mt-5 grid grid-cols-2 gap-2">
        <div className="micro-glass rounded-md border border-white/[0.06] bg-white/[0.02] p-3 backdrop-blur-md">
          <p className="text-xs text-slate-400">平均分</p>
          <p className="metric-number mt-1 text-2xl font-black">{averageScore}</p>
        </div>
        <div className="micro-glass rounded-md border border-white/[0.06] bg-white/[0.02] p-3 backdrop-blur-md">
          <p className="text-xs text-slate-400">高优先级</p>
          <p className="metric-number mt-1 text-2xl font-black">{hotCount}</p>
        </div>
      </div>
    </div>
  );
}

function CopilotPanel({
  mode,
  topItem,
  averageScore,
  hotCount,
}: {
  variant?: "search" | "account";
  mode: Mode;
  topItem?: QueueItem;
  averageScore: number;
  hotCount: number;
}) {
  const topAiScore = (topItem as (QueueItem & { aiScore?: AiScore }) | undefined)?.aiScore;
  const hasAiRecommendation = Boolean(topAiScore?.recommendedAction || topAiScore?.suggestedAngle || topAiScore?.reason);
  const recommendationSource = hasAiRecommendation ? "AI 评分建议" : "本地策略建议";
  const recommendation = topAiScore?.recommendedAction
    ? topAiScore.suggestedAngle
      ? `${topAiScore.recommendedAction}：${topAiScore.suggestedAngle}`
      : topAiScore.recommendedAction
    : topItem
      ? mode === "outbound"
        ? `${topItem.note || topItem.name} 里已经有明确痛点，先围绕痛点开场，再给一个具体下一步。`
        : `先回复，再把 ${topItem.name} 延展成一条可引用的内容角度。`
      : "添加候选信号后，这里会生成第一条优先建议。";
  const recommendationReason = topAiScore?.reason;

  return (
    <Card className="fade-up delay-2 overflow-hidden border border-white/[0.08] bg-white/[0.026] text-white shadow-2xl shadow-black/20 backdrop-blur-md">
      <CardHeader className="border-b border-white/[0.08] bg-white/[0.024]">
        <div className="flex items-start justify-between gap-3">
          <div>
            <Badge variant="outline" className={cn("rounded-md", hasAiRecommendation ? "border-blue-300/20 bg-blue-400/10 text-blue-200" : "border-white/[0.08] bg-white/[0.04] text-white/60")}>
              <Bot className="mr-1 h-3.5 w-3.5" /> {recommendationSource}
            </Badge>
            <CardTitle className="mt-3 text-xl text-white">下一步动作</CardTitle>
            <CardDescription className="mt-2 text-white/60">基于当前队列排序生成；运行 AI 评分后会优先使用 AI 推荐动作。</CardDescription>
          </div>
          <div className="grid h-11 w-11 place-items-center rounded-md border border-white/[0.08] bg-white/[0.035] text-blue-100">
            <Zap className="h-5 w-5" />
          </div>
        </div>
      </CardHeader>
      <CardContent className="grid gap-4 p-4 text-white">
        <div className="rounded-lg border border-white/[0.08] bg-[#0a0b0e]/72 p-3 text-white shadow-inner shadow-white/[0.02]">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase text-white/40">
            <Command className="h-3.5 w-3.5" /> {hasAiRecommendation ? "AI 操作建议" : "本地操作建议"}
          </div>
          <p className="mt-3 text-sm leading-6 text-white/80">{recommendation}</p>
          {recommendationReason ? <p className="mt-2 border-t border-white/[0.06] pt-2 text-xs leading-5 text-white/45">{recommendationReason}</p> : null}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <MiniStat icon={<Gauge className="h-4 w-4" />} label="队列均分" value={`${averageScore}/100`} description="当前候选的平均优先级。" />
          <MiniStat icon={<Clock3 className="h-4 w-4" />} label="建议处理" value={`${hotCount} 条`} description="分数较高、适合优先互动的条目。" />
        </div>

        {topItem ? (
          <div className="rounded-lg border border-white/[0.08] bg-white/[0.03] p-3 backdrop-blur-md transition-all duration-300 hover:border-white/[0.15] hover:bg-white/[0.05]">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-bold text-white">{topItem.name}</p>
                <p className="mt-1 text-xs font-semibold uppercase text-white/45">{topItem.platform} · {itemAction(topItem)}</p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {hasAiRecommendation ? <Badge variant="outline" className="rounded-md border-blue-300/15 bg-blue-400/10 text-[11px] text-blue-100">AI</Badge> : null}
                <Badge variant={scoreVariant(topItem.label)} className="rounded-md">
                  {topItem.score} 分
                </Badge>
              </div>
            </div>
            <p className="mt-3 line-clamp-3 text-sm leading-6 text-white/70">{itemDraft(topItem)}</p>
          </div>
        ) : null}

        <Button onClick={() => topItem ? copyText(itemDraft(topItem)) : undefined} disabled={!topItem} className="tech-cta w-full">
          <Copy className="h-4 w-4" /> 复制这条草稿
        </Button>
      </CardContent>
    </Card>
  );
}
function MiniStat({ icon, label, value, description }: { icon: ReactNode; label: string; value: string; description?: string }) {
  return (
    <div className="rounded-lg border border-white/[0.08] bg-white/[0.026] p-3 text-white backdrop-blur-md">
      <div className="flex items-center gap-2 text-xs font-semibold uppercase text-white/45">{icon}{label}</div>
      <p className="mt-2 text-xl font-black text-white">{value}</p>
      {description ? <p className="mt-1 text-xs leading-5 text-white/45">{description}</p> : null}
    </div>
  );
}
function InputPanel({
  mode,
  copy,
  current,
  updateField,
  onGenerateProfile,
  onSaveProfile,
}: {
  variant?: "search" | "account";
  mode: Mode;
  copy: ModeContent;
  current: FormState;
  updateField: (field: keyof FormState, value: string) => void;
  onGenerateProfile?: (onRetry?: AiProfileRetryHandler) => Promise<AiProfileRunResult>;
  onSaveProfile?: () => void;
}) {
  const { locale, t } = useI18n();
  const tr = (zh: string, en: string) => (locale === "en" ? en : zh);
  const formCopy = locale === "en"
    ? {
        badge: "Growth opportunities",
        description: "Describe who you are, who you want to reach, and the problems you can help with. The workbench will turn it into public-discussion queries, ranking, and drafts.",
        primaryLabel: "Account / product name",
        secondaryLabel: "Growth goal",
        descriptionLabel: "Positioning",
        targetLabel: "Target audience",
        pillarLabel: "Topics / pain points",
        candidateLabel: "Imported X signals",
      }
    : copy;
  const [profileState, setProfileState] = useState<"idle" | "loading" | "error">("idle");
  const [profileMessage, setProfileMessage] = useState("");
  const [profileRetry, setProfileRetry] = useState<AiProfileRetryProgress | null>(null);

  async function generateProfile() {
    if (!onGenerateProfile) return;
    setProfileState("loading");
    setProfileRetry(null);
    setProfileMessage(tr("正在根据 X 主页和当前内容生成定位草稿...", "Generating a positioning draft from the public X profile and current inputs…"));

    try {
      const result = await onGenerateProfile((progress) => {
        setProfileRetry(progress);
        setProfileMessage(locale === "en"
          ? `Automatic retry ${progress.retryNumber}/${progress.maxRetries} is running. Previous error: ${progress.reason}`
          : `正在进行第 ${progress.retryNumber}/${progress.maxRetries} 次自动重试。上一次错误：${progress.reason}`);
      });
      setProfileState("idle");
      setProfileRetry(null);
      const successMessage = locale === "en"
        ? `A positioning draft from ${result.model} was added to the fields below.${result.profile.reasoning ? ` Basis: ${result.profile.reasoning}` : ""}`
        : `已用 ${result.model} 生成定位草稿，并回填到下面字段。${result.profile.reasoning ? `依据：${result.profile.reasoning}` : ""}`;
      setProfileMessage(successMessage);
      showToast(tr("AI 已生成定位草稿。", "AI positioning draft generated."), "success");
    } catch (error) {
      setProfileState("error");
      setProfileRetry(null);
      const errorMessage = error instanceof Error ? error.message : tr("AI 定位生成失败，请稍后再试。", "AI positioning generation failed. Please try again." );
      setProfileMessage(errorMessage);
      showToast(errorMessage, "error");
    }
  }

  return (
    <Card className="fade-up delay-3 overflow-hidden border-slate-200 bg-white xl:sticky xl:top-20 xl:self-start">
      <CardHeader className="border-b border-slate-200 bg-white">
        <div className="flex items-start justify-between gap-3">
          <div>
            <Badge variant="secondary" className="rounded-md bg-slate-100 text-slate-700">{formCopy.badge}</Badge>
            <CardTitle className="mt-3 text-xl">{mode === "outbound" ? tr("第 1 步：填写产品定位", "Step 1: Define product positioning") : tr("第 1 步：填写账号定位", "Step 1: Define positioning")}</CardTitle>
            <CardDescription className="mt-2 leading-6">{formCopy.description}</CardDescription>
          </div>
          <div className="grid h-10 w-10 place-items-center rounded-md bg-emerald-50 text-emerald-700">
            {mode === "outbound" ? <Target className="h-5 w-5" /> : <Users className="h-5 w-5" />}
          </div>
        </div>
      </CardHeader>

      <CardContent className="grid gap-4 p-4">
        {onGenerateProfile ? (
          <div className="rounded-lg border border-blue-200/70 bg-blue-50 p-3 text-slate-700 shadow-sm">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="text-sm font-black text-slate-950">{tr("不知道怎么填？", "Need a starting point?")}</p>
                <p className="mt-1 text-xs leading-5 text-slate-600">{locale === "en" ? <>Save a public X profile URL in <Link href="/settings" className="font-bold text-blue-700 underline-offset-2 hover:underline">Settings</Link>, then let AI generate an editable first draft.</> : <>先在 <Link href="/settings" className="font-bold text-blue-700 underline-offset-2 hover:underline">设置</Link> 里保存 X 主页地址，再让 AI 帮你生成一版初稿。</>}</p>
              </div>
              <div className="flex shrink-0 flex-col gap-2 sm:flex-row">
                <Button type="button" className="bg-[#3B82F6] text-white hover:bg-blue-500" onClick={() => void generateProfile()} disabled={profileState === "loading"}>
                  {profileState === "loading" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />} {profileRetry
                    ? tr(`重试 ${profileRetry.retryNumber}/${profileRetry.maxRetries}`, `Retry ${profileRetry.retryNumber}/${profileRetry.maxRetries}`)
                    : profileState === "loading"
                      ? tr("生成中...", "Generating…")
                      : tr("AI 帮我生成", "Generate with AI")}
                </Button>
                {onSaveProfile ? (
                  <Button type="button" variant="outline" className="border-blue-200 bg-white text-blue-700 hover:bg-blue-50 hover:text-blue-800" onClick={onSaveProfile}>
                    <Database className="h-4 w-4" /> {tr("保存当前定位", "Save positioning")}
                  </Button>
                ) : null}
              </div>
            </div>
            <p className={cn("mt-2 text-xs leading-5", profileState === "error" ? "text-rose-700" : "text-blue-700")}>{profileMessage}</p>
          </div>
        ) : null}
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
          <Field label={formCopy.primaryLabel}>
            <Input value={current.productName} onChange={(event) => updateField("productName", event.target.value)} />
          </Field>
          <Field label={formCopy.secondaryLabel}>
            <Input value={current.competitors} onChange={(event) => updateField("competitors", event.target.value)} />
          </Field>
        </div>
        <Field label={formCopy.descriptionLabel}>
          <Textarea rows={4} value={current.description} onChange={(event) => updateField("description", event.target.value)} />
        </Field>
        <Field label={formCopy.targetLabel}>
          <Textarea rows={3} value={current.targetCustomer} onChange={(event) => updateField("targetCustomer", event.target.value)} />
        </Field>
        <Field label={formCopy.pillarLabel}>
          <Textarea rows={3} value={current.painPoints} onChange={(event) => updateField("painPoints", event.target.value)} />
        </Field>
        <div className="rounded-lg border border-blue-200/70 bg-blue-50 p-3 shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-black uppercase tracking-wide text-slate-950">{tr("回复策略", "Engagement policy")}</p>
              <p className="mt-1 text-xs leading-5 text-slate-600">{tr("这会进入 GPT-5.5 草稿 Prompt，用来决定是否露出产品/身份，以及这次互动想达成什么。", "This is sent to the AI draft prompt to define the goal and when identity or product context is relevant.")}</p>
            </div>
            <Bot className="h-4 w-4 shrink-0 text-blue-600" />
          </div>
          <div className="mt-3 grid gap-3">
            <Field label={tr("互动目的 / 下一步", "Engagement goal / next step")}>
              <Textarea rows={2} value={current.replyGoal} onChange={(event) => updateField("replyGoal", event.target.value)} placeholder={tr("例如：先贡献观点，再引导对方关注、私聊或试用。", "Example: offer one actionable idea, then invite a relevant follow-up.")} />
            </Field>
            <Field label={tr("产品/身份露出方式", "Product / identity context")}>
              <Textarea rows={3} value={current.productContext} onChange={(event) => updateField("productContext", event.target.value)} placeholder={tr("例如：我在做/分享什么；什么时候可以提到，什么不能承诺。", "Example: what you build or share, when it is relevant to mention, and what you cannot promise.")} />
            </Field>
          </div>
        </div>
        <Field label={formCopy.candidateLabel}>
          <p className="text-xs leading-5 text-slate-500">{tr("这里是 Grok/X 结果导入后的线索池；第一次使用时先填上面的定位，再去 Grok 找人。", "This is the imported signal pool. Start by defining positioning above, then use Grok to find public discussions.")}</p>
          <Textarea rows={9} value={current.leadInput} onChange={(event) => updateField("leadInput", event.target.value)} className="font-mono text-xs leading-5" />
        </Field>
      </CardContent>
    </Card>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-2">
      <Label className="text-xs font-bold uppercase text-slate-500">{label}</Label>
      {children}
    </div>
  );
}

function AiScorePanel({
  mode,
  items,
  savedCount,
  onRunAiScoring,
}: {
  variant?: "search" | "account";
  mode: Mode;
  items: QueueItem[];
  savedCount: number;
  onRunAiScoring: () => Promise<AiScoreRunResult>;
}) {
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");
  const [message, setMessage] = useState("使用 GPT-5.5 判断信号价值。需要先在设置页保存 codeproxy 密钥。");
  const limitCount = Math.min(items.length, AI_SCORE_LIMIT);
  const scoredItems = items
    .map((item) => ({ item, aiScore: (item as QueueItem & { aiScore?: AiScore }).aiScore }))
    .filter((entry): entry is { item: QueueItem; aiScore: AiScore } => Boolean(entry.aiScore))
    .slice(0, AI_SCORE_LIMIT);
  const hasScoreResults = scoredItems.length > 0;

  async function runScoring() {
    setState("loading");
    setMessage(`正在对前 ${limitCount} 条信号做 AI 语义评分...`);

    try {
      const result = await onRunAiScoring();
      setState("idle");
      const successMessage = `已用 ${result.model} 完成 ${result.count} 条 AI 语义评分，分数已保存到本地。`;
      setMessage(successMessage);
      showToast(successMessage, "success");
    } catch (error) {
      setState("error");
      const errorMessage = formatActionError(error, "AI 评分失败，已保留本地规则评分。");
      setMessage(errorMessage);
      showToast(errorMessage, "error");
    }
  }

  return (
    <Card className="fade-up delay-4 overflow-hidden border border-white/[0.08] bg-white/[0.03] text-white shadow-2xl shadow-indigo-500/5 backdrop-blur-md">
      <CardHeader className="flex-row items-start justify-between gap-3 space-y-0 border-b border-white/[0.08] bg-[#0d0d10]/70">
        <div>
          <Badge variant="outline" className="rounded-md border-indigo-300/20 bg-indigo-400/10 text-indigo-200">
            <Sparkles className="mr-1 h-3.5 w-3.5" /> AI 语义评分
          </Badge>
          <CardTitle className="mt-3 text-xl text-white">LLM 评分器</CardTitle>
          <CardDescription className="mt-2 text-white/60">
            {mode === "outbound" ? "判断线索购买意向、痛点强度和触达价值。" : "判断讨论是否值得回复、引用或沉淀成内容。"}
          </CardDescription>
        </div>
        <div className="grid h-11 w-11 place-items-center rounded-md border border-white/[0.08] bg-white/[0.03] text-white/80">
          <Gauge className="h-5 w-5" />
        </div>
      </CardHeader>
      <CardContent className="grid gap-4 p-4 sm:grid-cols-[220px_minmax(0,1fr)]">
        <div className="grid content-start gap-3">
          <Button className="tech-cta" onClick={() => void runScoring()} disabled={state === "loading" || limitCount === 0}>
            <Sparkles className="h-4 w-4" /> {state === "loading" ? "评分中" : "AI 重新评分"}
          </Button>
          <Button asChild variant="outline" className="tech-secondary">
            <Link href="/settings">
              <Settings className="h-4 w-4" /> 配置 GPT-5.5
            </Link>
          </Button>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="rounded-md border border-white/[0.08] bg-white/[0.03] p-2 text-white/65">
              <p>本次最多</p>
              <p className="mt-1 text-lg font-black text-white">{limitCount}</p>
            </div>
            <div className="rounded-md border border-white/[0.08] bg-white/[0.03] p-2 text-white/65">
              <p>已保存</p>
              <p className="mt-1 text-lg font-black text-white">{savedCount}</p>
            </div>
          </div>
        </div>
        <div className="grid gap-3">
          <p className={cn("rounded-md border px-3 py-2 text-xs leading-5", state === "error" ? "border-rose-400/20 bg-rose-500/10 text-rose-200" : "border-white/[0.08] bg-white/[0.03] text-white/55")}>{message}</p>
          <div className="rounded-lg border border-white/[0.08] bg-[#0a0b0e]/65 p-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-white/35">刚刚的 AI 评分结果</p>
                <p className="mt-1 text-xs text-white/45">也会同步体现在上方执行队列的排序和分数里。</p>
              </div>
              <Badge variant="outline" className="shrink-0 rounded-md border-blue-300/15 bg-blue-400/10 text-blue-100">{scoredItems.length} 条</Badge>
            </div>
            <div className="mt-3 grid gap-2">
              {hasScoreResults ? scoredItems.map(({ item, aiScore }, index) => (
                <div key={`${aiScore.itemId}-${index}`} className="rounded-md border border-white/[0.06] bg-white/[0.025] p-3 transition-colors duration-200 hover:border-blue-300/20 hover:bg-blue-400/[0.04]">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold text-white">{item.name}</p>
                      <p className="mt-1 line-clamp-2 text-xs leading-5 text-white/50">{item.note}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <Badge variant={scoreVariant(aiScore.label)} className="rounded-md">{aiScore.score} 分</Badge>
                      <span className="rounded-md border border-white/[0.08] bg-white/[0.03] px-2 py-1 text-xs font-semibold text-white/65">{aiScore.label}</span>
                    </div>
                  </div>
                  <div className="mt-3 grid gap-2 rounded-md border border-white/[0.05] bg-black/15 p-2 text-xs leading-5 text-white/55 sm:grid-cols-2">
                    <p><span className="text-white/35">推荐动作：</span>{aiScore.recommendedAction || itemAction(item)}</p>
                    <p><span className="text-white/35">角度：</span>{aiScore.suggestedAngle || "暂无"}</p>
                  </div>
                  {aiScore.reason ? <p className="mt-2 text-xs leading-5 text-white/45">{aiScore.reason}</p> : null}
                </div>
              )) : (
                <div className="rounded-md border border-white/[0.06] bg-white/[0.02] p-3 text-xs leading-5 text-white/45">
                  运行 AI 重新评分后，这里会直接显示每条结果的 AI 分数、推荐动作和判断原因。
                </div>
              )}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
function AiDraftPanel({
  mode,
  items,
  savedCount,
  styleSampleCount,
  onRunAiDrafting,
}: {
  variant?: "search" | "account";
  mode: Mode;
  items: QueueItem[];
  savedCount: number;
  styleSampleCount: number;
  onRunAiDrafting: () => Promise<AiDraftRunResult>;
}) {
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");
  const [message, setMessage] = useState("基于当前队列、账号定位和历史正反馈话术生成更像 Ray 的回复草稿。需要先在设置页保存 GPT-5.5 / codeproxy 密钥。");
  const limitCount = Math.min(items.length, AI_DRAFT_LIMIT);

  async function runDrafting() {
    setState("loading");
    setMessage(`正在为前 ${limitCount} 条信号生成 AI 草稿...`);

    try {
      const result = await onRunAiDrafting();
      setState("idle");
      const successMessage = result.failedCount ? `已生成 ${result.count} 组 AI 草稿，${result.failedCount} 条未成功。成功结果已保存到本地。` : `已用 ${result.model} 生成 ${result.count} 组 AI 草稿，已保存到本地并覆盖队列展示。`;
      setMessage(successMessage);
      showToast(successMessage, "success");
    } catch (error) {
      setState("error");
      const errorMessage = formatActionError(error, "AI 草稿生成失败，已保留本地规则草稿。");
      setMessage(errorMessage);
      showToast(errorMessage, "error");
    }
  }

  return (
    <Card className="fade-up delay-4 overflow-hidden border border-blue-400/15 bg-blue-400/[0.035] text-white shadow-2xl shadow-blue-500/5 backdrop-blur-md">
      <CardHeader className="flex-row items-start justify-between gap-3 space-y-0 border-b border-white/[0.08] bg-[#0d0d10]/70">
        <div>
          <Badge variant="outline" className="rounded-md border-blue-300/20 bg-blue-400/10 text-blue-200">
            <Bot className="mr-1 h-3.5 w-3.5" /> AI 草稿生成
          </Badge>
          <CardTitle className="mt-3 text-xl text-white">LLM 草稿生成器</CardTitle>
          <CardDescription className="mt-2 text-white/60">
            {mode === "outbound" ? "为主动触达线索生成更自然的首轮私信/评论草稿。" : "为增长信号生成回复、引用和后续选题草稿。"}
          </CardDescription>
        </div>
        <div className="grid h-11 w-11 place-items-center rounded-md border border-white/[0.08] bg-white/[0.03] text-white/80">
          <MessageSquareText className="h-5 w-5" />
        </div>
      </CardHeader>
      <CardContent className="grid gap-4 p-4 sm:grid-cols-[220px_minmax(0,1fr)]">
        <div className="grid content-start gap-3">
          <Button className="tech-cta" onClick={() => void runDrafting()} disabled={state === "loading" || limitCount === 0}>
            {state === "loading" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />} {state === "loading" ? "生成中" : "AI 生成草稿"}
          </Button>
          <Button asChild variant="outline" className="tech-secondary">
            <Link href="/settings">
              <Settings className="h-4 w-4" /> 配置 GPT-5.5
            </Link>
          </Button>
          <div className="grid grid-cols-3 gap-2 text-xs">
            <div className="rounded-md border border-white/[0.08] bg-white/[0.03] p-2 text-white/65">
              <p>本次最多</p>
              <p className="mt-1 text-lg font-black text-white">{limitCount}</p>
            </div>
            <div className="rounded-md border border-white/[0.08] bg-white/[0.03] p-2 text-white/65">
              <p>已保存</p>
              <p className="mt-1 text-lg font-black text-white">{savedCount}</p>
            </div>
            <div className="rounded-md border border-white/[0.08] bg-white/[0.03] p-2 text-white/65">
              <p>风格样本</p>
              <p className="mt-1 text-lg font-black text-blue-200">{styleSampleCount}</p>
            </div>
          </div>
        </div>
        <p className={cn("rounded-md border px-3 py-2 text-xs leading-5", state === "error" ? "border-rose-400/20 bg-rose-500/10 text-rose-200" : "border-white/[0.08] bg-white/[0.03] text-white/55")}>{message}</p>

      </CardContent>
    </Card>
  );
}
function WorkbenchBackupPanel({
  exportBackup,
  restoreBackupText,
}: {
  exportBackup: () => void;
  restoreBackupText: (rawText: string) => { ok: boolean; message: string };
}) {
  const [message, setMessage] = useState("导出 JSON 可以备份当前本地数据；恢复时会覆盖当前浏览器里的工作台状态。");
  const [state, setState] = useState<"idle" | "error">("idle");

  async function restoreFromFile(file: File | undefined) {
    if (!file) return;
    try {
      const result = restoreBackupText(await file.text());
      setState(result.ok ? "idle" : "error");
      setMessage(result.message);
      showToast(result.message, result.ok ? "success" : "error");
    } catch {
      setState("error");
      setMessage("读取备份文件失败，请确认文件可以被浏览器读取。");
      showToast("读取备份文件失败，请确认文件可以被浏览器读取。", "error");
    }
  }

  return (
    <details className="rounded-lg border border-white/[0.08] bg-white/[0.025] text-white backdrop-blur-md">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-semibold text-white/70 transition-colors hover:bg-white/[0.035] hover:text-white">
        <span className="inline-flex items-center gap-2"><Download className="h-4 w-4" /> 本地数据备份</span>
        <span className="text-xs font-normal text-white/35">低频工具</span>
      </summary>
      <div className="grid gap-3 border-t border-white/[0.08] p-4 sm:grid-cols-[220px_minmax(0,1fr)]">
        <div className="grid content-start gap-3">
          <Button className="tech-cta" onClick={exportBackup}>
            <Download className="h-4 w-4" /> 导出备份
          </Button>
          <Input
            type="file"
            accept="application/json,.json"
            onChange={(event) => {
              void restoreFromFile(event.currentTarget.files?.[0]);
              event.currentTarget.value = "";
            }}
            className="border-white/[0.08] bg-white/[0.04] text-white file:text-white"
          />
        </div>
        <p className={cn("rounded-md border px-3 py-2 text-xs leading-5", state === "error" ? "border-rose-400/20 bg-rose-500/10 text-rose-200" : "border-white/[0.08] bg-white/[0.03] text-white/55")}>{message}</p>
      </div>
    </details>
  );
}

function GrokBridgePanel({
  variant = "search",
  mode,
  current,
  updateField,
  grokBridge,
  setGrokBridge,
  modeSignals,
  setModeSignals,
  growthMemory,
}: {
  variant?: "search" | "account";
  mode: Mode;
  current: FormState;
  updateField: (field: keyof FormState, value: string) => void;
  grokBridge: GrokBridgeState;
  setGrokBridge: Dispatch<SetStateAction<GrokBridgeState>>;
  modeSignals: Signal[];
  setModeSignals: (signals: Signal[]) => void;
  growthMemory: GrowthMemoryState;
}) {
  const { locale } = useI18n();
  const tr = (zh: string, en: string) => (locale === "en" ? en : zh);
  const { keywords, grokResult, accountResult, xProfileUrl } = grokBridge;
  const isAccountRadar = variant === "account";
  const activeResult = isAccountRadar ? accountResult : grokResult;
  const activeResultField: keyof GrokBridgeState = isAccountRadar ? "accountResult" : "grokResult";
  const [bridgeMessage, setBridgeMessage] = useState(isAccountRadar ? "输入竞品、KOL、社区账号或高价值目标用户账号，竞品洞察会对比定位、分析受众并生成可导入的互动线索。" : "按左侧定位生成 Grok 搜索指令，找到公开讨论后导入互动队列。");
  const [bridgeState, setBridgeState] = useState<"idle" | "loading" | "error">("idle");
  const [isProxyConfigReady, setIsProxyConfigReady] = useState(false);
  const [proxyConfig, setProxyConfig] = useState<GrokProxyConfig>(() => normalizeGrokProxyConfig({}) as GrokProxyConfig);
  const [proxySearchResult, setProxySearchResult] = useState<GrokProxySearchResult | null>(null);
  const [resultPreviewPage, setResultPreviewPage] = useState(1);
  const [bridgeDiagnosticId, setBridgeDiagnosticId] = useState<number | null>(null);
  const [isPromptOpen, setIsPromptOpen] = useState(false);
  const autoKeywords = useMemo(() => deriveGrokKeywords(current), [current]);
  const editableKeywords = keywords.trim() === LEGACY_DEFAULT_KEYWORDS ? "" : keywords;
  const manualKeywords = editableKeywords.trim();
  const memoryKeywords = growthMemoryKeywordText(growthMemory);
  const effectiveKeywords = [manualKeywords || autoKeywords, memoryKeywords].filter(Boolean).join(", ");
  const memoryPromptContext = buildGrowthMemoryPromptContext(growthMemory, locale);
  const ownAccountIdentity = useMemo(() => buildOwnAccountIdentity(current, loadXProfileConfig().profileUrl), [current]);

  function updateGrokBridgeField(field: keyof GrokBridgeState, value: string) {
    setGrokBridge((previous) => ({
      ...previous,
      [field]: value,
    }));
  }

  function showProxyFailure(data: GrokProxyApiResponse, fallback: string, title: string) {
    const message = grokFailureMessage(data, fallback, locale);
    setBridgeState("error");
    setProxySearchResult(null);
    setBridgeDiagnosticId(data.diagnosticId ?? null);
    setBridgeMessage(message);
    showToast({ title, message, tone: "error", durationMs: 7000 });
  }

  function loadProxyConfig() {
    try {
      const stored = window.localStorage.getItem(GROK_PROXY_CONFIG_STORAGE_KEY);
      const config = normalizeGrokProxyConfig(stored ? JSON.parse(stored) : {}) as GrokProxyConfig;
      setProxyConfig(config);
      return config;
    } catch {
      const fallback = normalizeGrokProxyConfig({}) as GrokProxyConfig;
      setProxyConfig(fallback);
      return fallback;
    } finally {
      setIsProxyConfigReady(true);
    }
  }

  useEffect(() => {
    loadProxyConfig();
    const handleFocus = () => loadProxyConfig();
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") loadProxyConfig();
    };
    const handleStorage = (event: StorageEvent) => {
      if (event.key === GROK_PROXY_CONFIG_STORAGE_KEY) loadProxyConfig();
    };

    window.addEventListener("focus", handleFocus);
    window.addEventListener("storage", handleStorage);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.removeEventListener("focus", handleFocus);
      window.removeEventListener("storage", handleStorage);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  const prompt = useMemo(() => {
    const basePrompt = buildGrokSearchPrompt({
      mode,
      locale,
      name: current.productName,
      description: current.description,
      targetCustomer: current.targetCustomer,
      goalsOrCompetitors: current.competitors,
      pillarsOrPainPoints: current.painPoints,
      keywords: effectiveKeywords,
    });

    const promptWithOwnFilter = basePrompt + ownAccountExclusionText(ownAccountIdentity, locale);
    const memoryTitle = locale === "en" ? "Previous growth learning (use only as a prioritization hint):" : "上一轮增长记忆（仅用作优先级参考）：";
    return memoryPromptContext ? promptWithOwnFilter + "\n\n" + memoryTitle + "\n" + memoryPromptContext : promptWithOwnFilter;
  }, [current, effectiveKeywords, locale, memoryPromptContext, mode, ownAccountIdentity]);

  const existingSignals = useMemo(() => {
    const manualSignals = parseSignalsFromText(current.leadInput, { source: "manual" }) as Signal[];
    return mergeSignals(modeSignals, manualSignals).signals as Signal[];
  }, [current.leadInput, modeSignals]);

  const grokCandidates = useMemo(() => {
    if (proxySearchResult?.signals.length) return proxySearchResult.signals;
    return parseSignalsFromText(activeResult, { source: "grok" }) as Signal[];
  }, [activeResult, proxySearchResult]);

  const filteredGrokCandidates = useMemo(() => partitionOwnSignals(grokCandidates, ownAccountIdentity), [grokCandidates, ownAccountIdentity]);
  const importableGrokCandidates = filteredGrokCandidates.included;
  const excludedOwnGrokCandidates = filteredGrokCandidates.excludedOwn;
  const importPreview = useMemo(
    () => createSignalPreviewFromCandidates(importableGrokCandidates, existingSignals, excludedOwnGrokCandidates),
    [existingSignals, excludedOwnGrokCandidates, importableGrokCandidates]
  );

  const hasProxyKey = proxyConfig.apiKey.trim().length > 0;
  const effectiveProxyModel = proxyConfig.model.trim() || DEFAULT_GROK_PROXY_MODEL;
  const resultPreviewLines = useMemo(
    () =>
      (proxySearchResult?.text ?? "")
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .slice(0, 4),
    [proxySearchResult]
  );
  const resultPreviewPageSize = 4;
  const resultPreviewPageCount = Math.max(1, Math.ceil(importableGrokCandidates.length / resultPreviewPageSize));
  const safeResultPreviewPage = Math.min(resultPreviewPage, resultPreviewPageCount);
  const resultPreviewStart = (safeResultPreviewPage - 1) * resultPreviewPageSize;
  const resultPreviewEnd = Math.min(resultPreviewStart + resultPreviewPageSize, importableGrokCandidates.length);
  const resultPreviewDisplayStart = importableGrokCandidates.length > 0 ? resultPreviewStart + 1 : 0;
  const resultPreviewSignals = useMemo(
    () => importableGrokCandidates.slice(resultPreviewStart, resultPreviewEnd),
    [importableGrokCandidates, resultPreviewEnd, resultPreviewStart]
  );
  const pulledProfilePreviewLines = useMemo(
    () =>
      (proxySearchResult?.pulledProfile?.preview ?? "")
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .slice(0, 6),
    [proxySearchResult]
  );

  function openGrok(copyPromptFirst: boolean) {
    if (copyPromptFirst) copyText(prompt);
    window.open("https://grok.com/", "_blank", "noopener,noreferrer");
    setBridgeState("idle");
    setProxySearchResult(null);
    setBridgeMessage(copyPromptFirst ? "已复制 Grok Prompt，并打开 Grok。请粘贴搜索，生成后把结果复制回页面导入互动队列。" : "已打开 Grok。手动流程不会读取浏览器 token/cookie。");
  }

  async function pullXProfileViaProxy() {
    const latestConfig = loadProxyConfig();
    const apiKey = latestConfig.apiKey.trim();
    const profileUrl = xProfileUrl.trim();
    if (!apiKey) {
      showProxyFailure(
        { message: tr("没有配置 codeproxy / Grok 密钥。", "No codeproxy / Grok API key is configured."), suggestion: tr("请先到设置页面保存密钥。", "Save an API key on the settings page first.") },
        tr("竞品洞察无法启动。", "Competitor insights could not start."),
        tr("竞品洞察失败", "Competitor insight failed")
      );
      return;
    }
    if (!profileUrl) {
      showProxyFailure(
        { message: tr("没有填写要分析的 X 账号。", "No X account was provided."), suggestion: tr("请填写竞品、KOL 或目标用户主页，例如 https://x.com/competitor。", "Enter a competitor, KOL, or target-user profile, such as https://x.com/competitor.") },
        tr("竞品洞察无法启动。", "Competitor insights could not start."),
        tr("竞品洞察失败", "Competitor insight failed")
      );
      return;
    }

    setBridgeState("loading");
    setProxySearchResult(null);
    setResultPreviewPage(1);
    setBridgeDiagnosticId(null);
    setBridgeMessage("正在分析公开 X 账号，围绕它的受众、评论区和相关讨论生成可互动线索。只会处理公开数据，不会读取私信或后台数据。");

    try {
      const response = await fetch("/api/grok", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "profile-pull",
          apiKey,
          model: latestConfig.model,
          endpoint: latestConfig.endpoint,
          locale,
          prompt,
          profileUrl,
        }),
      });
      const data = (await response.json().catch(() => ({ message: "竞品洞察分析失败。" }))) as GrokProxyApiResponse;

      if (!response.ok || !data.ok || !data.text) {
        showProxyFailure(data, tr("竞品洞察分析失败。", "Competitor insight analysis failed."), tr("竞品洞察失败", "Competitor insight failed"));
        return;
      }

      const structuredSignals = Array.isArray(data.signals) ? data.signals : [];
      if (structuredSignals.length === 0) {
        showProxyFailure(
          {
            ...data,
            message: tr("Grok 返回了内容，但没有解析出任何可导入线索。", "Grok returned content, but no importable signals were parsed."),
            technicalMessage: data.parseError || data.technicalMessage,
            suggestion: data.suggestion || tr("请根据日志查看原始响应，并重新查询。", "Review the raw response in the log and retry."),
          },
          tr("竞品洞察没有生成可导入线索。", "Competitor insights produced no importable signals."),
          tr("竞品洞察失败", "Competitor insight failed")
        );
        return;
      }
      updateGrokBridgeField("accountResult", data.text);
      setProxySearchResult({
        text: data.text,
        model: data.model || latestConfig.model || DEFAULT_GROK_PROXY_MODEL,
        structured: Boolean(data.structured && structuredSignals.length > 0),
        signals: structuredSignals,
        rawText: data.rawText,
        parseError: data.parseError,
        pulledProfile: data.pulledProfile ?? null,
        accountRadar: data.accountRadar ?? null,
      });
      const pulledProfile = data.pulledProfile;
      const sourceCount = pulledProfile?.sources?.length ?? 0;
      const usernameLabel = pulledProfile?.username ? ` @${pulledProfile.username}` : "";
      const warningLabel = pulledProfile?.warnings?.length ? ` 有 ${pulledProfile.warnings.length} 个公开数据源未成功，不影响已拿到的数据。` : "";
      setBridgeState("idle");
      setBridgeDiagnosticId(null);
      const successMessage = `竞品洞察已分析${usernameLabel}，并生成可导入的互动线索。${sourceCount ? `读取 ${sourceCount} 个公开数据源。` : ""}请确认预览结果，再导入互动队列。${warningLabel}`;
      setBridgeMessage(successMessage);
      showToast(tr(`竞品洞察分析完成，已解析 ${structuredSignals.length} 条线索。`, `Competitor insight complete with ${structuredSignals.length} parsed signals.`), "success");
    } catch (error) {
      const technicalMessage = error instanceof Error ? `${error.name}: ${error.message}` : String(error || "Unknown browser error");
      showProxyFailure(
        {
          message: tr("页面无法连接本机 Grok 接口。", "The page could not reach the local Grok API."),
          technicalMessage,
          suggestion: tr("请确认本地服务仍在运行，然后重试。此错误发生在浏览器到本机服务之间，因此没有服务端日志编号。", "Confirm the local service is still running and retry. This failed before reaching the server, so there is no server log ID."),
        },
        tr("竞品洞察分析失败。", "Competitor insight analysis failed."),
        tr("竞品洞察失败", "Competitor insight failed")
      );
    }
  }
  async function searchViaProxy() {
    const latestConfig = loadProxyConfig();
    const apiKey = latestConfig.apiKey.trim();
    if (!apiKey) {
      showProxyFailure(
        { message: tr("没有配置 codeproxy / Grok 密钥。", "No codeproxy / Grok API key is configured."), suggestion: tr("请先到设置页面保存密钥。", "Save an API key on the settings page first.") },
        tr("自动查询无法启动。", "The automatic query could not start."),
        tr("自动查询失败", "Automatic query failed")
      );
      return;
    }

    setBridgeState("loading");
    setProxySearchResult(null);
    setResultPreviewPage(1);
    setBridgeDiagnosticId(null);
    setBridgeMessage("Grok 查询中，请稍等。正在通过已配置的 Grok 接口获取候选信号。");

    try {
      const response = await fetch("/api/grok", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "proxy-search",
          apiKey,
          model: latestConfig.model,
          endpoint: latestConfig.endpoint,
          locale,
          prompt,
        }),
      });
      const data = (await response.json().catch(() => ({ message: "中转查询失败。" }))) as GrokProxyApiResponse;

      if (!response.ok || !data.ok || !data.text) {
        showProxyFailure(data, tr("中转查询失败。", "The proxy query failed."), tr("自动查询失败", "Automatic query failed"));
        return;
      }

      const structuredSignals = Array.isArray(data.signals) ? data.signals : [];
      if (structuredSignals.length === 0) {
        showProxyFailure(
          {
            ...data,
            message: tr("Grok 返回了内容，但没有解析出任何可导入线索。", "Grok returned content, but no importable signals were parsed."),
            technicalMessage: data.parseError || data.technicalMessage,
            suggestion: data.suggestion || tr("请根据日志查看原始响应，并重新查询。", "Review the raw response in the log and retry."),
          },
          tr("自动查询没有生成可导入线索。", "The automatic query produced no importable signals."),
          tr("自动查询失败", "Automatic query failed")
        );
        return;
      }
      updateGrokBridgeField("grokResult", data.text);
      setProxySearchResult({
        text: data.text,
        model: data.model || latestConfig.model || DEFAULT_GROK_PROXY_MODEL,
        structured: Boolean(data.structured && structuredSignals.length > 0),
        signals: structuredSignals,
        rawText: data.rawText,
        parseError: data.parseError,
        pulledProfile: data.pulledProfile ?? null,
        accountRadar: data.accountRadar ?? null,
      });
      setBridgeState("idle");
      setBridgeDiagnosticId(null);
      setBridgeMessage(tr(`查询完成，已解析 ${structuredSignals.length} 条候选线索。请确认后再导入互动队列。`, `Query complete with ${structuredSignals.length} parsed signals. Review them before importing.`));
      showToast(tr(`Grok 查询完成，已解析 ${structuredSignals.length} 条线索。`, `Grok query complete with ${structuredSignals.length} parsed signals.`), "success");
    } catch (error) {
      const technicalMessage = error instanceof Error ? `${error.name}: ${error.message}` : String(error || "Unknown browser error");
      showProxyFailure(
        {
          message: tr("页面无法连接本机 Grok 接口。", "The page could not reach the local Grok API."),
          technicalMessage,
          suggestion: tr("请确认本地服务仍在运行，然后重试。此错误发生在浏览器到本机服务之间，因此没有服务端日志编号。", "Confirm the local service is still running and retry. This failed before reaching the server, so there is no server log ID."),
        },
        tr("中转查询失败。", "The proxy query failed."),
        tr("自动查询失败", "Automatic query failed")
      );
    }
  }

  function importGrokResult() {
    const candidates = importableGrokCandidates;
    const originalCount = grokCandidates.length;
    if (originalCount > 0 && candidates.length === 0 && excludedOwnGrokCandidates.length > 0) {
      setBridgeState("error");
      setBridgeMessage("这批结果主要来自你自己的账号，已全部排除。建议换竞品/KOL账号，或让 Grok 明确搜索外部目标用户。");
      showToast("已排除自己的账号结果，没有可导入线索。", "info");
      return;
    }
    if (candidates.length === 0) {
      setBridgeState("error");
      setBridgeMessage("没有解析到可导入的结果。建议让 Grok 按「X | 作者 | 链接 | 原帖语言代码 | 保留原语言的精简原文」格式返回，每条一行。");
      showToast(tr("没有解析到可导入结果，未执行导入。", "No importable results were parsed, so nothing was imported."), "error");
      return;
    }

    const merged = mergeSignals(existingSignals, candidates) as { signals: Signal[]; imported: Signal[]; updated: Signal[]; duplicates: Signal[] };
    setModeSignals(merged.signals);
    if (merged.imported.length > 0 || merged.updated.length > 0) {
      updateField("leadInput", formatSignalsAsLeadInput(merged.signals));
    }

    setProxySearchResult(null);
    setBridgeState("idle");
    const excludedLabel = excludedOwnGrokCandidates.length ? "，排除自己账号 " + excludedOwnGrokCandidates.length + " 条" : "";
    const importMessage = "已解析 " + originalCount + " 条结果，新增 " + merged.imported.length + " 条，更新旧记录 " + merged.updated.length + " 条，跳过重复 " + merged.duplicates.length + " 条" + excludedLabel + "。互动队列会自动更新。";
    setBridgeMessage(importMessage);
    showToast(importMessage, merged.imported.length > 0 ? "success" : "info");
  }

  return (
    <>
      {isAccountRadar && bridgeState === "loading" ? (
        <LongTaskOverlay
          title={tr("AI 正在分析目标账号", "AI is analyzing the target account")}
          message={tr("正在读取公开资料、比较定位与受众，并生成可互动线索。", "Reading public context, comparing positioning and audience, and generating engagement signals.")}
          detail={tr("分析完成后结果会显示在当前页面，请稍候。", "The results will appear on this page when the analysis is complete.")}
        />
      ) : null}
      <Card className="fade-up delay-4 overflow-hidden border border-white/[0.08] bg-white/[0.03] text-white shadow-2xl shadow-blue-500/5 backdrop-blur-md">
      <CardHeader className="flex-row items-start justify-between gap-3 space-y-0 border-b border-white/[0.08] bg-[#0d0d10]/70">
        <div>
          <Badge variant="outline" className="rounded-md border-blue-300/20 bg-blue-400/10 text-blue-100">
            {isAccountRadar ? <Radar className="mr-1 h-3.5 w-3.5" /> : <Sparkles className="mr-1 h-3.5 w-3.5" />} {isAccountRadar ? tr("竞品洞察", "Competitor insights") : tr("Grok 找讨论", "Discover with Grok")}
          </Badge>
          <CardTitle className="mt-3 text-xl text-white">{isAccountRadar ? tr("从竞品/KOL账号挖线索", "Discover leads around competitors and KOLs") : tr("用 Grok 找目标用户", "Find target users with Grok")}</CardTitle>
          <CardDescription className="mt-2 text-white/60">{isAccountRadar ? tr("单独输入一个公开 X 账号，围绕它的受众和讨论生成可导入的互动线索。", "Analyze one public X account to discover importable signals around its audience and discussions.") : tr("按定位生成 Prompt，去 Grok 找公开讨论；找到结果后导入互动队列。", "Generate a prompt from positioning, discover public discussions on Grok, then import the results into the queue.")}</CardDescription>
        </div>
        <div className="grid h-11 w-11 place-items-center rounded-md border border-white/[0.08] bg-white/[0.03] text-white/80">
          <Radar className="h-5 w-5" />
        </div>
      </CardHeader>

      <CardContent className="grid gap-4 p-4 sm:p-5">
        {isAccountRadar ? (
          <section className="grid gap-3 rounded-lg border border-emerald-300/15 bg-emerald-400/[0.045] p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <Badge variant="outline" className="rounded-md border-emerald-300/20 bg-emerald-400/10 text-emerald-100">{tr("竞品洞察", "Competitor insights")}</Badge>
                <h3 className="mt-3 text-lg font-bold text-white">{tr("看定位差异，再从竞品受众中找机会", "Compare positioning, then discover opportunities in the audience")}</h3>
                <p className="mt-2 text-sm leading-6 text-white/60">{tr("输入竞品、行业 KOL、社区账号或目标用户账号，对比定位、受众重叠和机会空白，再生成可互动线索。", "Enter a competitor, KOL, community, or target-user account. Compare positioning, audience overlap, and opportunity gaps, then generate signals worth engaging.")}</p>
              </div>
              <Radar className="mt-1 h-5 w-5 shrink-0 text-emerald-100/80" />
            </div>
            <div className="grid gap-2 lg:grid-cols-[minmax(0,1fr)_240px] lg:items-center">
              <Input
                value={xProfileUrl}
                onChange={(event) => updateGrokBridgeField("xProfileUrl", event.target.value)}
                placeholder="https://x.com/competitor_or_kol"
                className="h-10 border-white/[0.08] bg-white/[0.04] text-white placeholder:text-white/35"
              />
              <Button type="button" className="tech-cta h-10" onClick={() => void pullXProfileViaProxy()} disabled={bridgeState === "loading"}>
                {bridgeState === "loading" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                {tr("分析账号并生成线索", "Analyze account and generate signals")}
              </Button>
            </div>
            <p className="text-xs leading-5 text-white/40">{tr("这是主流程之外的可选洞察工具：先看定位和受众差异，再从竞品、KOL 或社区账号周围挖出今天值得互动的人。", "This optional insight tool compares positioning and audience before discovering people around a competitor, KOL, or community account who are worth engaging today.")}</p>
            <AccountRadarOpportunityPanel current={current} profileUrl={xProfileUrl} pulledProfile={proxySearchResult?.pulledProfile ?? null} insight={proxySearchResult?.accountRadar ?? null} />
            {proxySearchResult?.pulledProfile ? (
              <div className="rounded-md border border-emerald-300/15 bg-[#0d0d10]/50 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline" className="rounded-md border-emerald-300/20 bg-emerald-400/10 text-emerald-100">竞品洞察已完成</Badge>
                  {proxySearchResult.pulledProfile.username ? <span className="font-mono text-xs text-white/65">@{proxySearchResult.pulledProfile.username}</span> : null}
                  {typeof proxySearchResult.pulledProfile.textLength === "number" ? <span className="text-xs text-white/40">公开资料 {proxySearchResult.pulledProfile.textLength} 字，已用于挖线索</span> : null}
                </div>
                <p className="mt-2 text-xs leading-5 text-emerald-50/65">这些公开资料已经参与竞品洞察；下面候选结果会变成可评分、可生成回复、可追踪反馈的互动队列。</p>
                {pulledProfilePreviewLines.length > 0 ? (
                  <div className="mt-2 grid gap-1.5">
                    {pulledProfilePreviewLines.map((line, index) => (
                      <p key={`${line}-${index}`} className="line-clamp-2 rounded-md border border-white/[0.06] bg-white/[0.035] px-2.5 py-1.5 text-xs leading-5 text-white/55">{line}</p>
                    ))}
                  </div>
                ) : null}
                {(proxySearchResult.pulledProfile.sources?.length ?? 0) > 0 ? (
                  <p className="mt-2 text-xs text-white/35">公开来源：{proxySearchResult.pulledProfile.sources?.join("、")}</p>
                ) : null}
                {(proxySearchResult.pulledProfile.warnings?.length ?? 0) > 0 ? (
                  <p className="mt-1 text-xs text-amber-200/70">部分公开数据源读取失败，但已使用能读取到的资料继续分析。</p>
                ) : null}
              </div>
            ) : null}
          </section>
        ) : (
          <section className="grid gap-4 rounded-lg border border-white/[0.08] bg-white/[0.02] p-4">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <Badge variant="outline" className="rounded-md border-blue-300/20 bg-blue-400/10 text-blue-100">{tr("选择执行方式", "Choose a workflow")}</Badge>
                <h3 className="mt-3 text-lg font-bold text-white">{tr("手动搜索，或让工作台自动查询", "Search manually or let the workbench query automatically")}</h3>
                <p className="mt-2 text-sm leading-6 text-white/55">{tr("两种方式使用同一份定位和 Prompt，结果最终都会导入互动队列。", "Both paths use the same positioning and prompt. Results end up in the same engagement queue.")}</p>
              </div>
              <span className="text-xs text-white/35">{tr("任选一种即可", "Use either path")}</span>
            </div>

            <div className="grid gap-3 lg:grid-cols-2">
              <div className="flex min-h-[230px] flex-col rounded-lg border border-blue-300/20 bg-blue-400/[0.055] p-4 shadow-lg shadow-blue-950/10">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <Badge variant="outline" className="rounded-md border-blue-300/20 bg-blue-400/10 text-blue-100">{tr("方式 1 · 手动", "Path 1 · Manual")}</Badge>
                    <h4 className="mt-3 font-bold text-white">{tr("在 Grok 页面手动搜索", "Search on the Grok page")}</h4>
                  </div>
                  <Copy className="h-5 w-5 shrink-0 text-blue-100/75" />
                </div>
                <p className="mt-2 text-sm leading-6 text-white/55">{tr("适合先试流程，或者暂时不配置中转密钥。你需要把 Grok 返回结果复制回工作台。", "Good for trying the workflow or when you do not want to configure a proxy key. Copy Grok's result back into the workbench.")}</p>
                <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[11px] font-semibold text-blue-100/65">
                  <span className="rounded-md bg-white/[0.05] px-2 py-1">{tr("1 复制 Prompt", "1 Copy prompt")}</span>
                  <ArrowRight className="h-3 w-3 text-white/25" />
                  <span className="rounded-md bg-white/[0.05] px-2 py-1">{tr("2 打开 Grok", "2 Open Grok")}</span>
                  <ArrowRight className="h-3 w-3 text-white/25" />
                  <span className="rounded-md bg-white/[0.05] px-2 py-1">{tr("3 粘贴结果", "3 Paste results")}</span>
                </div>
                <Button type="button" variant="outline" className="tech-secondary mt-auto w-full justify-center" onClick={() => openGrok(true)} disabled={bridgeState === "loading"}>
                  <Copy className="h-4 w-4" /> {tr("复制 Prompt 并打开 Grok", "Copy prompt and open Grok")}
                </Button>
              </div>

              <div className="flex min-h-[230px] flex-col rounded-lg border border-emerald-300/20 bg-emerald-400/[0.055] p-4 shadow-lg shadow-emerald-950/10">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline" className="rounded-md border-emerald-300/20 bg-emerald-400/10 text-emerald-100">{tr("方式 2 · 自动", "Path 2 · Automatic")}</Badge>
                      <Badge variant="outline" className={cn("rounded-md", hasProxyKey ? "border-emerald-500/10 bg-emerald-500/10 text-emerald-300" : "border-amber-500/10 bg-amber-500/10 text-amber-300")}>
                        {isProxyConfigReady ? (hasProxyKey ? tr("中转已配置", "Proxy configured") : tr("需要配置密钥", "API key required")) : tr("读取配置中", "Loading settings")}
                      </Badge>
                    </div>
                    <h4 className="mt-3 font-bold text-white">{tr("通过中转一键查询", "Run a one-click proxy query")}</h4>
                  </div>
                  <Bot className="h-5 w-5 shrink-0 text-emerald-100/75" />
                </div>
                <p className="mt-2 text-sm leading-6 text-white/55">{tr("工作台自动提交当前 Prompt，并把返回内容解析成待确认线索；无需打开 Grok 页面来回复制。", "The workbench submits the current prompt and parses returned content into reviewable signals. No copy-paste from Grok is needed.")}</p>
                <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-white/40">
                  <span className="rounded-md bg-white/[0.05] px-2 py-1">{tr("自动查询", "Query")}</span>
                  <ArrowRight className="h-3 w-3 text-white/25" />
                  <span className="rounded-md bg-white/[0.05] px-2 py-1">{tr("确认结果", "Review")}</span>
                  <ArrowRight className="h-3 w-3 text-white/25" />
                  <span className="rounded-md bg-white/[0.05] px-2 py-1">{tr("导入队列", "Import")}</span>
                  <span className="ml-auto truncate font-mono">{effectiveProxyModel}</span>
                </div>
                <div className="mt-auto grid gap-2 sm:grid-cols-2">
                  <Button asChild variant="outline" className="tech-secondary">
                    <Link href="/settings">
                      <Settings className="h-4 w-4" /> {tr("配置中转", "Configure proxy")}
                    </Link>
                  </Button>
                  <Button type="button" className="tech-cta" onClick={() => void searchViaProxy()} disabled={bridgeState === "loading"}>
                    {bridgeState === "loading" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                    {bridgeState === "loading" ? tr("自动查询中", "Querying…") : tr("一键自动查询", "Run automatic query")}
                  </Button>
                </div>
              </div>
            </div>
          </section>
        )}
        {isAccountRadar ? (
          <div className="grid gap-3 rounded-lg border border-white/[0.08] bg-white/[0.03] p-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline" className={cn("rounded-md", hasProxyKey ? "border-emerald-500/10 bg-emerald-500/10 text-emerald-300" : "border-amber-500/10 bg-amber-500/10 text-amber-300")}>
                  {isProxyConfigReady ? (hasProxyKey ? "中转已配置" : "未配置中转密钥") : "读取配置中"}
                </Badge>
                <span className="truncate font-mono text-xs text-white/45">{effectiveProxyModel}</span>
              </div>
              <p className="mt-2 text-xs leading-5 text-white/45">密钥配置已移到独立设置页。竞品洞察会用它分析公开账号并生成线索。</p>
            </div>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-[auto]">
              <Button asChild variant="outline" className="tech-secondary">
                <Link href="/settings">
                  <Settings className="h-4 w-4" /> 配置中转
                </Link>
              </Button>
            </div>
          </div>
        ) : null}

        {bridgeState === "loading" ? (
          <div className="relative overflow-hidden rounded-lg border border-blue-400/15 bg-blue-400/[0.06] p-4 text-blue-50 shadow-2xl shadow-blue-500/5">
            <div className="relative flex items-start gap-3">
              <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-white/[0.08] bg-white/[0.04]">
                <Loader2 className="h-5 w-5 animate-spin text-blue-200" />
              </div>
              <div>
                <p className="font-semibold text-white">正在处理，请稍等...</p>
                <p className="mt-1 text-sm leading-6 text-white/55">{bridgeMessage || "正在通过 codeproxy.dev 中转查询中，请稍等。"}</p>
              </div>
            </div>
          </div>
        ) : null}

        {proxySearchResult && bridgeState !== "loading" ? (
          <div className="rounded-lg border border-emerald-400/15 bg-emerald-400/[0.06] p-4 shadow-2xl shadow-emerald-500/5">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline" className="rounded-md border-emerald-500/10 bg-emerald-500/10 text-emerald-300">{isAccountRadar ? "分析完成" : "查询完成"}</Badge>
                  <Badge variant="outline" className={cn("rounded-md", proxySearchResult.structured ? "border-blue-500/10 bg-blue-500/10 text-blue-200" : "border-amber-500/10 bg-amber-500/10 text-amber-200")}>
                    {proxySearchResult.structured ? "结构化结果" : "文本回退"}
                  </Badge>
                </div>
                <h3 className="mt-3 text-base font-bold text-white">{isAccountRadar ? "是否导入这批竞品洞察线索？" : "是否导入这批 Grok 结果？"}</h3>
                <p className="mt-1 text-sm leading-6 text-white/55">
                  {tr(
                    `模型：${proxySearchResult.model}。已解析 ${importPreview.parsedCount} 条，可新增 ${importPreview.importableCount} 条，可更新旧记录 ${importPreview.updatedCount} 条，重复 ${importPreview.duplicateCount} 条${importPreview.excludedOwnCount ? `，已排除自己账号 ${importPreview.excludedOwnCount} 条` : ""}。下方分页展示全部结果，当前 ${resultPreviewDisplayStart}-${resultPreviewEnd} 条。`,
                    `Model: ${proxySearchResult.model}. Parsed ${importPreview.parsedCount}; ${importPreview.importableCount} new; ${importPreview.updatedCount} existing records can be updated; ${importPreview.duplicateCount} duplicates${importPreview.excludedOwnCount ? `; ${importPreview.excludedOwnCount} results from your own account excluded` : ""}. Results are paginated below; showing ${resultPreviewDisplayStart}-${resultPreviewEnd}.`
                  )}
                </p>
                {!proxySearchResult.structured && proxySearchResult.parseError ? <p className="mt-1 text-xs text-amber-200/70">JSON 解析未命中，已自动回退到文本解析。</p> : null}
              </div>
              <div className="flex flex-col gap-2 sm:flex-row lg:shrink-0">
                <Button type="button" variant="outline" className="tech-secondary" onClick={() => setProxySearchResult(null)}>
                  暂不导入
                </Button>
                <Button type="button" className="tech-cta" onClick={importGrokResult} disabled={importPreview.importableCount === 0 && importPreview.updatedCount === 0}>
                  <Upload className="h-4 w-4" /> 导入结果
                </Button>
              </div>
            </div>
            {resultPreviewSignals.length > 0 ? (
              <div className="mt-4 grid gap-2">
                {resultPreviewSignals.map((signal) => (
                  <div key={signal.id} className="rounded-md border border-white/[0.06] bg-[#0d0d10]/60 p-3 text-xs text-white/60">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="min-w-0 truncate font-semibold text-white/85">{signal.platform} · {signal.author}</p>
                      {typeof signal.confidence === "number" ? <span className="rounded-md border border-blue-500/10 bg-blue-500/10 px-2 py-1 font-mono text-blue-200">{signal.confidence}</span> : null}
                    </div>
                    <p className="mt-2 line-clamp-2 leading-5 text-white/65">{signal.text}</p>
                    {signal.reason ? <p className="mt-1 line-clamp-2 leading-5 text-white/40">{signal.reason}</p> : null}
                    {signal.tags.length > 0 ? (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {signal.tags.slice(0, 3).map((tag) => <span key={tag} className="rounded-md border border-white/[0.06] bg-white/[0.04] px-2 py-1 text-white/45">{tag}</span>)}
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : resultPreviewLines.length > 0 ? (
              <div className="mt-4 grid gap-2">
                {resultPreviewLines.map((line, index) => (
                  <p key={`${line}-${index}`} className="line-clamp-2 rounded-md border border-white/[0.06] bg-[#0d0d10]/60 px-3 py-2 text-xs leading-5 text-white/60">{line}</p>
                ))}
              </div>
            ) : null}
            {importableGrokCandidates.length > resultPreviewPageSize ? (
              <div className="mt-4 flex flex-col gap-2 border-t border-white/[0.08] pt-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-xs text-white/45">
                  {tr(
                    `第 ${safeResultPreviewPage}/${resultPreviewPageCount} 页 · 当前 ${resultPreviewDisplayStart}-${resultPreviewEnd} / 共 ${importableGrokCandidates.length} 条`,
                    `Page ${safeResultPreviewPage}/${resultPreviewPageCount} · Showing ${resultPreviewDisplayStart}-${resultPreviewEnd} of ${importableGrokCandidates.length}`
                  )}
                </p>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="tech-secondary"
                    disabled={safeResultPreviewPage <= 1}
                    onClick={() => setResultPreviewPage((page) => Math.max(1, page - 1))}
                  >
                    {tr("上一页", "Previous")}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="tech-secondary"
                    disabled={safeResultPreviewPage >= resultPreviewPageCount}
                    onClick={() => setResultPreviewPage((page) => Math.min(resultPreviewPageCount, page + 1))}
                  >
                    {tr("下一页", "Next")}
                  </Button>
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
        <div className={cn("grid gap-3", !isAccountRadar && "xl:grid-cols-2")}>
          {!isAccountRadar ? (
          <div className="grid gap-2 rounded-lg border border-white/[0.08] bg-white/[0.03] p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <Label className="text-xs font-bold uppercase text-white/45">Grok Prompt</Label>
                <p className="mt-1 text-xs leading-5 text-white/40">根据左侧定位自动生成，默认收起。</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="ghost" size="sm" className="text-white/70 hover:bg-white/[0.06] hover:text-white" onClick={() => copyText(prompt)}>
                  <Copy className="h-4 w-4" /> 复制
                </Button>
                <Button type="button" variant="outline" size="sm" className="tech-secondary" onClick={() => setIsPromptOpen((value) => !value)}>
                  {isPromptOpen ? "收起" : "展开查看"}
                </Button>
              </div>
            </div>
            {isPromptOpen ? (
              <div className="grid gap-3">
                <div className="grid gap-2 rounded-md border border-white/[0.06] bg-[#0d0d10]/70 p-3">
                  <Label className="text-xs font-bold uppercase tracking-wide text-white/45">补充关键词（可选）</Label>
                  <Input
                    value={editableKeywords}
                    onChange={(event) => updateGrokBridgeField("keywords", event.target.value)}
                    placeholder={autoKeywords ? `留空时自动使用：${autoKeywords}` : "留空时使用左侧定位自动生成"}
                    className="border-white/[0.08] bg-white/[0.04] text-white placeholder:text-white/35"
                  />
                  <p className="text-xs leading-5 text-white/40">一般不用填。只有当 Grok 搜出来偏了，再补几个英文或中文关键词微调。</p>
                </div>
                <Textarea readOnly value={prompt} className="min-h-[220px] resize-none border-white/[0.08] bg-[#0d0d10]/80 font-mono text-xs leading-5 text-white/75" />
              </div>
            ) : (
              <div className="rounded-md border border-white/[0.06] bg-[#0d0d10]/70 px-3 py-2 text-xs leading-5 text-white/45">
                当前搜索语境：{effectiveKeywords || "左侧定位"}。复制后可直接粘贴到 Grok；需要检查或微调时再展开。
              </div>
            )}
          </div>
          ) : null}

          <div className="grid gap-2">
            <div className="flex items-center justify-between gap-2">
              <Label className="text-xs font-bold uppercase text-white/45">{isAccountRadar ? "竞品洞察线索" : "Grok 结果"}</Label>
              <Button type="button" variant="outline" size="sm" className="tech-secondary" onClick={importGrokResult} disabled={bridgeState === "loading"}>
                导入结果
              </Button>
            </div>
            <Textarea
              value={activeResult}
              onChange={(event) => {
                updateGrokBridgeField(activeResultField, event.target.value);
                setProxySearchResult(null);
              }}
              placeholder={isAccountRadar ? "竞品洞察生成的线索会出现在这里，也可以粘贴 X | 作者 | 链接 | 原帖语言代码 | 保留原语言的精简原文 格式结果。" : "Grok 或 codeproxy 返回的结果会出现在这里。推荐格式：X | 作者 | 链接 | 原帖语言代码 | 保留原语言的精简原文"}
              className="min-h-[220px] resize-none border-white/[0.08] bg-[#0d0d10]/80 text-sm leading-6 text-white placeholder:text-white/35"
            />
            <SignalImportPreview preview={importPreview} />
          </div>
        </div>

        <div className={cn("rounded-md border px-3 py-2 text-xs leading-5", bridgeState === "error" ? "border-rose-400/20 bg-rose-500/10 text-rose-200" : "border-white/[0.08] bg-white/[0.03] text-white/55")}>
          <p>{bridgeMessage}</p>
          {bridgeState === "error" && bridgeDiagnosticId ? (
            <a
              href={`/api/diagnostics/grok?id=${bridgeDiagnosticId}`}
              target="_blank"
              rel="noreferrer"
              className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-rose-200/20 bg-rose-100/[0.06] px-2.5 py-1 font-semibold text-rose-100 transition-colors hover:bg-rose-100/[0.12]"
            >
              <ExternalLink className="h-3.5 w-3.5" /> {tr(`查看完整日志 #${bridgeDiagnosticId}`, `View full log #${bridgeDiagnosticId}`)}
            </a>
          ) : null}
        </div>
      </CardContent>
      </Card>
    </>
  );
}
function shortValue(value: string | undefined, fallback: string) {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function accountLabelFromUrl(value: string) {
  const raw = value.trim().replace(/^@+/, "");
  if (!raw) return "待输入目标账号";
  try {
    const url = new URL(raw.startsWith("http") ? raw : `https://x.com/${raw}`);
    const handle = url.pathname.split("/").filter(Boolean)[0];
    return handle ? `@${handle}` : raw;
  } catch {
    return raw.split(/[/?#\s]/)[0] ? `@${raw.split(/[/?#\s]/)[0]}` : raw;
  }
}

function fallbackAngles(current: FormState) {
  const pain = current.painPoints.trim();
  const target = current.targetCustomer.trim();
  return [
    pain ? `围绕「${pain.split(/[，,、]/)[0]}」找抱怨或求助` : "找评论里的抱怨、求助和替代方案讨论",
    target ? `优先筛选接近「${target.split(/[，,、]/)[0]}」的人` : "优先筛选与你目标读者重叠的人",
    "把竞品没讲清楚的地方变成回复角度",
  ];
}

function AccountRadarOpportunityPanel({
  current,
  profileUrl,
  pulledProfile,
  insight,
}: {
  current: FormState;
  profileUrl: string;
  pulledProfile: GrokProxyApiResponse["pulledProfile"];
  insight: AccountRadarInsight | null;
}) {
  const productName = shortValue(current.productName, "你的产品/账号");
  const accountName = pulledProfile?.username ? `@${pulledProfile.username}` : accountLabelFromUrl(profileUrl);
  const productPosition = shortValue(current.description, "先填写产品描述，AI 会更容易判断你和目标账号的差异。");
  const targetAudience = shortValue(current.targetCustomer, "目标用户越清楚，竞品洞察越能筛出值得互动的人。");
  const targetPosition = shortValue(insight?.competitorPosition, pulledProfile ? "已读取公开资料，等待 AI 判断它吸引了哪类受众。" : "输入竞品、KOL 或社区账号后，会判断它吸引了哪类受众。");
  const ourPosition = shortValue(insight?.ourPosition, productPosition);
  const overlap = shortValue(insight?.audienceOverlap, `寻找与「${targetAudience}」重叠的人群。`);
  const gap = shortValue(insight?.opportunityGap, "优先找对方没有充分回答、没有产品化承接，或用户仍在反复追问的问题。");
  const nextStep = shortValue(insight?.nextStep, pulledProfile ? "确认候选线索后导入互动队列，再跑 AI 评分和草稿。" : "先输入目标账号并分析，再把线索导入互动队列。");
  const angles = insight?.recommendedAngles?.length ? insight.recommendedAngles.slice(0, 4) : fallbackAngles(current);
  const keywords = insight?.keywords?.length ? insight.keywords.slice(0, 6) : deriveGrokKeywords(current).split(/[,，]/).map((item) => item.trim()).filter(Boolean).slice(0, 6);

  return (
    <div className="grid gap-3 rounded-lg border border-white/[0.08] bg-[#0d0d10]/45 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-xs font-bold uppercase text-white/40">竞品定位对比</p>
          <h4 className="mt-1 text-sm font-bold text-white">先判断差异，再决定找谁互动</h4>
        </div>
        <Badge variant="outline" className="rounded-md border-emerald-300/20 bg-emerald-400/10 text-emerald-100">
          {insight?.accountType || "等待 AI 判断"}
        </Badge>
      </div>

      <div className="grid gap-2 lg:grid-cols-3">
        <div className="rounded-md border border-white/[0.06] bg-white/[0.035] p-3">
          <div className="flex items-center gap-2 text-xs font-bold text-emerald-100"><Target className="h-4 w-4" /> 你的定位</div>
          <p className="mt-2 font-semibold text-white">{productName}</p>
          <p className="mt-1 line-clamp-3 text-xs leading-5 text-white/55">{ourPosition}</p>
          <p className="mt-2 text-xs text-white/35">目标读者：{targetAudience}</p>
        </div>
        <div className="rounded-md border border-white/[0.06] bg-white/[0.035] p-3">
          <div className="flex items-center gap-2 text-xs font-bold text-blue-100"><Users className="h-4 w-4" /> 目标账号</div>
          <p className="mt-2 font-semibold text-white">{accountName}</p>
          <p className="mt-1 line-clamp-3 text-xs leading-5 text-white/55">{targetPosition}</p>
          {pulledProfile?.textLength ? <p className="mt-2 text-xs text-white/35">公开资料 {pulledProfile.textLength} 字已参与判断</p> : null}
        </div>
        <div className="rounded-md border border-white/[0.06] bg-white/[0.035] p-3">
          <div className="flex items-center gap-2 text-xs font-bold text-amber-100"><Lightbulb className="h-4 w-4" /> 机会缺口</div>
          <p className="mt-2 line-clamp-4 text-xs leading-5 text-white/60">{gap}</p>
          <p className="mt-2 text-xs leading-5 text-white/35">下一步：{nextStep}</p>
        </div>
      </div>

      <div className="grid gap-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="rounded-md border border-white/[0.06] bg-white/[0.025] p-3">
          <p className="text-xs font-bold text-white/45">重叠受众判断</p>
          <p className="mt-1 text-xs leading-5 text-white/60">{overlap}</p>
        </div>
        <div className="rounded-md border border-white/[0.06] bg-white/[0.025] p-3">
          <p className="text-xs font-bold text-white/45">可验证关键词</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {(keywords.length ? keywords : ["pain", "alternative", "first users"]).map((keyword) => (
              <span key={keyword} className="rounded-md border border-blue-400/10 bg-blue-400/10 px-2 py-1 text-xs text-blue-100/80">{keyword}</span>
            ))}
          </div>
        </div>
      </div>

      <div className="rounded-md border border-emerald-300/15 bg-emerald-400/[0.045] p-3">
        <p className="text-xs font-bold text-emerald-100/80">推荐切入角度</p>
        <div className="mt-2 grid gap-1.5 sm:grid-cols-3">
          {angles.slice(0, 3).map((angle, index) => (
            <p key={`${angle}-${index}`} className="rounded-md border border-white/[0.06] bg-[#0d0d10]/45 px-2.5 py-2 text-xs leading-5 text-white/60">{angle}</p>
          ))}
        </div>
        {insight?.riskNotes ? <p className="mt-2 text-xs leading-5 text-amber-100/70">注意：{insight.riskNotes}</p> : null}
      </div>
    </div>
  );
}
function SignalImportPreview({ preview }: { preview: SignalImportPreviewData }) {
  const { locale } = useI18n();
  const tr = (zh: string, en: string) => (locale === "en" ? en : zh);
  const [previewPage, setPreviewPage] = useState(1);
  const hasOnlyDuplicates = preview.importableCount === 0 && preview.updatedCount === 0 && preview.duplicateCount > 0;
  const hasOnlyOwnAccount = preview.importableCount === 0 && preview.updatedCount === 0 && preview.excludedOwnCount > 0 && preview.duplicateCount === 0;
  const allPreviewItems = preview.importableCount > 0 || preview.updatedCount > 0
    ? [...preview.importable, ...preview.updated]
    : hasOnlyDuplicates
      ? preview.duplicates
      : hasOnlyOwnAccount
        ? preview.excludedOwn
        : [];
  const previewPageSize = 3;
  const previewPageCount = Math.max(1, Math.ceil(allPreviewItems.length / previewPageSize));
  const safePreviewPage = Math.min(previewPage, previewPageCount);
  const previewStart = (safePreviewPage - 1) * previewPageSize;
  const previewEnd = Math.min(previewStart + previewPageSize, allPreviewItems.length);
  const previewDisplayStart = allPreviewItems.length > 0 ? previewStart + 1 : 0;
  const previewItems = allPreviewItems.slice(previewStart, previewEnd);
  const previewScopeKey = `${hasOnlyDuplicates ? "duplicates" : hasOnlyOwnAccount ? "own" : preview.updatedCount > 0 ? "updated" : "importable"}:${allPreviewItems.map((signal) => signal.id).join("|")}`;

  useEffect(() => {
    setPreviewPage(1);
  }, [previewScopeKey]);

  return (
    <div className="rounded-lg border border-white/[0.08] bg-white/[0.03] p-3 text-xs text-white/65">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-bold uppercase tracking-wide text-white/45">导入预览</p>
        <div className="flex flex-wrap gap-1.5">
          <span className="rounded-md border border-white/[0.08] bg-white/[0.04] px-2 py-1 text-white/70">解析 {preview.parsedCount}</span>
          <span className="rounded-md border border-emerald-500/10 bg-emerald-500/10 px-2 py-1 text-emerald-300">可导入 {preview.importableCount}</span>
          {preview.updatedCount > 0 ? <span className="rounded-md border border-blue-500/10 bg-blue-500/10 px-2 py-1 text-blue-200">可更新旧记录 {preview.updatedCount}</span> : null}
          <span className="rounded-md border border-amber-500/10 bg-amber-500/10 px-2 py-1 text-amber-300">已在队列 {preview.duplicateCount}</span>
          {preview.excludedOwnCount > 0 ? <span className="rounded-md border border-rose-500/10 bg-rose-500/10 px-2 py-1 text-rose-200">排除自己账号 {preview.excludedOwnCount}</span> : null}
        </div>
      </div>
      {previewItems.length > 0 ? (
        <div className="mt-3 grid gap-2">
          {previewItems.map((signal) => (
            <SignalPreviewRow key={signal.id} signal={signal} />
          ))}
        </div>
      ) : hasOnlyDuplicates ? (
        <div className="mt-3 grid gap-2">
          <p className="rounded-md border border-amber-500/10 bg-amber-500/10 px-3 py-2 leading-5 text-amber-100/80">这批结果已经在互动队列里，不需要重复导入。</p>
          {previewItems.map((signal) => (
            <SignalPreviewRow key={signal.id} signal={signal} badge="已在队列" />
          ))}
        </div>
      ) : hasOnlyOwnAccount ? (
        <div className="mt-3 grid gap-2">
          <p className="rounded-md border border-rose-500/10 bg-rose-500/10 px-3 py-2 leading-5 text-rose-100/80">这批结果识别为自己的账号数据，已阻止导入。请换竞品/KOL 或外部目标用户账号。</p>
          {previewItems.map((signal) => (
            <SignalPreviewRow key={signal.id} signal={signal} badge="已排除" />
          ))}
        </div>
      ) : (
        <p className="mt-3 leading-5 text-white/40">粘贴 Grok 结果后，这里会显示解析和去重结果。</p>
      )}
      {allPreviewItems.length > previewPageSize ? (
        <div className="mt-3 flex flex-col gap-2 border-t border-white/[0.08] pt-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-white/45">
            {tr(
              `第 ${safePreviewPage}/${previewPageCount} 页 · 当前 ${previewDisplayStart}-${previewEnd} / 共 ${allPreviewItems.length} 条`,
              `Page ${safePreviewPage}/${previewPageCount} · Showing ${previewDisplayStart}-${previewEnd} of ${allPreviewItems.length}`
            )}
          </p>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="tech-secondary h-8"
              disabled={safePreviewPage <= 1}
              onClick={() => setPreviewPage((page) => Math.max(1, page - 1))}
            >
              {tr("上一页", "Previous")}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="tech-secondary h-8"
              disabled={safePreviewPage >= previewPageCount}
              onClick={() => setPreviewPage((page) => Math.min(previewPageCount, page + 1))}
            >
              {tr("下一页", "Next")}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function SignalPreviewRow({ signal, badge }: { signal: Signal; badge?: string }) {
  return (
    <div className="rounded-md border border-white/[0.06] bg-[#0d0d10]/70 p-2">
      <div className="flex min-w-0 items-center justify-between gap-2">
        <p className="truncate font-semibold text-white/80">{signal.platform} · {signal.author}</p>
        {badge ? <span className="shrink-0 rounded-md border border-amber-500/10 bg-amber-500/10 px-2 py-1 text-amber-200">{badge}</span> : null}
      </div>
      <p className="mt-1 line-clamp-2 leading-5 text-white/50">{signal.text}</p>
    </div>
  );
}
function MetricGrid({
  queryCount,
  itemCount,
  hotCount,
  draftCount,
  averageScore,
  mode,
}: {
  queryCount: number;
  itemCount: number;
  hotCount: number;
  draftCount: number;
  averageScore: number;
  mode: Mode;
}) {
  const metrics = [
    { icon: <Search className="h-5 w-5" />, value: queryCount, label: "Grok 提示词", tone: "bg-blue-50 text-blue-700" },
    { icon: <Database className="h-5 w-5" />, value: itemCount, label: mode === "outbound" ? "线索记录" : "帖子信号", tone: "bg-violet-50 text-violet-700" },
    { icon: <Trophy className="h-5 w-5" />, value: hotCount, label: mode === "outbound" ? "高意向" : "立即互动", tone: "bg-emerald-50 text-emerald-700" },
    { icon: <Gauge className="h-5 w-5" />, value: averageScore, label: `${draftCount} 条草稿就绪`, tone: "bg-amber-50 text-amber-700" },
  ];

  return (
    <div className="fade-up delay-4 grid gap-3 md:grid-cols-2 2xl:grid-cols-4">
      {metrics.map((metric) => (
        <div key={metric.label} className="micro-glass rounded-lg border border-white/[0.06] bg-white/[0.02] p-4 shadow-sm backdrop-blur-md">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="metric-number text-3xl font-black leading-none text-slate-950">{metric.value}</p>
              <p className="mt-2 text-sm font-semibold text-slate-500">{metric.label}</p>
            </div>
            <div className={cn("grid h-11 w-11 place-items-center rounded-md", metric.tone)}>{metric.icon}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

function PipelinePanel({ mode, stages }: { mode: Mode; stages: Array<{ label: string; value: number; detail: string }> }) {
  return (
    <Card className="fade-up delay-5 overflow-hidden border-slate-200 bg-white">
      <CardHeader className="flex-row items-center justify-between space-y-0 border-b border-slate-200">
        <div>
          <CardTitle>运营闭环</CardTitle>
          <CardDescription className="mt-2">参考 GTM 工具的工作流：监听、评分、生成、执行。</CardDescription>
        </div>
        <Badge variant="outline" className="rounded-md border-slate-200 bg-slate-50 text-slate-700">
          <Activity className="mr-1 h-3.5 w-3.5" /> {mode === "outbound" ? "线索管道" : "受众增长"}
        </Badge>
      </CardHeader>
      <CardContent className="p-4">
        <div className="grid gap-3 md:grid-cols-4">
          {stages.map((stage, index) => (
            <div key={stage.label} className="micro-glass relative overflow-hidden rounded-lg border border-white/[0.06] bg-white/[0.02] p-4 backdrop-blur-md">
              <div className="absolute inset-x-0 top-0 h-1 bg-slate-950" style={{ opacity: 0.2 + index * 0.18 }} />
              <p className="text-xs font-bold uppercase text-slate-500">{stage.label}</p>
              <p className="metric-number mt-3 text-2xl font-black text-slate-950">{stage.value}</p>
              <p className="mt-1 text-sm text-slate-500">{stage.detail}</p>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function SearchRadar({ queries }: { queries: Query[] }) {
  return (
    <Card className="fade-up delay-5 overflow-hidden border-slate-200 bg-white">
      <CardHeader className="flex-row items-center justify-between space-y-0 border-b border-slate-200">
        <div>
          <CardTitle>Grok 找用户提示词</CardTitle>
          <CardDescription className="mt-2">可复制到 Grok 或 X 搜索的提示词。</CardDescription>
        </div>
        <Badge variant="secondary" className="rounded-md bg-slate-100 text-slate-700">{queries.length} 条 X 提示词</Badge>
      </CardHeader>
      <CardContent className="grid gap-3 p-4 lg:grid-cols-2">
        {queries.map((query, index) => (
          <div key={`${query.channel}-${query.query}-${index}`} className="group rounded-lg border border-slate-200 bg-slate-50 p-3 transition-colors hover:border-slate-300 hover:bg-white">
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2">
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-slate-950 text-xs font-black text-white">{index + 1}</span>
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold text-slate-950">{query.channel}</p>
                  <p className="truncate text-xs font-semibold uppercase text-slate-500">{query.intent}</p>
                </div>
              </div>
              <Button variant="ghost" size="sm" onClick={() => copyText(query.query)} className="shrink-0">
                <Copy className="h-4 w-4" /> 复制
              </Button>
            </div>
            <p className="mt-3 break-words rounded-md border border-slate-200 bg-white p-3 font-mono text-xs leading-5 text-slate-700">{query.query}</p>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
function ExecutionStatsPanel({ mode, stats, recentSignals }: { mode: Mode; stats: ExecutionStats; recentSignals: Signal[] }) {
  const statCards = [
    { label: "今日已处理", value: stats.processedToday, detail: `${stats.repliedToday + stats.quotedToday} 个互动动作`, tone: "text-emerald-300" },
    { label: "仍未执行", value: stats.pending, detail: `完整队列 ${stats.total} 条`, tone: "text-white" },
    { label: "正反馈", value: stats.positiveFeedback, detail: `回复 ${stats.byFeedback.got_reply} / 关注 ${stats.byFeedback.followed} / 转发 ${stats.byFeedback.reshared}`, tone: "text-blue-200" },
    { label: "无回复", value: stats.byFeedback.no_reply, detail: `今日反馈 ${stats.feedbackToday} 条`, tone: "text-amber-200" },
  ];

  return (
    <Card className="fade-up delay-5 overflow-hidden border border-white/[0.08] bg-white/[0.03] text-white shadow-2xl shadow-blue-500/5 backdrop-blur-md">
      <CardHeader className="flex-row items-start justify-between gap-3 space-y-0 border-b border-white/[0.08] bg-[#0d0d10]/70">
        <div>
          <Badge variant="outline" className="rounded-md border-blue-500/10 bg-blue-500/10 text-blue-200">执行复盘</Badge>
          <CardTitle className="mt-3 text-xl text-white">今天处理进度</CardTitle>
          <CardDescription className="mt-2 text-white/55">统计只基于当前模式和本地处理状态，用来复盘每天实际做了多少条。</CardDescription>
        </div>
        <Badge variant="outline" className="rounded-md border-white/[0.08] bg-white/[0.04] text-white/60">完成 {stats.completionRate}%</Badge>
      </CardHeader>
      <CardContent className="grid gap-4 p-4">
        <div className="grid gap-3 md:grid-cols-4">
          {statCards.map((card) => (
            <div key={card.label} className="rounded-lg border border-white/[0.08] bg-[#0d0d10]/60 p-3">
              <p className="text-xs font-bold uppercase tracking-wide text-white/35">{card.label}</p>
              <p className={cn("metric-number mt-2 text-3xl font-black leading-none", card.tone)}>{card.value}</p>
              <p className="mt-2 text-xs leading-5 text-white/45">{card.detail}</p>
            </div>
          ))}
        </div>

        <div className="rounded-lg border border-white/[0.08] bg-white/[0.03] p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs font-bold uppercase tracking-wide text-white/40">最近处理记录</p>
            <span className="text-xs text-white/35">{mode === "growth" ? "受众增长" : "主动获客"}</span>
          </div>
          {recentSignals.length > 0 ? (
            <div className="mt-3 grid gap-2">
              {recentSignals.map((signal) => {
                const status = normalizeExecutionStatus(signal.status);
                const feedback = normalizeFeedbackStatus(signal.feedback);
                return (
                  <div key={`${signal.id}-${signal.processedAt}`} className="flex flex-col gap-2 rounded-md border border-white/[0.06] bg-[#0d0d10]/70 p-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs font-bold uppercase tracking-wide text-white/35">执行状态</span><Badge variant="outline" className={cn("rounded-md", executionStatusClass(status))}>{executionStatusLabel(status, mode)}</Badge>
                        {feedback !== "none" ? <Badge variant="outline" className={cn("rounded-md text-[11px]", feedbackStatusClass(feedback))}>{feedbackStatusLabel(feedback)}</Badge> : null}
                        <span className="text-xs text-white/35">{formatProcessedAt(signal.processedAt)}</span>
                      </div>
                      <p className="mt-2 truncate text-sm font-semibold text-white/80">{signal.author}</p>
                      <p className="mt-1 line-clamp-2 text-xs leading-5 text-white/45">{signal.text}</p>
                    </div>
                    {signal.url ? (
                      <Button asChild variant="ghost" size="sm" className="shrink-0 text-white/55 hover:bg-white/[0.06] hover:text-white">
                        <a href={signal.url} target="_blank" rel="noreferrer">
                          <ExternalLink className="h-3.5 w-3.5" /> 原帖
                        </a>
                      </Button>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="mt-3 rounded-md border border-white/[0.06] bg-[#0d0d10]/60 p-3 text-sm leading-6 text-white/40">还没有处理记录。先在今日队列里标记几条状态，这里会自动出现最近记录。</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
function GrowthMemoryPanel({
  mode,
  memory,
  signals,
  onRunLearning,
  onClearMemory,
}: {
  mode: Mode;
  memory: GrowthMemoryState;
  signals: Signal[];
  onRunLearning: (onRetry?: GrowthMemoryRetryHandler) => Promise<GrowthMemoryRunResult>;
  onClearMemory: () => void;
}) {
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");
  const [diagnosticId, setDiagnosticId] = useState<number | null>(null);
  const [retryProgress, setRetryProgress] = useState<GrowthMemoryRetryProgress | null>(null);
  const [message, setMessage] = useState("标记反馈后，让 GPT-5.5 总结哪些人、关键词和话术真的有效，并自动应用到下一轮排序和找人。");
  const feedbackSignals = useMemo(() => signals.filter((signal) => normalizeFeedbackStatus(signal.feedback) !== "none"), [signals]);
  const positiveCount = feedbackSignals.filter((signal) => ["got_reply", "followed", "reshared"].includes(normalizeFeedbackStatus(signal.feedback))).length;
  const noReplyCount = feedbackSignals.filter((signal) => normalizeFeedbackStatus(signal.feedback) === "no_reply").length;
  const hasMemory = Boolean(memory.summary || memory.generatedAt || memory.effectiveKeywords.length || memory.scoreBoostRules.length || memory.replyStyleRules.length);
  const activeRuleCount = [...memory.scoreBoostRules, ...memory.scorePenaltyRules].filter((rule) => rule.status === "active").length;
  const mergeStats = memory.lastMergeStats ?? { added: 0, merged: 0, strengthened: 0, weakened: 0, paused: 0 };
  const generatedLabel = memory.generatedAt ? formatProcessedAt(memory.generatedAt) : "尚未生成";
  const appliedLabel = memory.appliedAt ? formatProcessedAt(memory.appliedAt) : "未应用";

  async function handleRunLearning() {
    setState("loading");
    setDiagnosticId(null);
    setRetryProgress(null);
    setMessage("正在让 GPT-5.5 从反馈样本里提炼增长记忆...");
    try {
      const result = await onRunLearning((progress) => {
        setRetryProgress(progress);
        setMessage(`正在进行第 ${progress.retryNumber}/${progress.maxRetries} 次自动重试。每次请求单独计算超时。上一次错误：${progress.reason}`);
      });
      setState("idle");
      setDiagnosticId(null);
      setRetryProgress(null);
      const successMessage = `已用 ${result.model} 学习 ${result.count} 条新反馈，累计 ${result.totalCount} 条；新增 ${result.stats.added}、合并 ${result.stats.merged}、增强 ${result.stats.strengthened}、降级 ${result.stats.weakened}、暂停 ${result.stats.paused} 条规则，并已自动应用到下一轮。`;
      setMessage(successMessage);
      showToast(successMessage, "success");
    } catch (error) {
      setState("error");
      setRetryProgress(null);
      const nextDiagnosticId = Number((error as { diagnosticId?: unknown })?.diagnosticId || 0);
      setDiagnosticId(nextDiagnosticId > 0 ? nextDiagnosticId : null);
      const errorMessage = error instanceof Error ? error.message : "增长记忆生成失败，请稍后重试。";
      setMessage(errorMessage);
      showToast(errorMessage, "error");
    }
  }

  function handleClear() {
    const confirmed = window.confirm("确定要重置全部增长记忆吗？累计总结、规则和已学习标记都会清除，但互动队列和反馈记录会保留，之后可以重新生成。");
    if (!confirmed) return;
    onClearMemory();
    setState("idle");
    setDiagnosticId(null);
    setRetryProgress(null);
    setMessage("已重置全部增长记忆。互动队列和反馈记录仍在，现在可以重新生成并应用。");
    showToast("已重置全部增长记忆，可以重新生成。", "info");
  }

  return (
    <Card className="fade-up delay-5 overflow-hidden border border-emerald-400/15 bg-emerald-400/[0.035] text-white shadow-2xl shadow-emerald-500/5 backdrop-blur-md">
      <CardHeader className="flex-row items-start justify-between gap-3 space-y-0 border-b border-white/[0.08] bg-[#0d0d10]/70">
        <div>
          <Badge variant="outline" className="rounded-md border-emerald-500/10 bg-emerald-500/10 text-emerald-300">
            <Sparkles className="mr-1 h-3.5 w-3.5" /> 增长记忆
          </Badge>
          <CardTitle className="mt-3 text-xl text-white">让反馈反过来改规则</CardTitle>
          <CardDescription className="mt-2 text-white/55">从已处理信号的反馈里学习：哪些关键词该加权、哪些要降权、回复草稿该保留什么风格。</CardDescription>
        </div>
        <Badge variant="outline" className={cn("rounded-md", hasMemory ? "border-emerald-500/10 bg-emerald-500/10 text-emerald-300" : "border-white/[0.08] bg-white/[0.04] text-white/55")}>
          {hasMemory ? "已启用" : "未生成"}
        </Badge>
      </CardHeader>
      <CardContent className="grid gap-4 p-4">
        <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-center">
          <div className={cn("rounded-md border px-3 py-2 text-sm leading-6", state === "error" ? "border-rose-400/20 bg-rose-500/10 text-rose-200" : "border-white/[0.08] bg-[#0d0d10]/55 text-white/60")}>
            <p>{message}</p>
            {diagnosticId ? (
              <a className="mt-1 inline-flex font-semibold text-rose-100 underline underline-offset-4 hover:text-white" href={`/api/diagnostics/memory?id=${diagnosticId}`} target="_blank" rel="noreferrer">
                查看完整日志 #{diagnosticId}
              </a>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button className="tech-cta h-9" onClick={() => void handleRunLearning()} disabled={state === "loading" || feedbackSignals.length === 0}>
              {state === "loading" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Bot className="h-4 w-4" />}
              {retryProgress ? `重试 ${retryProgress.retryNumber}/${retryProgress.maxRetries}` : hasMemory ? "学习新反馈并应用" : "生成并应用"}
            </Button>
            <Button variant="outline" className="tech-secondary h-9" onClick={handleClear} disabled={!hasMemory || state === "loading"}>
              重置全部记忆
            </Button>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-4">
          <div className="rounded-lg border border-white/[0.06] bg-[#0d0d10]/55 p-3">
            <p className="text-[11px] font-bold uppercase tracking-wide text-white/35">累计学习样本</p>
            <p className="mt-2 text-2xl font-black text-white">{memory.sampleCount}</p>
            <p className="mt-1 text-xs text-white/35">本轮新增 {memory.lastBatchSampleCount} / 当前反馈 {feedbackSignals.length}</p>
          </div>
          <div className="rounded-lg border border-white/[0.06] bg-[#0d0d10]/55 p-3">
            <p className="text-[11px] font-bold uppercase tracking-wide text-white/35">正反馈</p>
            <p className="mt-2 text-2xl font-black text-emerald-200">{memory.positiveCount || positiveCount}</p>
            <p className="mt-1 text-xs text-white/35">有回复 / 关注 / 转发</p>
          </div>
          <div className="rounded-lg border border-white/[0.06] bg-[#0d0d10]/55 p-3">
            <p className="text-[11px] font-bold uppercase tracking-wide text-white/35">无回复</p>
            <p className="mt-2 text-2xl font-black text-amber-200">{memory.noReplyCount || noReplyCount}</p>
            <p className="mt-1 text-xs text-white/35">用于识别降权模式</p>
          </div>
          <div className="rounded-lg border border-white/[0.06] bg-[#0d0d10]/55 p-3">
            <p className="text-[11px] font-bold uppercase tracking-wide text-white/35">活跃规则</p>
            <p className="mt-2 text-2xl font-black text-blue-100">{activeRuleCount}/10</p>
            <p className="mt-1 text-xs text-white/35">累计学习 {memory.learningRunCount} 轮</p>
          </div>
        </div>

        {hasMemory ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-white/[0.06] bg-[#0d0d10]/45 px-3 py-2 text-xs text-white/45">
            <span>本轮：新增 {mergeStats.added} · 合并 {mergeStats.merged} · 增强 {mergeStats.strengthened} · 降级 {mergeStats.weakened} · 暂停 {mergeStats.paused}</span>
            <span>生成 {generatedLabel} · 应用 {appliedLabel}</span>
          </div>
        ) : null}

        {hasMemory ? (
          <div className="grid gap-3 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
            <div className="grid gap-3 rounded-lg border border-white/[0.08] bg-[#0d0d10]/50 p-3">
              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-white/40">AI 学到的判断</p>
                <p className="mt-2 text-sm leading-6 text-white/70">{memory.summary || "还没有摘要。"}</p>
              </div>
              <div className="grid gap-2 md:grid-cols-2">
                <div className="rounded-md border border-emerald-400/10 bg-emerald-400/[0.045] p-3">
                  <p className="text-xs font-bold text-emerald-100">下一轮优先找</p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {(memory.effectiveKeywords.length ? memory.effectiveKeywords : ["等待学习"]).map((keyword) => <span key={keyword} className="rounded-md border border-emerald-300/15 bg-emerald-400/10 px-2 py-1 text-xs text-emerald-100">{keyword}</span>)}
                  </div>
                </div>
                <div className="rounded-md border border-amber-400/10 bg-amber-400/[0.045] p-3">
                  <p className="text-xs font-bold text-amber-100">下一轮少碰</p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {(memory.weakKeywords.length ? memory.weakKeywords : ["等待学习"]).map((keyword) => <span key={keyword} className="rounded-md border border-amber-300/15 bg-amber-400/10 px-2 py-1 text-xs text-amber-100">{keyword}</span>)}
                  </div>
                </div>
              </div>
              {memory.nextExperiment ? (
                <div className="rounded-md border border-blue-300/15 bg-blue-400/[0.045] p-3">
                  <p className="text-xs font-bold text-blue-100">下一轮实验</p>
                  <p className="mt-2 text-sm leading-6 text-white/65">{memory.nextExperiment}</p>
                </div>
              ) : null}
            </div>

            <div className="grid gap-3">
              <div className="rounded-lg border border-white/[0.08] bg-[#0d0d10]/50 p-3">
                <p className="text-xs font-bold uppercase tracking-wide text-white/40">评分规则变化</p>
                <div className="mt-3 grid gap-2">
                  {[...memory.scoreBoostRules.map((rule) => ({ ...rule, type: "boost" })), ...memory.scorePenaltyRules.map((rule) => ({ ...rule, type: "penalty" }))].slice(0, 10).map((rule, index) => (
                    <div key={`${rule.type}-${rule.pattern}-${index}`} className="rounded-md border border-white/[0.06] bg-white/[0.035] p-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-bold text-white/80">{rule.pattern}</span>
                        <div className="flex items-center gap-1.5">
                          <Badge variant="outline" className={cn("rounded-md", rule.status === "active" ? "border-emerald-500/10 bg-emerald-500/10 text-emerald-300" : rule.status === "watch" ? "border-blue-500/10 bg-blue-500/10 text-blue-200" : "border-white/[0.08] bg-white/[0.04] text-white/45")}>{rule.status === "active" ? "启用" : rule.status === "watch" ? "观察" : "暂停"}</Badge>
                          <Badge variant="outline" className={cn("rounded-md", rule.type === "boost" ? "border-emerald-500/10 bg-emerald-500/10 text-emerald-300" : "border-amber-500/10 bg-amber-500/10 text-amber-200")}>{rule.type === "boost" ? "+" : "-"}{rule.weight}</Badge>
                        </div>
                      </div>
                      <p className="mt-1 line-clamp-2 text-xs leading-5 text-white/45">{rule.reason}</p>
                      <p className="mt-1 text-[11px] text-white/30">置信度 {rule.confidence}% · 正反馈证据 {rule.positiveEvidence} · 无回复证据 {rule.negativeEvidence}</p>
                    </div>
                  ))}
                  {memory.scoreBoostRules.length + memory.scorePenaltyRules.length === 0 ? <p className="text-sm text-white/40">暂无明确加权规则。</p> : null}
                </div>
              </div>
              <div className="rounded-lg border border-white/[0.08] bg-[#0d0d10]/50 p-3">
                <p className="text-xs font-bold uppercase tracking-wide text-white/40">回复风格记忆</p>
                <div className="mt-3 grid gap-2">
                  {memory.replyStyleRules.slice(0, 4).map((rule) => <p key={rule} className="rounded-md border border-white/[0.06] bg-white/[0.035] px-3 py-2 text-xs leading-5 text-white/60">{rule}</p>)}
                  {memory.avoidReplyPatterns.slice(0, 3).map((rule) => <p key={rule} className="rounded-md border border-rose-400/10 bg-rose-400/[0.045] px-3 py-2 text-xs leading-5 text-rose-100/80">避免：{rule}</p>)}
                  {memory.replyStyleRules.length + memory.avoidReplyPatterns.length === 0 ? <p className="text-sm text-white/40">暂无话术风格记忆。</p> : null}
                </div>
              </div>
            </div>
          </div>
        ) : (
          <p className="rounded-md border border-white/[0.06] bg-[#0d0d10]/60 p-4 text-sm leading-6 text-white/45">现在还没有增长记忆。先在上方队列里处理几条，标记有回复 / 无回复 / 被关注 / 被转发，再点“生成增长记忆”。</p>
        )}
      </CardContent>
    </Card>
  );
}
function FeedbackReviewPanel({ mode, signals }: { mode: Mode; signals: Signal[] }) {
  const { locale } = useI18n();
  const [filter, setFilter] = useState<SignalFeedbackFilter>("all");
  const feedbackSignals = useMemo(
    () =>
      signals
        .filter((signal) => normalizeFeedbackStatus(signal.feedback) !== "none")
        .sort((left, right) => new Date(right.feedbackAt || right.processedAt || 0).getTime() - new Date(left.feedbackAt || left.processedAt || 0).getTime()),
    [signals]
  );
  const filteredSignals = useMemo(
    () => (filter === "all" ? feedbackSignals : feedbackSignals.filter((signal) => normalizeFeedbackStatus(signal.feedback) === filter)),
    [feedbackSignals, filter]
  );
  const filterOptions: Array<{ value: SignalFeedbackFilter; label: string; count: number }> = [
    { value: "all", label: "全部反馈", count: feedbackSignals.length },
    ...feedbackOptions
      .filter((option) => option.value !== "none")
      .map((option) => ({
        value: option.value,
        label: option.label,
        count: feedbackSignals.filter((signal) => normalizeFeedbackStatus(signal.feedback) === option.value).length,
      })),
  ];
  const positiveCount = feedbackSignals.filter((signal) => ["got_reply", "followed", "reshared"].includes(normalizeFeedbackStatus(signal.feedback))).length;
  const filteredPositiveCount = filteredSignals.filter((signal) => ["got_reply", "followed", "reshared"].includes(normalizeFeedbackStatus(signal.feedback))).length;
  const filteredDraftCount = filteredSignals.filter((signal) => signal.usedDraft).length;
  const filteredNoReplyCount = filteredSignals.filter((signal) => normalizeFeedbackStatus(signal.feedback) === "no_reply").length;

  function copyLearningPack() {
    copyText(buildFeedbackLearningPack(filteredSignals, { mode, locale, now: new Date().toISOString() }));
  }

  function copyReviewSummary() {
    const summary = filteredSignals
      .map((signal, index) => {
        const feedback = normalizeFeedbackStatus(signal.feedback);
        const usedDraft = signal.usedDraft ? `\n实际话术：${signal.usedDraft}` : "";
        return `${index + 1}. ${feedbackStatusLabel(feedback)} · ${signal.platform} · ${signal.author}\n${signal.text}${usedDraft}${signal.url ? `\n${signal.url}` : ""}`;
      })
      .join("\n\n");

    copyText(summary || "暂无反馈记录");
  }
  return (
    <Card className="fade-up delay-5 overflow-hidden border border-blue-400/15 bg-blue-400/[0.035] text-white shadow-2xl shadow-blue-500/5 backdrop-blur-md">
      <CardHeader className="flex-row items-start justify-between gap-3 space-y-0 border-b border-white/[0.08] bg-[#0d0d10]/70">
        <div>
          <Badge variant="outline" className="rounded-md border-blue-500/10 bg-blue-500/10 text-blue-200">反馈复盘</Badge>
          <CardTitle className="mt-3 text-xl text-white">反馈结果看这里</CardTitle>
          <CardDescription className="mt-2 text-white/55">这里记录你执行后的真实结果：手动标记反馈，或用插件巡检已保存的回复链接；系统不会再把原帖热度误判成你的评论反馈。</CardDescription>
        </div>
        <div className="flex flex-col items-end gap-2">
          <Badge variant="outline" className="rounded-md border-white/[0.08] bg-white/[0.04] text-white/60">{mode === "growth" ? "受众增长" : "主动获客"}</Badge>
          <span className="text-xs text-white/35">正反馈 {positiveCount}</span>
        </div>
      </CardHeader>
      <CardContent className="grid gap-4 p-4">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex flex-wrap gap-2">
            {filterOptions.map((option) => (
              <Button
                key={option.value}
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setFilter(option.value)}
                className={cn(
                  "h-8 rounded-md border-white/[0.08] bg-white/[0.03] px-3 text-xs text-white/60 hover:border-white/[0.16] hover:bg-white/[0.06]",
                  filter === option.value && "border-blue-400/20 bg-blue-400/10 text-blue-100"
                )}
              >
                {option.label} {option.count}
              </Button>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={copyReviewSummary} className="tech-secondary h-8 w-fit">
              <Copy className="h-3.5 w-3.5" /> 复制复盘摘要
            </Button>
            <Button variant="outline" size="sm" onClick={copyLearningPack} disabled={filteredSignals.length === 0} className="tech-secondary h-8 w-fit">
              <Bot className="h-3.5 w-3.5" /> 复制学习样本
            </Button>
          </div>
        </div>

        <div className="grid gap-2 md:grid-cols-3">
          <div className="rounded-lg border border-white/[0.06] bg-[#0d0d10]/55 p-3">
            <p className="text-[11px] font-bold uppercase tracking-wide text-white/35">当前样本</p>
            <p className="mt-2 text-2xl font-black text-white">{filteredSignals.length}</p>
          </div>
          <div className="rounded-lg border border-white/[0.06] bg-[#0d0d10]/55 p-3">
            <p className="text-[11px] font-bold uppercase tracking-wide text-white/35">带真实话术</p>
            <p className="mt-2 text-2xl font-black text-blue-200">{filteredDraftCount}</p>
          </div>
          <div className="rounded-lg border border-white/[0.06] bg-[#0d0d10]/55 p-3">
            <p className="text-[11px] font-bold uppercase tracking-wide text-white/35">正/无回复</p>
            <p className="mt-2 text-2xl font-black text-emerald-200">{filteredPositiveCount}<span className="text-base text-white/35"> / {filteredNoReplyCount}</span></p>
          </div>
        </div>

        {filteredSignals.length > 0 ? (
          <div className="grid max-h-[460px] gap-2 overflow-y-auto pr-1">
            {filteredSignals.map((signal) => {
              const feedback = normalizeFeedbackStatus(signal.feedback);
              const status = normalizeExecutionStatus(signal.status);
              return (
                <div key={`${signal.id}-${signal.feedbackAt || signal.processedAt}`} className="rounded-lg border border-white/[0.06] bg-[#0d0d10]/70 p-3 transition-colors duration-200 hover:bg-white/[0.035]">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="outline" className={cn("rounded-md text-[11px]", feedbackStatusClass(feedback))}>{feedbackStatusLabel(feedback)}</Badge>
                        <Badge variant="outline" className={cn("rounded-md text-[11px]", executionStatusClass(status))}>{executionStatusLabel(status, mode)}</Badge>
                        <span className="text-xs text-white/35">{formatProcessedAt(signal.feedbackAt) || formatProcessedAt(signal.processedAt)}</span>
                      </div>
                      <p className="mt-2 truncate text-sm font-semibold text-white/85">{signal.platform} · {signal.author}</p>
                      <p className="mt-1 line-clamp-3 text-xs leading-5 text-white/50">{signal.text}</p>
                      {signal.usedDraft ? (
                        <div className="mt-2 rounded-md border border-white/[0.06] bg-white/[0.03] p-2">
                          <p className="text-[11px] font-bold uppercase tracking-wide text-white/35">实际话术</p>
                          <p className="mt-1 line-clamp-3 text-xs leading-5 text-white/60">{signal.usedDraft}</p>
                        </div>
                      ) : null}
                    </div>
                    {signal.url ? (
                      <Button asChild variant="ghost" size="sm" className="shrink-0 text-white/55 hover:bg-white/[0.06] hover:text-white">
                        <a href={signal.url} target="_blank" rel="noreferrer">
                          <ExternalLink className="h-3.5 w-3.5" /> 原帖
                        </a>
                      </Button>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="rounded-md border border-white/[0.06] bg-[#0d0d10]/60 p-4 text-sm leading-6 text-white/45">这里还没有反馈记录。请在上方互动队列展开已执行的条目，手动选择“有回复 / 无回复 / 被关注 / 被转发”。保存后会自动出现在这里，并进入增长记忆学习。</p>
        )}
      </CardContent>
    </Card>
  );
}
function DailyQueuePanel({
  mode,
  items,
  signalByKey,
  onUpdateSignalStatus,
  onUpdateSignalFeedback,
  onUpdateSignalUsedDraft,
}: {
  variant?: "search" | "account";
  mode: Mode;
  items: QueueItem[];
  signalByKey: Map<string, Signal>;
  onUpdateSignalStatus: (item: QueueItem, status: SignalExecutionStatus) => void;
  onUpdateSignalFeedback: (item: QueueItem, feedback: SignalFeedbackStatus) => void;
  onUpdateSignalUsedDraft: (item: QueueItem, usedDraft: string) => void;
}) {
  return (
    <Card className="fade-up delay-5 overflow-hidden border border-emerald-400/15 bg-emerald-400/[0.04] text-white shadow-2xl shadow-emerald-500/5 backdrop-blur-md">
      <CardHeader className="flex-row items-start justify-between gap-3 space-y-0 border-b border-white/[0.08] bg-[#0d0d10]/70">
        <div>
          <Badge variant="outline" className="rounded-md border-emerald-500/10 bg-emerald-500/10 text-emerald-300">今日队列</Badge>
          <CardTitle className="mt-3 text-xl text-white">今天优先处理的 5 条</CardTitle>
          <CardDescription className="mt-2 text-white/55">只显示仍未执行、分数最高的条目。处理完会自动从这里消失。</CardDescription>
        </div>
        <Badge variant="outline" className="rounded-md border-white/[0.08] bg-white/[0.04] text-white/60">{items.length}/5</Badge>
      </CardHeader>
      <CardContent className="grid gap-3 p-4">
        {items.length > 0 ? (
          items.map((item, index) => {
            const signal = signalByKey.get(queueItemSignalKey(item));
            return (
              <div key={`${item.platform}-${item.url}-${item.name}-${index}`} className="rounded-lg border border-white/[0.08] bg-[#0d0d10]/65 p-3">
                <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="grid h-7 w-7 place-items-center rounded-md border border-white/[0.08] bg-white/[0.04] text-xs font-black text-white/70">{index + 1}</span>
                      <p className="truncate text-sm font-bold text-white">{item.name}</p>
                    </div>
                    <p className="mt-2 line-clamp-2 text-sm leading-6 text-white/55">{item.note || "暂无备注"}</p>
                  </div>
                  <Badge variant={scoreVariant(item.label)} className="w-fit rounded-md shrink-0">{item.score} - {displayLabel(item.label)}</Badge>
                </div>
                <ExecutionControls mode={mode} item={item} signal={signal} onStatusChange={(status) => onUpdateSignalStatus(item, status)} onFeedbackChange={(feedback) => onUpdateSignalFeedback(item, feedback)} onUsedDraftChange={(usedDraft) => onUpdateSignalUsedDraft(item, usedDraft)} />
              </div>
            );
          })
        ) : (
          <div className="rounded-lg border border-white/[0.08] bg-white/[0.03] p-5 text-sm leading-6 text-white/50">
            今日队列已清空。继续导入新结果，或把已处理项改回未执行。
          </div>
        )}
      </CardContent>
    </Card>
  );
}
function QueuePanel({
  result,
  copy,
  copyAllDrafts,
  signalByKey,
  onUpdateSignalStatus,
  onUpdateSignalFeedback,
  onUpdateSignalUsedDraft,
}: {
  result: WorkbenchResult;
  copy: ModeContent;
  copyAllDrafts: () => void;
  signalByKey: Map<string, Signal>;
  onUpdateSignalStatus: (item: QueueItem, status: SignalExecutionStatus) => void;
  onUpdateSignalFeedback: (item: QueueItem, feedback: SignalFeedbackStatus) => void;
  onUpdateSignalUsedDraft: (item: QueueItem, usedDraft: string) => void;
}) {
  return (
    <Card className="fade-up delay-5 overflow-hidden border-slate-200 bg-white">
      <CardHeader className="flex-row items-center justify-between gap-3 space-y-0 border-b border-slate-200">
        <div>
          <CardTitle>{copy.resultTitle}</CardTitle>
          <CardDescription className="mt-2">{copy.queueDescription}</CardDescription>
        </div>
        <Button variant="outline" size="sm" onClick={copyAllDrafts} className="tech-secondary shrink-0">
          <ClipboardList className="h-4 w-4" /> 草稿
        </Button>
      </CardHeader>
      <CardContent className="grid gap-4 p-4">
        {result.mode === "outbound"
          ? result.leads.map((lead) => (
              <OutboundCard
                key={`${lead.platform}-${lead.url}-${lead.name}`}
                lead={lead}
                signal={signalByKey.get(queueItemSignalKey(lead))}
                onStatusChange={(status) => onUpdateSignalStatus(lead, status)}
                onFeedbackChange={(feedback) => onUpdateSignalFeedback(lead, feedback)}
                onUsedDraftChange={(usedDraft) => onUpdateSignalUsedDraft(lead, usedDraft)}
              />
            ))
          : result.opportunities.map((item) => (
              <GrowthCard
                key={`${item.platform}-${item.url}-${item.name}`}
                item={item}
                signal={signalByKey.get(queueItemSignalKey(item))}
                onStatusChange={(status) => onUpdateSignalStatus(item, status)}
                onFeedbackChange={(feedback) => onUpdateSignalFeedback(item, feedback)}
                onUsedDraftChange={(usedDraft) => onUpdateSignalUsedDraft(item, usedDraft)}
              />
            ))}
      </CardContent>
    </Card>
  );
}

function OutboundCard({ lead, signal, onStatusChange, onFeedbackChange, onUsedDraftChange }: { lead: OutboundLead; signal?: Signal; onStatusChange: (status: SignalExecutionStatus) => void; onFeedbackChange: (feedback: SignalFeedbackStatus) => void; onUsedDraftChange: (usedDraft: string) => void }) {
  const tone = toneFor(lead.label);

  return (
    <div className={cn("overflow-hidden rounded-lg border bg-white shadow-sm", tone.border)}>
      <div className={cn("h-1", tone.strip)} />
      <div className="grid gap-4 p-4">
        <ItemHeader platform={lead.platform} name={lead.name} url={lead.url} score={lead.score} label={lead.label} />
        <ExecutionControls mode="outbound" item={lead} signal={signal} onStatusChange={onStatusChange} onFeedbackChange={onFeedbackChange} onUsedDraftChange={onUsedDraftChange} />
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_230px]">
          <p className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm leading-6 text-slate-600">{lead.note || "暂无备注"}</p>
          <ScorePanel score={lead.score} label={lead.label} />
        </div>
        <ReasonList reasons={lead.reasons} />
        <DraftBlock icon={<MessageSquareText className="h-4 w-4" />} title="触达草稿" value={lead.draft} source={draftSourceForItem(lead)} />
      </div>
    </div>
  );
}

function GrowthCard({ item, signal, onStatusChange, onFeedbackChange, onUsedDraftChange }: { item: GrowthOpportunity; signal?: Signal; onStatusChange: (status: SignalExecutionStatus) => void; onFeedbackChange: (feedback: SignalFeedbackStatus) => void; onUsedDraftChange: (usedDraft: string) => void }) {
  const tone = toneFor(item.label);

  return (
    <div className={cn("overflow-hidden rounded-lg border bg-white shadow-sm", tone.border)}>
      <div className={cn("h-1", tone.strip)} />
      <div className="grid gap-4 p-4">
        <ItemHeader platform={`${item.platform} · ${item.action}`} name={item.name} url={item.url} score={item.score} label={item.label} />
        <ExecutionControls mode="growth" item={item} signal={signal} onStatusChange={onStatusChange} onFeedbackChange={onFeedbackChange} onUsedDraftChange={onUsedDraftChange} />
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_230px]">
          <p className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm leading-6 text-slate-600">{item.note || "暂无备注"}</p>
          <ScorePanel score={item.score} label={item.label} />
        </div>
        <ReasonList reasons={item.reasons} />
        <div className="grid gap-3 xl:grid-cols-2 2xl:grid-cols-4">
          <DraftBlock icon={<MessageSquareText className="h-4 w-4" />} title="直接回复" description="发到原帖或评论下面，用来先建立互动。" value={item.replyDraft} source={draftSourceForItem(item)} />
          <DraftBlock icon={<Quote className="h-4 w-4" />} title="引用转发" description="引用这条内容再发表自己的观点。" value={item.quoteDraft} source={draftSourceForItem(item)} />
          <DraftBlock icon={<Lightbulb className="h-4 w-4" />} title="内容选题" description="把这个信号延展成你自己的原创帖。" value={item.postIdea} source={draftSourceForItem(item)} />
          <DraftBlock icon={<Target className="h-4 w-4" />} title="私下跟进" description="对方有明确需求时用于私信或后续交流，不要硬卖。" value={item.outreachDraft} source={draftSourceForItem(item)} />
        </div>
      </div>
    </div>
  );
}

function ExecutionControls({
  mode,
  item,
  signal,
  onStatusChange,
  onFeedbackChange,
  onUsedDraftChange,
}: {
  variant?: "search" | "account";
  mode: Mode;
  item: QueueItem;
  signal?: Signal;
  onStatusChange: (status: SignalExecutionStatus) => void;
  onFeedbackChange: (feedback: SignalFeedbackStatus) => void;
  onUsedDraftChange: (usedDraft: string) => void;
}) {
  const sourceUrl = openableSourceUrl(item.url);
  const status = normalizeExecutionStatus(signal?.status);
  const processedTime = formatProcessedAt(signal?.processedAt);
  const feedback = normalizeFeedbackStatus(signal?.feedback);
  const feedbackTime = formatProcessedAt(signal?.feedbackAt);
  const primaryDraft = mode === "outbound" ? (item as OutboundLead).draft : (item as GrowthOpportunity).replyDraft;
  const usedDraftTime = formatProcessedAt(signal?.usedDraftAt);
  const copyLabel = mode === "outbound" ? "复制触达" : "复制回复";
  const copyAndOpenLabel = mode === "outbound" ? "复制触达并打开原帖" : "复制回复并打开原帖";
  const [usedDraftInput, setUsedDraftInput] = useState(signal?.usedDraft || primaryDraft);
  const draftForExecution = usedDraftInput.trim() || primaryDraft;
  const copyAndOpenMessage = mode === "outbound" ? "已保存并复制实际触达话术，正在打开原帖。" : "已保存并复制实际回复，正在打开原帖。";

  useEffect(() => {
    setUsedDraftInput(signal?.usedDraft || primaryDraft);
  }, [signal?.usedDraft, primaryDraft]);

  function copyDraftAndOpenSource() {
    if (draftForExecution) onUsedDraftChange(draftForExecution);
    copyText(draftForExecution, copyAndOpenMessage);
  }

  return (
    <div className="rounded-lg border border-white/[0.08] bg-white/[0.03] p-3">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-bold uppercase tracking-wide text-white/35">执行状态</span><Badge variant="outline" className={cn("rounded-md", executionStatusClass(status))}>{executionStatusLabel(status, mode)}</Badge>
          {processedTime ? <span className="text-xs text-white/40">处理于 {processedTime}</span> : <span className="text-xs text-white/35">还未处理</span>}
        </div>
        <div className="flex flex-wrap gap-2">
          {sourceUrl ? (
            <Button asChild variant="outline" size="sm" className="tech-secondary h-8">
              <a
                href={sourceUrl}
                target="_blank"
                rel="noreferrer"
                data-ray-used-draft={draftForExecution}
                onClick={copyDraftAndOpenSource}
              >
                <Copy className="h-3.5 w-3.5" /> {copyAndOpenLabel} <ExternalLink className="h-3.5 w-3.5" />
              </a>
            </Button>
          ) : (
            <Button variant="outline" size="sm" className="tech-secondary h-8" onClick={() => copyText(primaryDraft)}>
              <Copy className="h-3.5 w-3.5" /> {copyLabel}
            </Button>
          )}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {executionOptions[mode].map((option) => (
          <Button
            key={option.value}
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onStatusChange(option.value)}
            className={cn(
              "h-8 rounded-md border-white/[0.08] bg-white/[0.03] px-3 text-xs text-white/60 hover:border-white/[0.16] hover:bg-white/[0.06]",
              status === option.value && `${executionStatusClass(option.value)} ring-1 ring-current/25`
            )}
          >
            {option.label}
          </Button>
        ))}
      </div>
      {status !== "new" ? (
        <div className="mt-3 border-t border-white/[0.06] pt-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs font-bold uppercase tracking-wide text-white/35">反馈结果</p>
            {feedback !== "none" ? (
              <Badge variant="outline" className={cn("rounded-md text-[11px]", feedbackStatusClass(feedback))}>
                {feedbackStatusLabel(feedback)}{feedbackTime ? ` · ${feedbackTime}` : ""}
              </Badge>
            ) : (
              <span className="text-xs text-white/35">未记录反馈</span>
            )}
          </div>
          <p className="mt-1 text-xs leading-5 text-white/35">这里记录这次互动后的外部结果，比如有没有人回复你、关注你或转发。保存后会显示在条目标题、反馈复盘和增长记忆里。</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {feedbackOptions.map((option) => (
              <Button
                key={option.value}
                type="button"
                variant="outline"
                size="sm"
                onClick={() => onFeedbackChange(option.value)}
                className={cn(
                  "h-8 rounded-md border-white/[0.08] bg-white/[0.03] px-3 text-xs text-white/60 hover:border-white/[0.16] hover:bg-white/[0.06]",
                  feedback === option.value && `${feedbackStatusClass(option.value)} ring-1 ring-current/25`
                )}
              >
                {option.label}
              </Button>
            ))}
          </div>
        </div>
      ) : null}
      {status !== "new" ? (
        <div className="mt-3 border-t border-white/[0.06] pt-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs font-bold uppercase tracking-wide text-white/35">实际采用话术</p>
            {signal?.usedDraft ? (
              <span className="text-xs text-white/35">保存于 {usedDraftTime || "刚刚"}</span>
            ) : (
              <span className="text-xs text-white/35">未保存改写版本</span>
            )}
          </div>
          <Textarea
            value={usedDraftInput}
            onChange={(event) => setUsedDraftInput(event.target.value)}
            placeholder={primaryDraft}
            className="mt-2 min-h-[96px] resize-none border-white/[0.08] bg-[#0d0d10]/75 text-sm leading-6 text-white placeholder:text-white/30"
          />
          <div className="mt-2 flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => setUsedDraftInput(primaryDraft)} className="tech-secondary h-8">
              使用生成草稿
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => onUsedDraftChange(usedDraftInput)} className="tech-secondary h-8">
              保存话术
            </Button>
            {signal?.usedDraft ? (
              <Button type="button" variant="ghost" size="sm" onClick={() => onUsedDraftChange("")} className="h-8 text-white/45 hover:bg-white/[0.06] hover:text-white">
                清除
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
function ItemHeader({ platform, name, url, score, label }: { platform: string; name: string; url: string; score: number; label: string }) {
  const sourceUrl = openableSourceUrl(url);

  return (
    <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
      <div className="min-w-0">
        <p className="text-xs font-bold uppercase text-slate-500">{platform}</p>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <h3 className="text-base font-black text-slate-950">{name}</h3>
          {sourceUrl ? (
            <Button asChild variant="ghost" size="sm" className="h-7 px-2 text-primary">
              <a href={sourceUrl} target="_blank" rel="noreferrer">
                <ExternalLink className="h-3.5 w-3.5" /> 来源
              </a>
            </Button>
          ) : null}
        </div>
      </div>
      <Badge variant={scoreVariant(label)} className="w-fit rounded-md">
        {score} - {displayLabel(label)}
      </Badge>
    </div>
  );
}

function ScorePanel({ score, label }: { score: number; label: string }) {
  const tone = toneFor(label);
  const width = `${Math.max(6, Math.min(100, score))}%`;

  return (
    <div className={cn("rounded-lg border p-3", tone.soft)}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-bold uppercase">优先级评分</span>
        <span className="text-lg font-black leading-none">{score}</span>
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/70">
        <div className={cn("h-full rounded-full", tone.fill)} style={{ width }} />
      </div>
      <p className="mt-2 text-xs font-semibold">{displayLabel(label)}</p>
    </div>
  );
}

function ReasonList({ reasons }: { reasons: string[] }) {
  return (
    <div className="flex flex-wrap gap-2">
      {reasons.map((reason) => (
        <Badge key={reason} variant="secondary" className="rounded-md bg-slate-100 text-slate-700">
          {reason}
        </Badge>
      ))}
    </div>
  );
}

function DraftBlock({ icon, title, value, description, source }: { icon: ReactNode; title: string; value: string; description?: string; source?: DraftSource }) {
  const sourceMeta = source ?? { label: "本地草稿", detail: "规则兜底", tone: "local" as const };

  return (
    <div className="grid gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="inline-flex min-w-0 items-center gap-2 text-sm font-bold text-slate-600">{icon}{title}</p>
            <Badge
              variant="outline"
              title={sourceMeta.detail}
              className={cn(
                "rounded-md px-2 py-0.5 text-[11px] font-bold",
                sourceMeta.tone === "ai"
                  ? "border-blue-300/25 bg-blue-400/10 text-blue-100"
                  : "border-white/[0.10] bg-white/[0.04] text-white/45"
              )}
            >
              {sourceMeta.label}
            </Badge>
          </div>
          {description ? <p className="mt-1 text-xs leading-5 text-slate-400">{description}</p> : null}
        </div>
        <Button variant="ghost" size="sm" onClick={() => copyText(value)} className="shrink-0">
          <Copy className="h-4 w-4" /> 复制
        </Button>
      </div>
      <Textarea readOnly value={value} className="min-h-[128px] resize-none border-slate-200 bg-white text-sm leading-6" />
    </div>
  );
}
