"use client";

import { useEffect, useMemo, useState, type Dispatch, type MouseEvent as ReactMouseEvent, type ReactNode, type SetStateAction } from "react";
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
  Zap,
} from "lucide-react";

import { ActionToastHost, showToast } from "@/components/action-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { AI_RESPONSE_CONFIG_STORAGE_KEY, DEFAULT_AI_RESPONSE_MODEL, DEFAULT_GROK_PROXY_MODEL, GROK_PROXY_CONFIG_STORAGE_KEY, X_PROFILE_CONFIG_STORAGE_KEY, normalizeAiResponseConfig, normalizeGrokProxyConfig, normalizeXProfileConfig } from "@/lib/codeproxy-grok";
import { buildGrokSearchPrompt } from "@/lib/grok-utils";
import { AI_DRAFT_LIMIT, applyAiDraftOverrides, buildDraftRequestInput } from "@/lib/llm-drafts";
import { applyGrowthMemoryToQueueItems, buildGrowthMemoryPromptContext, buildGrowthMemoryRequestInput, growthMemoryKeywordText, normalizeGrowthMemoryState } from "@/lib/growth-memory";
import { AI_SCORE_LIMIT, applyAiScoreOverrides, buildScoreRequestInput } from "@/lib/llm-scoring";
import { runGrowthWorkflow, runOutboundWorkflow } from "@/lib/outbound";
import { buildFeedbackLearningPack, createSignal, formatSignalsAsLeadInput, mergeSignals, parseSignalsFromText, signalDedupKey } from "@/lib/signals";
import { CURRENT_VERSION, DEFAULT_AI_DRAFT_STATE, DEFAULT_AI_SCORE_STATE, DEFAULT_GROK_BRIDGE_STATE, DEFAULT_GROWTH_MEMORY_STATE, DEFAULT_SIGNAL_STATE, WORKBENCH_STORAGE_KEY, createWorkbenchBackup, parseStoredWorkbenchState, parseWorkbenchBackup, serializeWorkbenchState } from "@/lib/workbench-state";
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
};

type AiResponseConfig = {
  apiKey: string;
  model: string;
};

type XProfileConfig = {
  profileUrl: string;
};

type BusyOverlayState = {
  title: string;
  message: string;
  detail: string;
} | null;

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

function ownAccountExclusionText(identity: OwnAccountIdentity) {
  const markers = [...identity.handles.map((handle) => "@" + handle), ...identity.names].filter(Boolean);
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
  message?: string;
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
  model?: string;
  message?: string;
  drafts?: AiDraft[];
};

type AiDraftRunResult = {
  count: number;
  model: string;
  failedCount?: number;
};

type AiProfile = Pick<FormState, "productName" | "description" | "targetCustomer" | "competitors" | "painPoints" | "replyGoal" | "productContext"> & {
  reasoning?: string;
};

type ProfileApiResponse = {
  ok?: boolean;
  configured?: boolean;
  model?: string;
  message?: string;
  profile?: Partial<AiProfile>;
};

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
};

type GrowthMemoryState = {
  active: boolean;
  generatedAt: string;
  appliedAt: string;
  sampleCount: number;
  positiveCount: number;
  noReplyCount: number;
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
  model?: string;
  message?: string;
  memory?: GrowthMemoryState;
};

type GrowthMemoryRunResult = {
  count: number;
  model: string;
};

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
  duplicateCount: number;
  excludedOwnCount: number;
  candidates: Signal[];
  importable: Signal[];
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
    { value: "replied", label: "已回复" },
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
  const result = mergeSignals(existingSignals, candidates) as { signals: Signal[]; imported: Signal[]; duplicates: Signal[] };
  return {
    parsedCount: candidates.length + excludedOwn.length,
    importableCount: result.imported.length,
    duplicateCount: result.duplicates.length,
    excludedOwnCount: excludedOwn.length,
    candidates,
    importable: result.imported,
    duplicates: result.duplicates,
    excludedOwn,
  };
}

function mergeLeadInputWithSignals(leadInput: string, modeSignals: Signal[]) {
  const manualSignals = parseSignalsFromText(leadInput, { source: "manual" }) as Signal[];
  const merged = mergeSignals(manualSignals, modeSignals ?? []) as { signals: Signal[] };
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
    badge: "受众增长",
    title: "填写账号定位",
    description: "先说清楚你的账号、目标读者和内容支柱，再去 Grok 找可互动的 X 讨论。",
    heroTitle: "把 X 上的讨论变成粉丝增长。",
    heroDescription: "给创作者和独立开发者使用的每日增长工作台：找到相关讨论、生成回复角度，并沉淀可复用的内容循环。",
    primaryLabel: "账号名称",
    secondaryLabel: "增长目标",
    descriptionLabel: "账号定位",
    targetLabel: "目标读者",
    pillarLabel: "内容支柱",
    candidateLabel: "已导入 X 信号",
    resultTitle: "互动指挥队列",
    queueDescription: "按互动价值和内容延展性排序。",
    hotLabel: "立即互动",
    csvName: "受众增长机会.csv",
  },
};
const initialState: Record<Mode, FormState> = {
  outbound: {
    productName: "LaunchRadar",
    description: "用 Grok 在 X 上找到高意向线索，并生成个性化触达草稿。",
    targetCustomer: "刚上线 SaaS 但没有流量的独立开发者",
    competitors: "Apollo, Clay, Taplio",
    painPoints: "0 流量, 找不到付费用户, SEO 太慢, 第一批客户",
    replyGoal: "先建立可信互动，确认对方是否愿意让 LaunchRadar 帮他试跑一批 X 线索。",
    productContext: "我在做 LaunchRadar，一个用 Grok 在 X 上找到高意向线索并生成个性化触达草稿的工具。公开回复里轻描淡写带到，不要硬卖。",
    leadInput: `X | 独立开发者 |  | 刚上线一个 SaaS 但没有流量，想找到付费用户，SEO 太慢
X | SaaS 创始人 |  | 正在寻找第一批付费用户，想验证主动获客渠道
X | AI 产品开发者 |  | 用 AI Coding 做了产品，但不知道怎么找到真实需求`,
  },
  growth: {
    productName: "Ray｜AI Coding 出海日记",
    description: "Java 后端开发者，分享 AI Coding、独立开发、主动获客和出海产品经验。",
    targetCustomer: "独立开发者, AI Coding 用户, 正在做出海产品的程序员",
    competitors: "提升互动质量, 增加关注者, 沉淀内容选题",
    painPoints: "AI Coding, 独立开发, 主动获客, 出海 SaaS",
    replyGoal: "先贡献一个可执行观点，让对方知道我长期记录 AI Coding 出海和主动获客，再引导关注或继续交流。",
    productContext: "我是 Ray，Java 后端开发者，正在分享 AI Coding、独立开发、主动获客和出海产品经验。回复里可以自然露出身份，但不要像广告。",
    leadInput: `X | AI 独立开发者 |  | 用 AI Coding 做完产品但上线后 0 流量，想知道怎么找到第一批用户
X | Cursor 用户 |  | 用 Cursor 做了一个小工具，但不知道怎么验证需求
X | SaaS 开发者 |  | 产品上线后没有流量，想知道怎么获得第一批用户`,
  },
};
const navItems = ["信号", "评分", "草稿", "执行"];

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

const dashboardTabs: Array<{ value: DashboardTab; label: string; shortLabel: string; icon: ReactNode }> = [
  { value: "overview", label: "总览", shortLabel: "总览", icon: <HomeIcon className="h-5 w-5" /> },
  { value: "search", label: "定位找人", shortLabel: "找人", icon: <Search className="h-5 w-5" /> },
  { value: "account", label: "账号雷达", shortLabel: "雷达", icon: <Radar className="h-5 w-5" /> },
  { value: "engage", label: "互动队列", shortLabel: "互动", icon: <MessageSquareText className="h-5 w-5" /> },
];

function dashboardTabLabel(tab: DashboardTab) {
  return dashboardTabs.find((item) => item.value === tab)?.label ?? "总览";
}
export default function Home() {
  const [mode, setMode] = useState<Mode>("growth");
  const [activeTab, setActiveTab] = useState<DashboardTab>("overview");
  const [forms, setForms] = useState<Record<Mode, FormState>>(initialState);
  const [grokBridge, setGrokBridge] = useState<GrokBridgeState>(DEFAULT_GROK_BRIDGE_STATE);
  const [signals, setSignals] = useState<SignalState>(DEFAULT_SIGNAL_STATE as SignalState);
  const [aiScores, setAiScores] = useState<AiScoreState>(DEFAULT_AI_SCORE_STATE as AiScoreState);
  const [aiDrafts, setAiDrafts] = useState<AiDraftState>(DEFAULT_AI_DRAFT_STATE as AiDraftState);
  const [growthMemory, setGrowthMemory] = useState<GrowthMemoryState>(DEFAULT_GROWTH_MEMORY_STATE as GrowthMemoryState);
  const [isWorkbenchReady, setIsWorkbenchReady] = useState(false);
  const [busyOverlay, setBusyOverlay] = useState<BusyOverlayState>(null);

  useEffect(() => {
    try {
      const restored = parseStoredWorkbenchState(window.localStorage.getItem(WORKBENCH_STORAGE_KEY), {
        version: CURRENT_VERSION,
        mode: "growth",
        forms: initialState,
        grokBridge: DEFAULT_GROK_BRIDGE_STATE,
        signals: DEFAULT_SIGNAL_STATE,
        aiScores: DEFAULT_AI_SCORE_STATE,
        aiDrafts: DEFAULT_AI_DRAFT_STATE,
        growthMemory: DEFAULT_GROWTH_MEMORY_STATE,
      });
      setMode(restored.mode as Mode);
      setForms(migrateStoredForms(restored.forms as Record<Mode, FormState>));
      setGrokBridge(restored.grokBridge as GrokBridgeState);
      setSignals(repairAutoFeedbackState(restored.signals as SignalState));
      setAiScores(restored.aiScores as AiScoreState);
      setAiDrafts(restored.aiDrafts as AiDraftState);
      setGrowthMemory(restored.growthMemory as GrowthMemoryState);
    } finally {
      setIsWorkbenchReady(true);
    }
  }, []);

  useEffect(() => {
    function reloadFromExtensionSync() {
      const restored = parseStoredWorkbenchState(window.localStorage.getItem(WORKBENCH_STORAGE_KEY), {
        version: CURRENT_VERSION,
        mode: "growth",
        forms: initialState,
        grokBridge: DEFAULT_GROK_BRIDGE_STATE,
        signals: DEFAULT_SIGNAL_STATE,
        aiScores: DEFAULT_AI_SCORE_STATE,
        aiDrafts: DEFAULT_AI_DRAFT_STATE,
        growthMemory: DEFAULT_GROWTH_MEMORY_STATE,
      });
      setMode(restored.mode as Mode);
      setForms(migrateStoredForms(restored.forms as Record<Mode, FormState>));
      setGrokBridge(restored.grokBridge as GrokBridgeState);
      setSignals(repairAutoFeedbackState(restored.signals as SignalState));
      setAiScores(restored.aiScores as AiScoreState);
      setAiDrafts(restored.aiDrafts as AiDraftState);
      setGrowthMemory(restored.growthMemory as GrowthMemoryState);
      showToast("插件同步的反馈已更新到页面。", "success");
    }

    window.addEventListener("ray-growth-os:extension-sync", reloadFromExtensionSync);
    return () => window.removeEventListener("ray-growth-os:extension-sync", reloadFromExtensionSync);
  }, []);

  useEffect(() => {
    if (!isWorkbenchReady) return;

    try {
      window.localStorage.setItem(
        WORKBENCH_STORAGE_KEY,
        serializeWorkbenchState({
          mode,
          forms,
          grokBridge,
          signals,
          aiScores,
          aiDrafts,
          growthMemory,
        })
      );
    } catch {
      // localStorage can fail in private mode or when the browser quota is full.
    }
  }, [aiDrafts, aiScores, forms, grokBridge, growthMemory, isWorkbenchReady, mode, signals]);
  const current = forms[mode];
  const copy = modeCopy[mode];
  const workflowLeadInput = useMemo(
    () => mergeLeadInputWithSignals(current.leadInput, signals[mode] ?? []),
    [current.leadInput, mode, signals]
  );

  const localResult = useMemo((): WorkbenchResult => {
    if (mode === "outbound") {
      const workflow = runOutboundWorkflow(
        {
          name: current.productName,
          description: current.description,
          targetCustomer: current.targetCustomer,
          competitors: current.competitors,
          painPoints: current.painPoints,
        },
        workflowLeadInput
      ) as { queries: Query[]; leads: OutboundLead[] };
      return { mode: "outbound", ...workflow };
    }

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
    return { mode: "growth", ...workflow };
  }, [current, mode, workflowLeadInput]);

  const scoredResult = useMemo(() => applyAiScoreOverrides(localResult, aiScores[mode]) as WorkbenchResult, [aiScores, localResult, mode]);
  const memoryAdjustedResult = useMemo(() => applyGrowthMemoryToQueueItems(scoredResult, growthMemory) as WorkbenchResult, [growthMemory, scoredResult]);
  const result = useMemo(() => applyAiDraftOverrides(memoryAdjustedResult, aiDrafts[mode]) as WorkbenchResult, [aiDrafts, mode, memoryAdjustedResult]);
  const scoreSourceItems: QueueItem[] = localResult.mode === "outbound" ? localResult.leads : localResult.opportunities;
  const draftSourceItems: QueueItem[] = memoryAdjustedResult.mode === "outbound" ? memoryAdjustedResult.leads : memoryAdjustedResult.opportunities;
  const items: QueueItem[] = result.mode === "outbound" ? result.leads : result.opportunities;
  const hotCount = items.filter((item) => item.label === (result.mode === "outbound" ? "High intent" : "Engage now")).length;
  const draftCount = result.mode === "outbound" ? result.leads.length : result.opportunities.length * 3;
  const averageScore = items.length ? Math.round(items.reduce((sum, item) => sum + item.score, 0) / items.length) : 0;
  const topItem = items[0];
  const signalByKey = useMemo(() => {
    const map = new Map<string, Signal>();
    for (const signal of signals[mode] ?? []) {
      map.set(signalDedupKey(signal), signal);
    }
    return map;
  }, [mode, signals]);
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

  function saveCurrentWorkbench() {
    if (!isWorkbenchReady) {
      showToast("工作台还在加载，请稍后再保存。", "info");
      return;
    }

    try {
      window.localStorage.setItem(
        WORKBENCH_STORAGE_KEY,
        serializeWorkbenchState({
          mode,
          forms,
          grokBridge,
          signals,
          aiScores,
          aiDrafts,
          growthMemory,
        })
      );
      showToast("已保存当前定位。", "success");
    } catch {
      showToast("保存失败：浏览器禁止访问本地存储，请检查隐私模式或站点权限。", "error");
    }
  }

  async function runAiProfileAutofill(): Promise<AiProfileRunResult> {
    const xProfileConfig = loadXProfileConfig();
    if (!xProfileConfig.profileUrl.trim()) {
      throw new Error("请先到设置页保存 X 主页地址，再让 AI 帮你生成定位。");
    }

    const aiConfig = loadAiResponseConfig();
    if (!aiConfig.apiKey.trim()) {
      throw new Error("请先到设置页配置 GPT-5.5 / codeproxy 密钥，再用 AI 生成定位。");
    }

    const response = await fetch("/api/profile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode,
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
      }),
    });
    const data = (await response.json().catch(() => ({ message: "AI 定位生成请求失败。" }))) as ProfileApiResponse;

    if (!response.ok || !data.ok || !data.profile) {
      throw new Error(data.message || "AI 定位生成失败，请稍后再试。");
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

    const header = ["平台", "名称", "链接", "分数", "标签", "动作", "原因", "备注", "回复", "引用", "选题"];
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
        .map((item, index) => `${index + 1}. ${item.name}\n直接回复：${item.replyDraft}\n引用转发：${item.quoteDraft}\n内容选题：${item.postIdea}`)
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
          body: JSON.stringify({ ...payload, apiKey: aiConfig.apiKey, model: aiConfig.model }),
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
              body: JSON.stringify({ ...payload, items: [item], apiKey: aiConfig.apiKey, model: aiConfig.model }),
            });
            const data = (await response.json().catch(() => ({ message: "AI 草稿生成请求失败。" }))) as DraftApiResponse;

            if (!response.ok || !data.ok || !Array.isArray(data.drafts)) {
              throw new Error(data.message || "AI 草稿生成失败，已保留本地规则草稿。");
            }

            if (data.model) resolvedModel = data.model;
            const generatedAt = new Date().toISOString();
            const nextDrafts = Object.fromEntries(data.drafts.map((draft) => [draft.itemId, { ...draft, model: data.model || resolvedModel, generatedAt }]));
            const generatedCount = Object.keys(nextDrafts).length;

            if (generatedCount === 0) {
              failedItems.push(displayName);
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
          throw new Error("AI 草稿生成没有成功保存任何结果。可以稍后重试，或先少选几条再跑。");
        }

        return { count: savedCount, model: resolvedModel, failedCount: failedItems.length };
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

  async function runGrowthMemoryLearning(): Promise<GrowthMemoryRunResult> {
    const payload = buildGrowthMemoryRequestInput({
      mode,
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
    });

    if (payload.samples.length === 0) {
      throw new Error("还没有可学习的反馈样本。先在互动队列里标记有回复、无回复、被关注或被转发。");
    }

    const aiConfig = loadAiResponseConfig();
    if (!aiConfig.apiKey.trim()) {
      throw new Error("请先到设置页面配置 GPT-5.5 / codeproxy 密钥，再生成增长记忆。");
    }

    const response = await fetch("/api/memory", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...payload, apiKey: aiConfig.apiKey, model: aiConfig.model }),
    });
    const data = (await response.json().catch(() => ({ message: "增长记忆生成请求失败。" }))) as GrowthMemoryApiResponse;

    if (!response.ok || !data.ok || !data.memory) {
      throw new Error(data.message || "增长记忆生成失败，请稍后再试。");
    }

    const nextMemory = normalizeGrowthMemoryState(data.memory) as GrowthMemoryState;
    setGrowthMemory(nextMemory);
    return { count: nextMemory.sampleCount, model: data.model || "AI" };
  }

  function applyGrowthMemory() {
    setGrowthMemory((previous) => normalizeGrowthMemoryState({ ...previous, active: true, appliedAt: new Date().toISOString() }) as GrowthMemoryState);
  }

  function pauseGrowthMemory() {
    setGrowthMemory((previous) => normalizeGrowthMemoryState({ ...previous, active: false }) as GrowthMemoryState);
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
    const backup = createWorkbenchBackup({ mode, forms, grokBridge, signals, aiScores, aiDrafts, growthMemory });
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
    });

    if (!restored.ok || !restored.state) {
      return { ok: false, message: "备份文件不是有效的 Ray Growth OS JSON。" };
    }

    setMode(restored.state.mode as Mode);
    setForms(restored.state.forms as Record<Mode, FormState>);
    setGrokBridge(restored.state.grokBridge as GrokBridgeState);
    setSignals(restored.state.signals as SignalState);
    setAiScores(restored.state.aiScores as AiScoreState);
    setAiDrafts(restored.state.aiDrafts as AiDraftState);
    setGrowthMemory(restored.state.growthMemory as GrowthMemoryState);
    return { ok: true, message: "已恢复本地备份，当前模式、输入和 Signal 数据已更新。" };
  }
  return (
    <main className="tech-shell surface-grid relative flex h-screen overflow-hidden text-foreground">
      <ActionToastHost />
      {busyOverlay ? <LongTaskOverlay title={busyOverlay.title} message={busyOverlay.message} detail={busyOverlay.detail} /> : null}
      <DashboardSidebar activeTab={activeTab} setActiveTab={setActiveTab} />

      <div className="relative z-10 flex min-w-0 flex-1 flex-col">
        <DashboardTopbar
          activeTab={activeTab}
          mode={mode}
          setMode={setMode}
          urgentCount={hotCount}
          downloadCsv={downloadCsv}
        />

        <section key={activeTab} className="min-h-0 flex-1 overflow-y-auto px-4 py-4 pb-24 md:px-6 md:pb-6 lg:px-8">
          <div className="mx-auto grid max-w-[1480px] animate-fade-in-up gap-4">
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
                applyGrowthMemory={applyGrowthMemory}
                pauseGrowthMemory={pauseGrowthMemory}
                clearGrowthMemory={clearGrowthMemory}
                growthMemory={growthMemory}
                executionStats={executionStats}
                recentProcessedSignals={recentProcessedSignals}
                signals={signals[mode] ?? []}
              />
            ) : null}


          </div>
        </section>
      </div>

      <MobileDashboardNav activeTab={activeTab} setActiveTab={setActiveTab} />
    </main>
  );
}

function DashboardSidebar({ activeTab, setActiveTab }: { activeTab: DashboardTab; setActiveTab: Dispatch<SetStateAction<DashboardTab>> }) {
  return (
    <aside className="group/sidebar relative z-20 hidden h-screen w-16 shrink-0 overflow-hidden border-r border-white/[0.08] bg-[#08090d]/95 pl-3 pr-2 pb-20 backdrop-blur-xl transition-[width] duration-300 ease-out hover:w-44 md:flex md:flex-col md:items-start md:gap-2 md:pt-4">
      <div className="grid h-10 w-10 place-items-center rounded-lg border border-white/[0.08] bg-white/[0.045] text-white transition-transform duration-200 hover:scale-105 [&_svg]:transition-transform [&_svg]:duration-200 hover:[&_svg]:scale-125">
        <Command className="h-5 w-5" />
      </div>
      <nav className="mt-4 grid gap-2">
        {dashboardTabs.map((tab) => (
          <button
            key={tab.value}
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
        ))}
      </nav>
      <Link
        href="/settings"
        aria-label="设置"
        title="设置"
        className="mt-auto mb-4 flex h-11 w-10 items-center justify-center gap-3 overflow-hidden rounded-lg border border-blue-300/25 bg-blue-400/12 px-0 text-blue-100 shadow-lg shadow-blue-500/10 transition-all duration-200 hover:scale-105 hover:border-blue-200/45 hover:bg-blue-400/20 hover:text-white active:scale-95 group-hover/sidebar:w-36 group-hover/sidebar:justify-start group-hover/sidebar:px-3 [&_svg]:shrink-0 [&_svg]:transition-transform [&_svg]:duration-200 hover:[&_svg]:scale-125 active:[&_svg]:scale-110"
      >
        <Settings className="h-5 w-5" />
        <span className="hidden min-w-0 truncate text-sm font-bold opacity-0 transition-opacity duration-200 group-hover/sidebar:block group-hover/sidebar:opacity-100">设置</span>
      </Link>
    </aside>
  );
}

function MobileDashboardNav({ activeTab, setActiveTab }: { activeTab: DashboardTab; setActiveTab: Dispatch<SetStateAction<DashboardTab>> }) {
  return (
    <nav className="fixed inset-x-3 bottom-3 z-50 grid grid-cols-5 rounded-lg border border-white/[0.08] bg-[#08090d]/90 p-1 shadow-2xl shadow-black/40 backdrop-blur-xl md:hidden">
      {dashboardTabs.map((tab) => (
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
    </nav>
  );
}

function DashboardTopbar({
  activeTab,
  mode,
  setMode,
  urgentCount,
  downloadCsv,
}: {
  activeTab: DashboardTab;
  mode: Mode;
  setMode: (mode: Mode) => void;
  urgentCount: number;
  downloadCsv: () => void;
}) {
  return (
    <header className="relative z-20 flex h-auto shrink-0 flex-col gap-3 border-b border-white/[0.07] bg-[#08090d]/90 px-4 py-3 backdrop-blur-xl md:h-16 md:flex-row md:items-center md:justify-between md:px-6 lg:px-8">
      <div className="flex min-w-0 items-center gap-3">
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-white/[0.08] bg-white/[0.045] text-white md:hidden">
          <Command className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate text-sm font-black text-white">Ray Growth OS</p>
            <Badge variant="outline" className="rounded-md border-white/[0.08] bg-white/[0.04] text-white/50">本地 MVP</Badge>
          </div>
          <p className="mt-1 text-xs font-semibold uppercase tracking-wide text-white/40">{dashboardTabLabel(activeTab)}</p>
        </div>
      </div>

      <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:flex-nowrap">
        <Tabs value={mode} onValueChange={(value) => setMode(value as Mode)} className="w-full sm:w-auto">
          <TabsList className="grid h-9 w-full grid-cols-2 rounded-lg border border-white/[0.08] bg-white/[0.04] sm:w-[250px]">
            <TabsTrigger value="outbound" className="rounded-md text-xs text-white/60 data-[state=active]:bg-white/[0.08] data-[state=active]:text-white">
              <Radar className="h-3.5 w-3.5" /> 主动获客
            </TabsTrigger>
            <TabsTrigger value="growth" className="rounded-md text-xs text-white/60 data-[state=active]:bg-white/[0.08] data-[state=active]:text-white">
              <Users className="h-3.5 w-3.5" /> 受众增长
            </TabsTrigger>
          </TabsList>
        </Tabs>
        <Button variant="outline" size="sm" onClick={downloadCsv} className="tech-secondary h-9">
          <Download className="h-4 w-4" /> CSV
        </Button>
        <Badge variant="outline" className="h-9 rounded-lg border-amber-300/15 bg-amber-400/10 px-3 text-amber-100">
          {urgentCount} 个紧急动作
        </Badge>
      </div>
    </header>
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
  const queueCount = result.mode === "outbound" ? result.leads.length : result.opportunities.length;
  const overviewStages: Array<{ label: string; value: number; detail: string; help: string; targetTab: DashboardTab }> = [
    { label: "定位找人", value: result.queries.length, detail: "账号 + Grok", help: "填清楚定位，用 Grok 搜公开讨论并导入互动队列。", targetTab: "search" },
    { label: "账号雷达", value: queueCount, detail: "竞品 / KOL", help: "输入竞品、KOL 或目标用户账号，围绕它的受众挖可互动线索。", targetTab: "account" },
    { label: "互动队列", value: queueCount, detail: "评分 + 草稿 + 执行", help: "在一个队列里看优先级、运行 AI 评分/草稿、打开来源并标记处理结果。", targetTab: "engage" },
  ];

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1.28fr)_410px]">
      <div className="hero-card relative overflow-hidden rounded-lg border text-white shadow-soft">
        <div className="relative z-10 grid min-h-[560px] gap-7 p-5 lg:p-7">
          <div className="grid gap-6">
            <div className="flex flex-wrap items-center gap-2">
              <Badge className="rounded-md border-emerald-300/20 bg-emerald-400/10 text-emerald-100">{copy.badge}</Badge>
              <Badge variant="outline" className="rounded-md border-blue-300/15 bg-blue-400/10 text-blue-100">
                <Sparkles className="mr-1 h-3.5 w-3.5" /> AI 工作流
              </Badge>
            </div>

            <div className="max-w-4xl space-y-4">
              <h2 className="text-4xl font-black leading-[1.04] text-white sm:text-5xl lg:text-[3.5rem]">
                把 X 上的讨论变成 <span className="gradient-text">粉丝增长。</span>
              </h2>
              <p className="max-w-[640px] text-sm leading-6 text-slate-300 sm:text-base">{copy.heroDescription}</p>
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
  const loopSteps: Array<{ label: string; value: number; detail: string; icon: ReactNode; targetTab: DashboardTab }> = [
    { label: "填定位", value: result.queries.length, detail: "生成 Grok Prompt", icon: <Target className="h-5 w-5" />, targetTab: "search" },
    { label: "找讨论", value: queueCount, detail: "导入 X 结果", icon: <Radar className="h-5 w-5" />, targetTab: "search" },
    { label: "挖账号", value: queueCount, detail: "竞品/KOL", icon: <Users className="h-5 w-5" />, targetTab: "account" },
    { label: "AI 排序", value: averageScore, detail: "平均优先级", icon: <Gauge className="h-5 w-5" />, targetTab: "engage" },
    { label: "去互动", value: hotCount, detail: "高分未执行", icon: <MessageSquareText className="h-5 w-5" />, targetTab: "engage" },
  ];
  const queryPreview = result.queries.slice(0, 3);

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
      <div className="relative overflow-hidden rounded-lg border border-white/[0.06] bg-white/[0.018] p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-white/40">增长闭环</p>
            <p className="mt-1 text-sm font-semibold text-white">从找人到回复，不再分散在几个页面里。</p>
          </div>
          <Badge variant="outline" className="rounded-md border-emerald-500/10 bg-emerald-500/10 text-emerald-200">今日工作台</Badge>
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
            <p className="text-xs font-bold uppercase tracking-wide text-white/40">Grok 会搜什么</p>
            <p className="mt-1 text-sm font-semibold text-white">根据定位自动生成</p>
          </div>
          <Button type="button" size="sm" variant="ghost" className="text-blue-100 hover:bg-blue-400/10 hover:text-white" onClick={() => setActiveTab("search")}>去调整</Button>
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
}: {
  variant?: "search" | "account";
  mode: Mode;
  copy: ModeContent;
  current: FormState;
  updateField: (field: keyof FormState, value: string) => void;
  onGenerateProfile: () => Promise<AiProfileRunResult>;
  onSaveProfile: () => void;
  grokBridge: GrokBridgeState;
  setGrokBridge: Dispatch<SetStateAction<GrokBridgeState>>;
  modeSignals: Signal[];
  setModeSignals: (signals: Signal[]) => void;
  exportBackup: () => void;
  restoreBackupText: (rawText: string) => { ok: boolean; message: string };
  growthMemory: GrowthMemoryState;
}) {
  const flowSteps = [
    { label: "1 填写定位", detail: "产品/账号、目标用户、痛点" },
    { label: "2 去 Grok 找人", detail: "复制 Prompt 或中转查询" },
    { label: "3 导入结果", detail: "粘贴 X 结果并去重" },
    { label: "4 互动队列", detail: "评分、草稿和执行记录" },
  ];

  return (
    <div className="grid gap-4">
      <div className="grid gap-4 xl:grid-cols-[430px_minmax(0,1fr)]">
        <InputPanel mode={mode} copy={copy} current={current} updateField={updateField} onGenerateProfile={onGenerateProfile} onSaveProfile={onSaveProfile} />
        <div className="grid content-start gap-4">
          <Card className="overflow-hidden border border-white/[0.08] bg-white/[0.03] text-white shadow-2xl shadow-blue-500/5 backdrop-blur-md">
            <CardHeader className="border-b border-white/[0.08] bg-[#0d0d10]/70">
              <Badge variant="outline" className="w-fit rounded-md border-blue-500/10 bg-blue-500/10 text-blue-200"><Radar className="mr-1 h-3.5 w-3.5" /> 定位找人流程</Badge>
              <CardTitle className="mt-3 text-xl text-white">先填定位，再用 Grok 找真实 X 用户</CardTitle>
              <CardDescription className="mt-2 text-white/55">定位会自动生成 Grok Prompt；找到结果后直接进入互动队列。</CardDescription>
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

          <GrokBridgePanel variant="search" mode={mode} current={current} updateField={updateField} grokBridge={grokBridge} setGrokBridge={setGrokBridge} modeSignals={modeSignals} setModeSignals={setModeSignals} growthMemory={growthMemory} />
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
  applyGrowthMemory,
  pauseGrowthMemory,
  clearGrowthMemory,
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
  runGrowthMemoryLearning: () => Promise<GrowthMemoryRunResult>;
  applyGrowthMemory: () => void;
  pauseGrowthMemory: () => void;
  clearGrowthMemory: () => void;
  growthMemory: GrowthMemoryState;
  executionStats: ExecutionStats;
  recentProcessedSignals: Signal[];
  signals: Signal[];
}) {
  const [engageView, setEngageView] = useState<"queue" | "feedback" | "memory" | "stats">("queue");
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
  const filteredItems = items.filter((item) => {
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
  const ownAccountItems = useMemo(() => items.filter((item) => signalMatchesOwnAccount(item, ownAccountIdentity)), [items, ownAccountIdentity]);
  const visibleKeys = pagedItems.map((item) => queueItemSignalKey(item));
  const allVisibleSelected = visibleKeys.length > 0 && visibleKeys.every((key) => selectedKeySet.has(key));
  const allItemsSelected = pagedItems.length > 0 && pagedItems.every((item) => selectedKeySet.has(queueItemSignalKey(item)));
  const contextItem = contextMenu ? items.find((item) => queueItemSignalKey(item) === contextMenu.key) : undefined;
  const contextUsesSelection = Boolean(contextMenu && selectedKeySet.has(contextMenu.key) && selectedItems.length > 0);
  const contextActionCount = contextUsesSelection ? selectedItems.length : contextItem ? 1 : selectedItems.length;
  const processOptions: Array<FilterOption<ProcessFilterKey>> = [
    { key: "all", label: "全部", count: items.length },
    { key: "pending", label: "未处理", count: items.filter((item) => itemStatus(item) === "new").length },
    { key: "processed", label: "已处理", count: items.filter((item) => itemStatus(item) !== "new").length },
    { key: "engaged", label: "已互动", count: items.filter((item) => isEngagedStatus(itemStatus(item))).length },
    { key: "saved", label: "已收藏", count: items.filter((item) => itemStatus(item) === "saved").length },
    { key: "deferred", label: "搁置", count: items.filter((item) => itemStatus(item) === "deferred").length },
    { key: "skipped", label: "跳过", count: items.filter((item) => itemStatus(item) === "skipped").length },
  ];
  const feedbackFilterOptions: Array<FilterOption<SignalFeedbackStatus>> = [
    { key: "all", label: "全部", count: items.length },
    { key: "none", label: "未拉取", count: items.filter((item) => itemFeedback(item) === "none").length },
    { key: "got_reply", label: "有回复", count: items.filter((item) => itemFeedback(item) === "got_reply").length },
    { key: "no_reply", label: "无回复", count: items.filter((item) => itemFeedback(item) === "no_reply").length },
    { key: "followed", label: "被关注", count: items.filter((item) => itemFeedback(item) === "followed").length },
    { key: "reshared", label: "被转发", count: items.filter((item) => itemFeedback(item) === "reshared").length },
  ];
  const priorityOptions: Array<FilterOption<PriorityFilterKey>> = [
    { key: "all", label: "全部", count: items.length },
    { key: "hot", label: mode === "outbound" ? "高意向" : "立即互动", count: items.filter((item) => item.label === hotLabel).length },
    { key: "warm", label: mode === "outbound" ? "跟进观察" : "观察", count: items.filter((item) => item.label === warmLabel).length },
    { key: "low", label: "低评分", count: items.filter((item) => item.label !== hotLabel && item.label !== warmLabel).length },
  ];
  const priorityFilterSignature = priorityFilters.join("|");
  const processFilterSignature = processFilters.join("|");
  const feedbackFilterSignature = feedbackFilters.join("|");
  const engageViews: Array<{ key: typeof engageView; label: string; description: string; icon: ReactNode; stat: string }> = [
    { key: "queue", label: "互动列表", description: "筛选、评分、生成草稿、批量处理。", icon: <MessageSquareText className="h-4 w-4" />, stat: `${filteredItems.length} 条` },
    { key: "feedback", label: "反馈复盘", description: "看有回复、无回复、关注和转发结果。", icon: <Activity className="h-4 w-4" />, stat: `${executionStats.feedbackToday} 今日` },
    { key: "memory", label: "增长记忆", description: "让反馈反过来调整评分和关键词。", icon: <Sparkles className="h-4 w-4" />, stat: growthMemory.active ? "已应用" : "未应用" },
    { key: "stats", label: "执行统计", description: "查看处理量、正反馈和最近动作。", icon: <Gauge className="h-4 w-4" />, stat: `${executionStats.processed}/${executionStats.total}` },
  ];

  useEffect(() => {
    setQueuePage(1);
    setSelectedKeys([]);
    setExpandedKey("");
  }, [priorityFilterSignature, processFilterSignature, feedbackFilterSignature, mode]);

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
                当前页 {pageStartDisplay}-{pageEnd} / 筛选后 {filteredItems.length} / 全部 {items.length}
              </div>
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
            }) : (
              <div className="rounded-lg border border-white/[0.08] bg-white/[0.025] p-8 text-center text-sm text-white/45">当前筛选下没有条目，可以放宽处理状态、反馈状态或优先级筛选。</div>
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
          onApplyMemory={applyGrowthMemory}
          onPauseMemory={pauseGrowthMemory}
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
          <div className={cn("grid gap-3", isOutbound ? "" : "xl:grid-cols-3")}>
            {isOutbound ? (
              <DraftBlock icon={<MessageSquareText className="h-4 w-4" />} title="私信开场" description="发给这个潜在线索的第一句话。" value={outboundItem.draft} source={draftSourceForItem(item)} />
            ) : (
              <>
                <DraftBlock icon={<MessageSquareText className="h-4 w-4" />} title="直接回复" description="发到原帖或评论下面，用来先建立互动。" value={growthItem.replyDraft} source={draftSourceForItem(item)} />
                <DraftBlock icon={<Quote className="h-4 w-4" />} title="引用转发" description="引用这条内容再发表自己的观点。" value={growthItem.quoteDraft} source={draftSourceForItem(item)} />
                <DraftBlock icon={<Lightbulb className="h-4 w-4" />} title="内容选题" description="把这个信号延展成你自己的原创帖。" value={growthItem.postIdea} source={draftSourceForItem(item)} />
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
function TopBar({ mode, setMode, copyQueries, downloadCsv }: { mode: Mode; setMode: (mode: Mode) => void; copyQueries: () => void; downloadCsv: () => void }) {
  return (
    <header className="glass-nav fade-up sticky top-3 z-50 flex flex-col gap-3 rounded-lg border p-3 shadow-soft backdrop-blur lg:flex-row lg:items-center lg:justify-between">
      <div className="flex min-w-0 items-center gap-3">
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-slate-950 text-white shadow-sm">
          <Command className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-base font-bold leading-none text-slate-950">Ray Growth OS</h1>
            <Badge variant="secondary" className="rounded-md border border-slate-200 bg-slate-100 text-slate-700">
              本地 MVP
            </Badge>
          </div>
          <div className="mt-2 hidden flex-wrap items-center gap-1.5 text-xs font-semibold text-slate-500 sm:flex">
            {navItems.map((item) => (
              <span key={item} className="rounded-md border border-slate-200 bg-white px-2 py-1">
                {item}
              </span>
            ))}
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between lg:justify-end">
        <Tabs value={mode} onValueChange={(value) => setMode(value as Mode)} className="sm:w-auto">
          <TabsList className="grid h-11 w-full grid-cols-2 rounded-md border border-slate-200 bg-slate-100 sm:w-[290px]">
            <TabsTrigger value="outbound" className="rounded-[6px]">
              <Radar className="h-4 w-4" /> 主动获客
            </TabsTrigger>
            <TabsTrigger value="growth" className="rounded-[6px]">
              <Users className="h-4 w-4" /> 受众增长
            </TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="flex gap-2">
          <Button variant="outline" onClick={copyQueries} className="tech-secondary flex-1 hover:shadow-[0_0_15px_rgba(255,255,255,0.03)] sm:flex-none">
            <Copy className="h-4 w-4" /> Grok 提示词
          </Button>
          <Button onClick={downloadCsv} className="tech-cta flex-1 hover:shadow-[0_0_15px_rgba(255,255,255,0.03)] sm:flex-none">
            <Download className="h-4 w-4" /> 导出 CSV
          </Button>
        </div>
      </div>
    </header>
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
  onGenerateProfile?: () => Promise<AiProfileRunResult>;
  onSaveProfile?: () => void;
}) {
  const [profileState, setProfileState] = useState<"idle" | "loading" | "error">("idle");
  const [profileMessage, setProfileMessage] = useState("AI 生成后可以先调整字段，再点保存当前定位。");

  async function generateProfile() {
    if (!onGenerateProfile) return;
    setProfileState("loading");
    setProfileMessage("正在根据 X 主页和当前内容生成定位草稿...");

    try {
      const result = await onGenerateProfile();
      setProfileState("idle");
      const successMessage = `已用 ${result.model} 生成定位草稿，并回填到下面字段。${result.profile.reasoning ? `依据：${result.profile.reasoning}` : ""}`;
      setProfileMessage(successMessage);
      showToast("AI 已生成定位草稿。", "success");
    } catch (error) {
      setProfileState("error");
      const errorMessage = error instanceof Error ? error.message : "AI 定位生成失败，请稍后再试。";
      setProfileMessage(errorMessage);
      showToast(errorMessage, "error");
    }
  }

  return (
    <Card className="fade-up delay-3 overflow-hidden border-slate-200 bg-white xl:sticky xl:top-20 xl:self-start">
      <CardHeader className="border-b border-slate-200 bg-white">
        <div className="flex items-start justify-between gap-3">
          <div>
            <Badge variant="secondary" className="rounded-md bg-slate-100 text-slate-700">{copy.badge}</Badge>
            <CardTitle className="mt-3 text-xl">{mode === "outbound" ? "第 1 步：填写产品定位" : "第 1 步：填写账号定位"}</CardTitle>
            <CardDescription className="mt-2 leading-6">{copy.description}</CardDescription>
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
                <p className="text-sm font-black text-slate-950">不知道怎么填？</p>
                <p className="mt-1 text-xs leading-5 text-slate-600">先在 <Link href="/settings" className="font-bold text-blue-700 underline-offset-2 hover:underline">设置</Link> 里保存 X 主页地址，再让 AI 帮你生成一版初稿。</p>
              </div>
              <div className="flex shrink-0 flex-col gap-2 sm:flex-row">
                <Button type="button" className="bg-[#3B82F6] text-white hover:bg-blue-500" onClick={() => void generateProfile()} disabled={profileState === "loading"}>
                  {profileState === "loading" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />} AI 帮我生成
                </Button>
                {onSaveProfile ? (
                  <Button type="button" variant="outline" className="border-blue-200 bg-white text-blue-700 hover:bg-blue-50 hover:text-blue-800" onClick={onSaveProfile}>
                    保存当前定位
                  </Button>
                ) : null}
              </div>
            </div>
            <p className={cn("mt-2 text-xs leading-5", profileState === "error" ? "text-rose-700" : "text-blue-700")}>{profileMessage}</p>
          </div>
        ) : null}
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
          <Field label={copy.primaryLabel}>
            <Input value={current.productName} onChange={(event) => updateField("productName", event.target.value)} />
          </Field>
          <Field label={copy.secondaryLabel}>
            <Input value={current.competitors} onChange={(event) => updateField("competitors", event.target.value)} />
          </Field>
        </div>
        <Field label={copy.descriptionLabel}>
          <Textarea rows={4} value={current.description} onChange={(event) => updateField("description", event.target.value)} />
        </Field>
        <Field label={copy.targetLabel}>
          <Textarea rows={3} value={current.targetCustomer} onChange={(event) => updateField("targetCustomer", event.target.value)} />
        </Field>
        <Field label={copy.pillarLabel}>
          <Textarea rows={3} value={current.painPoints} onChange={(event) => updateField("painPoints", event.target.value)} />
        </Field>
        <div className="rounded-lg border border-blue-200/70 bg-blue-50 p-3 shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-black uppercase tracking-wide text-slate-950">回复策略</p>
              <p className="mt-1 text-xs leading-5 text-slate-600">这会进入 GPT-5.5 草稿 Prompt，用来决定是否露出产品/身份，以及这次互动想达成什么。</p>
            </div>
            <Bot className="h-4 w-4 shrink-0 text-blue-600" />
          </div>
          <div className="mt-3 grid gap-3">
            <Field label="互动目的 / 下一步">
              <Textarea rows={2} value={current.replyGoal} onChange={(event) => updateField("replyGoal", event.target.value)} placeholder="例如：先贡献观点，再引导对方关注、私聊或试用。" />
            </Field>
            <Field label="产品/身份露出方式">
              <Textarea rows={3} value={current.productContext} onChange={(event) => updateField("productContext", event.target.value)} placeholder="例如：我是 Ray，正在做/分享什么；什么时候可以自然提到，什么时候不要硬卖。" />
            </Field>
          </div>
        </div>
        <Field label={copy.candidateLabel}>
          <p className="text-xs leading-5 text-slate-500">这里是 Grok/X 结果导入后的线索池；第一次使用时先填上面的定位，再去 Grok 找人。</p>
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
  const { keywords, grokResult, accountResult, xProfileUrl } = grokBridge;
  const isAccountRadar = variant === "account";
  const activeResult = isAccountRadar ? accountResult : grokResult;
  const activeResultField: keyof GrokBridgeState = isAccountRadar ? "accountResult" : "grokResult";
  const [bridgeMessage, setBridgeMessage] = useState(isAccountRadar ? "输入竞品、KOL、社区账号或高价值目标用户账号，账号雷达会生成可导入的互动线索。" : "按左侧定位生成 Grok 搜索指令，找到公开讨论后导入互动队列。");
  const [bridgeState, setBridgeState] = useState<"idle" | "loading" | "error">("idle");
  const [isProxyConfigReady, setIsProxyConfigReady] = useState(false);
  const [proxyConfig, setProxyConfig] = useState<GrokProxyConfig>(() => normalizeGrokProxyConfig({}) as GrokProxyConfig);
  const [proxySearchResult, setProxySearchResult] = useState<GrokProxySearchResult | null>(null);
  const [isPromptOpen, setIsPromptOpen] = useState(false);
  const autoKeywords = useMemo(() => deriveGrokKeywords(current), [current]);
  const editableKeywords = keywords.trim() === LEGACY_DEFAULT_KEYWORDS ? "" : keywords;
  const manualKeywords = editableKeywords.trim();
  const memoryKeywords = growthMemoryKeywordText(growthMemory);
  const effectiveKeywords = [manualKeywords || autoKeywords, memoryKeywords].filter(Boolean).join(", ");
  const memoryPromptContext = buildGrowthMemoryPromptContext(growthMemory);
  const ownAccountIdentity = useMemo(() => buildOwnAccountIdentity(current, loadXProfileConfig().profileUrl), [current]);

  function updateGrokBridgeField(field: keyof GrokBridgeState, value: string) {
    setGrokBridge((previous) => ({
      ...previous,
      [field]: value,
    }));
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
      name: current.productName,
      description: current.description,
      targetCustomer: current.targetCustomer,
      goalsOrCompetitors: current.competitors,
      pillarsOrPainPoints: current.painPoints,
      keywords: effectiveKeywords,
    });

    const promptWithOwnFilter = basePrompt + ownAccountExclusionText(ownAccountIdentity);
    return memoryPromptContext ? promptWithOwnFilter + "\n\n上一轮增长记忆（用于筛选候选结果）：\n" + memoryPromptContext : promptWithOwnFilter;
  }, [current, effectiveKeywords, memoryPromptContext, mode, ownAccountIdentity]);

  const existingSignals = useMemo(() => {
    const manualSignals = parseSignalsFromText(current.leadInput, { source: "manual" }) as Signal[];
    return mergeSignals(manualSignals, modeSignals).signals as Signal[];
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
  const resultPreviewSignals = useMemo(() => importableGrokCandidates.slice(0, 4), [importableGrokCandidates]);
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
      setBridgeState("error");
      setProxySearchResult(null);
      setBridgeMessage("请先到设置页面配置 codeproxy / Grok 密钥，然后再使用账号雷达分析 X 账号。");
      return;
    }
    if (!profileUrl) {
      setBridgeState("error");
      setProxySearchResult(null);
      setBridgeMessage("请先填写要分析的竞品、KOL 或目标用户 X 账号，例如 https://x.com/competitor。");
      return;
    }

    setBridgeState("loading");
    setProxySearchResult(null);
    setBridgeMessage("正在分析公开 X 账号，围绕它的受众、评论区和相关讨论生成可互动线索。只会处理公开数据，不会读取私信或后台数据。");

    try {
      const response = await fetch("/api/grok", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "profile-pull",
          apiKey,
          model: latestConfig.model,
          prompt,
          profileUrl,
        }),
      });
      const data = (await response.json().catch(() => ({ message: "账号雷达分析失败。" }))) as GrokProxyApiResponse;

      if (!response.ok || !data.ok || !data.text) {
        throw new Error(data.message || "账号雷达分析失败。");
      }

      const structuredSignals = Array.isArray(data.signals) ? data.signals : [];
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
      const successMessage = `账号雷达已分析${usernameLabel}，并生成可导入的互动线索。${sourceCount ? `读取 ${sourceCount} 个公开数据源。` : ""}请确认预览结果，再导入互动队列。${warningLabel}`;
      setBridgeMessage(successMessage);
      showToast("账号雷达分析完成。", "success");
    } catch (error) {
      setBridgeState("error");
      setProxySearchResult(null);
      const errorMessage = error instanceof Error ? error.message : "账号雷达分析失败。";
      setBridgeMessage(errorMessage);
      showToast(errorMessage, "error");
    }
  }
  async function searchViaProxy() {
    const latestConfig = loadProxyConfig();
    const apiKey = latestConfig.apiKey.trim();
    if (!apiKey) {
      setBridgeState("error");
      setProxySearchResult(null);
      setBridgeMessage("请先到设置页面配置 codeproxy / Grok 密钥，然后再发起中转查询。");
      return;
    }

    setBridgeState("loading");
    setProxySearchResult(null);
    setBridgeMessage("Grok 查询中，请稍等。正在通过 codeproxy.dev 获取候选信号。");

    try {
      const response = await fetch("/api/grok", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "proxy-search",
          apiKey,
          model: latestConfig.model,
          prompt,
        }),
      });
      const data = (await response.json().catch(() => ({ message: "中转查询失败。" }))) as GrokProxyApiResponse;

      if (!response.ok || !data.ok || !data.text) {
        throw new Error(data.message || "中转查询失败。");
      }

      const structuredSignals = Array.isArray(data.signals) ? data.signals : [];
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
      setBridgeMessage("查询完成。请先确认预览结果，再决定是否导入互动队列。");
      showToast("Grok 查询完成。", "success");
    } catch (error) {
      setBridgeState("error");
      setProxySearchResult(null);
      const errorMessage = error instanceof Error ? error.message : "中转查询失败。";
      setBridgeMessage(errorMessage);
      showToast(errorMessage, "error");
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
      setBridgeMessage("没有解析到可导入的结果。建议让 Grok 按「X | 作者 | 链接 | 摘要」格式返回，每条一行。");
      return;
    }

    const merged = mergeSignals(existingSignals, candidates) as { signals: Signal[]; imported: Signal[]; duplicates: Signal[] };
    setModeSignals(merged.signals);
    if (merged.imported.length > 0) {
      updateField("leadInput", formatSignalsAsLeadInput(merged.signals));
    }

    setProxySearchResult(null);
    setBridgeState("idle");
    const excludedLabel = excludedOwnGrokCandidates.length ? "，排除自己账号 " + excludedOwnGrokCandidates.length + " 条" : "";
    const importMessage = "已解析 " + originalCount + " 条结果，导入 " + merged.imported.length + " 条，跳过重复 " + merged.duplicates.length + " 条" + excludedLabel + "。互动队列会自动更新。";
    setBridgeMessage(importMessage);
    showToast(importMessage, merged.imported.length > 0 ? "success" : "info");
  }

  return (
    <Card className="fade-up delay-4 overflow-hidden border border-white/[0.08] bg-white/[0.03] text-white shadow-2xl shadow-blue-500/5 backdrop-blur-md">
      <CardHeader className="flex-row items-start justify-between gap-3 space-y-0 border-b border-white/[0.08] bg-[#0d0d10]/70">
        <div>
          <Badge variant="outline" className="rounded-md border-blue-300/20 bg-blue-400/10 text-blue-100">
            {isAccountRadar ? <Radar className="mr-1 h-3.5 w-3.5" /> : <Sparkles className="mr-1 h-3.5 w-3.5" />} {isAccountRadar ? "账号雷达" : "Grok 找讨论"}
          </Badge>
          <CardTitle className="mt-3 text-xl text-white">{isAccountRadar ? "从竞品/KOL账号挖线索" : "用 Grok 找目标用户"}</CardTitle>
          <CardDescription className="mt-2 text-white/60">{isAccountRadar ? "单独输入一个公开 X 账号，围绕它的受众和讨论生成可导入的互动线索。" : "按定位生成 Prompt，去 Grok 找公开讨论；找到结果后导入互动队列。"}</CardDescription>
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
                <Badge variant="outline" className="rounded-md border-emerald-300/20 bg-emerald-400/10 text-emerald-100">账号雷达</Badge>
                <h3 className="mt-3 text-lg font-bold text-white">从竞品/KOL账号挖线索</h3>
                <p className="mt-2 text-sm leading-6 text-white/60">输入竞品、行业 KOL、社区账号或目标用户账号，围绕它的公开资料、受众语境和相关讨论生成可互动线索。</p>
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
              <Button className="tech-cta h-10" onClick={() => void pullXProfileViaProxy()} disabled={bridgeState === "loading"}>
                {bridgeState === "loading" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                分析账号并生成线索
              </Button>
            </div>
            <p className="text-xs leading-5 text-white/40">这是独立获客入口，适合输入竞品、KOL、社区账号或高价值目标用户，从他们的受众和讨论里挖出今天值得互动的人。</p>
            <AccountRadarOpportunityPanel current={current} profileUrl={xProfileUrl} pulledProfile={proxySearchResult?.pulledProfile ?? null} insight={proxySearchResult?.accountRadar ?? null} />
            {proxySearchResult?.pulledProfile ? (
              <div className="rounded-md border border-emerald-300/15 bg-[#0d0d10]/50 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline" className="rounded-md border-emerald-300/20 bg-emerald-400/10 text-emerald-100">账号雷达已分析</Badge>
                  {proxySearchResult.pulledProfile.username ? <span className="font-mono text-xs text-white/65">@{proxySearchResult.pulledProfile.username}</span> : null}
                  {typeof proxySearchResult.pulledProfile.textLength === "number" ? <span className="text-xs text-white/40">公开资料 {proxySearchResult.pulledProfile.textLength} 字，已用于挖线索</span> : null}
                </div>
                <p className="mt-2 text-xs leading-5 text-emerald-50/65">这些公开资料已经参与账号雷达分析；下面候选结果会变成可评分、可生成回复、可追踪反馈的互动队列。</p>
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
          <section className="grid gap-3 rounded-lg border border-blue-300/15 bg-blue-400/[0.045] p-4 lg:grid-cols-[minmax(0,1fr)_240px] lg:items-center">
            <div className="min-w-0">
              <Badge variant="outline" className="rounded-md border-blue-300/20 bg-blue-400/10 text-blue-100">Grok 找讨论</Badge>
              <h3 className="mt-3 text-lg font-bold text-white">按定位找公开讨论</h3>
              <p className="mt-2 text-sm leading-6 text-white/60">根据左侧定位生成搜索指令，去 Grok 找公开讨论；拿到结果后导入互动队列继续评分和生成回复。</p>
            </div>
            <Button className="tech-cta w-full justify-center" onClick={() => openGrok(true)} disabled={bridgeState === "loading"}>
              <Copy className="h-4 w-4" /> 复制 Prompt 并打开 Grok
            </Button>
          </section>
        )}
        <div className="grid gap-3 rounded-lg border border-white/[0.08] bg-white/[0.03] p-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className={cn("rounded-md", hasProxyKey ? "border-emerald-500/10 bg-emerald-500/10 text-emerald-300" : "border-amber-500/10 bg-amber-500/10 text-amber-300")}>
                {isProxyConfigReady ? (hasProxyKey ? "中转已配置" : "未配置中转密钥") : "读取配置中"}
              </Badge>
              <span className="truncate font-mono text-xs text-white/45">{effectiveProxyModel}</span>
            </div>
            <p className="mt-2 text-xs leading-5 text-white/45">{isAccountRadar ? "密钥配置已移到独立设置页。账号雷达会用它分析公开账号并生成线索。" : "密钥配置已移到独立设置页。主工作台只读取本地配置，用于发起中转查询和导入结果。"}</p>
          </div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-[auto_auto]">
            <Button asChild variant="outline" className="tech-secondary">
              <Link href="/settings">
                <Settings className="h-4 w-4" /> 配置中转
              </Link>
            </Button>
            {!isAccountRadar ? (
              <Button className="tech-cta" onClick={() => void searchViaProxy()} disabled={bridgeState === "loading"}>
                {bridgeState === "loading" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                {bridgeState === "loading" ? "查询中" : "按 Prompt 查询"}
              </Button>
            ) : null}
          </div>
        </div>

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
                <h3 className="mt-3 text-base font-bold text-white">{isAccountRadar ? "是否导入这批账号雷达线索？" : "是否导入这批 Grok 结果？"}</h3>
                <p className="mt-1 text-sm leading-6 text-white/55">模型：{proxySearchResult.model}。已解析 {importPreview.parsedCount} 条，可导入 {importPreview.importableCount} 条，重复 {importPreview.duplicateCount} 条{importPreview.excludedOwnCount ? "，已排除自己账号 " + importPreview.excludedOwnCount + " 条" : ""}。</p>
                {!proxySearchResult.structured && proxySearchResult.parseError ? <p className="mt-1 text-xs text-amber-200/70">JSON 解析未命中，已自动回退到文本解析。</p> : null}
              </div>
              <div className="flex flex-col gap-2 sm:flex-row lg:shrink-0">
                <Button variant="outline" className="tech-secondary" onClick={() => setProxySearchResult(null)}>
                  暂不导入
                </Button>
                <Button className="tech-cta" onClick={importGrokResult} disabled={importPreview.importableCount === 0}>
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
                <Button variant="ghost" size="sm" className="text-white/70 hover:bg-white/[0.06] hover:text-white" onClick={() => copyText(prompt)}>
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
              <Label className="text-xs font-bold uppercase text-white/45">{isAccountRadar ? "账号雷达线索" : "Grok 结果"}</Label>
              <Button variant="outline" size="sm" className="tech-secondary" onClick={importGrokResult} disabled={bridgeState === "loading"}>
                导入结果
              </Button>
            </div>
            <Textarea
              value={activeResult}
              onChange={(event) => {
                updateGrokBridgeField(activeResultField, event.target.value);
                setProxySearchResult(null);
              }}
              placeholder={isAccountRadar ? "账号雷达生成的线索会出现在这里，也可以粘贴 X | 作者 | 链接 | 摘要 格式结果。" : "Grok 或 codeproxy 返回的结果会出现在这里。推荐格式：X | 作者 | 链接 | 摘要"}
              className="min-h-[220px] resize-none border-white/[0.08] bg-[#0d0d10]/80 text-sm leading-6 text-white placeholder:text-white/35"
            />
            <SignalImportPreview preview={importPreview} />
          </div>
        </div>

        <p className={cn("rounded-md border px-3 py-2 text-xs leading-5", bridgeState === "error" ? "border-rose-400/20 bg-rose-500/10 text-rose-200" : "border-white/[0.08] bg-white/[0.03] text-white/55")}>{bridgeMessage}</p>
      </CardContent>
    </Card>
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
  const targetAudience = shortValue(current.targetCustomer, "目标用户越清楚，账号雷达越能筛出值得互动的人。");
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
          <p className="text-xs font-bold uppercase text-white/40">竞品对比作战板</p>
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
  const previewItems = preview.importable.slice(0, 3);
  const duplicateItems = preview.duplicates.slice(0, 3);
  const excludedOwnItems = preview.excludedOwn.slice(0, 3);
  const hasOnlyDuplicates = preview.importableCount === 0 && preview.duplicateCount > 0;
  const hasOnlyOwnAccount = preview.importableCount === 0 && preview.excludedOwnCount > 0 && preview.duplicateCount === 0;

  return (
    <div className="rounded-lg border border-white/[0.08] bg-white/[0.03] p-3 text-xs text-white/65">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-bold uppercase tracking-wide text-white/45">导入预览</p>
        <div className="flex flex-wrap gap-1.5">
          <span className="rounded-md border border-white/[0.08] bg-white/[0.04] px-2 py-1 text-white/70">解析 {preview.parsedCount}</span>
          <span className="rounded-md border border-emerald-500/10 bg-emerald-500/10 px-2 py-1 text-emerald-300">可导入 {preview.importableCount}</span>
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
          {duplicateItems.map((signal) => (
            <SignalPreviewRow key={signal.id} signal={signal} badge="已在队列" />
          ))}
        </div>
      ) : hasOnlyOwnAccount ? (
        <div className="mt-3 grid gap-2">
          <p className="rounded-md border border-rose-500/10 bg-rose-500/10 px-3 py-2 leading-5 text-rose-100/80">这批结果识别为自己的账号数据，已阻止导入。请换竞品/KOL 或外部目标用户账号。</p>
          {excludedOwnItems.map((signal) => (
            <SignalPreviewRow key={signal.id} signal={signal} badge="已排除" />
          ))}
        </div>
      ) : (
        <p className="mt-3 leading-5 text-white/40">粘贴 Grok 结果后，这里会显示解析和去重结果。</p>
      )}
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
  onApplyMemory,
  onPauseMemory,
  onClearMemory,
}: {
  mode: Mode;
  memory: GrowthMemoryState;
  signals: Signal[];
  onRunLearning: () => Promise<GrowthMemoryRunResult>;
  onApplyMemory: () => void;
  onPauseMemory: () => void;
  onClearMemory: () => void;
}) {
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");
  const [message, setMessage] = useState("标记反馈后，让 GPT-5.5 总结哪些人、关键词和话术真的有效，再应用到下一轮排序和找人。");
  const feedbackSignals = useMemo(() => signals.filter((signal) => normalizeFeedbackStatus(signal.feedback) !== "none"), [signals]);
  const positiveCount = feedbackSignals.filter((signal) => ["got_reply", "followed", "reshared"].includes(normalizeFeedbackStatus(signal.feedback))).length;
  const noReplyCount = feedbackSignals.filter((signal) => normalizeFeedbackStatus(signal.feedback) === "no_reply").length;
  const hasMemory = Boolean(memory.summary || memory.generatedAt || memory.effectiveKeywords.length || memory.scoreBoostRules.length || memory.replyStyleRules.length);
  const generatedLabel = memory.generatedAt ? formatProcessedAt(memory.generatedAt) : "尚未生成";
  const appliedLabel = memory.appliedAt ? formatProcessedAt(memory.appliedAt) : "未应用";

  async function handleRunLearning() {
    setState("loading");
    setMessage("正在让 GPT-5.5 从反馈样本里提炼增长记忆...");
    try {
      const result = await onRunLearning();
      setState("idle");
      const successMessage = `已用 ${result.model} 从 ${result.count} 条反馈里生成增长记忆。确认后点“应用到下一轮”。`;
      setMessage(successMessage);
      showToast(successMessage, "success");
    } catch (error) {
      setState("error");
      const errorMessage = error instanceof Error ? error.message : "增长记忆生成失败，请稍后重试。";
      setMessage(errorMessage);
      showToast(errorMessage, "error");
    }
  }

  function handleApply() {
    onApplyMemory();
    setState("idle");
    setMessage("增长记忆已应用。下一轮队列排序、Grok Prompt 和 AI 草稿会参考这份反馈经验。");
    showToast("增长记忆已应用到下一轮。", "success");
  }

  function handlePause() {
    onPauseMemory();
    setState("idle");
    setMessage("已暂停应用增长记忆。记忆仍保留，可以随时重新应用。");
    showToast("已暂停应用增长记忆。", "info");
  }

  function handleClear() {
    onClearMemory();
    setState("idle");
    setMessage("已清空增长记忆。反馈记录仍在，后续可以重新学习。");
    showToast("已清空增长记忆。", "info");
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
        <Badge variant="outline" className={cn("rounded-md", memory.active ? "border-emerald-500/10 bg-emerald-500/10 text-emerald-300" : "border-white/[0.08] bg-white/[0.04] text-white/55")}>
          {memory.active ? "已应用" : "未应用"}
        </Badge>
      </CardHeader>
      <CardContent className="grid gap-4 p-4">
        <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-center">
          <p className={cn("rounded-md border px-3 py-2 text-sm leading-6", state === "error" ? "border-rose-400/20 bg-rose-500/10 text-rose-200" : "border-white/[0.08] bg-[#0d0d10]/55 text-white/60")}>{message}</p>
          <div className="flex flex-wrap gap-2">
            <Button className="tech-cta h-9" onClick={() => void handleRunLearning()} disabled={state === "loading" || feedbackSignals.length === 0}>
              {state === "loading" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Bot className="h-4 w-4" />}
              {hasMemory ? "重新学习" : "生成增长记忆"}
            </Button>
            {memory.active ? (
              <Button variant="outline" className="tech-secondary h-9" onClick={handlePause} disabled={!hasMemory || state === "loading"}>
                暂停应用
              </Button>
            ) : (
              <Button variant="outline" className="tech-secondary h-9" onClick={handleApply} disabled={!hasMemory || state === "loading"}>
                应用到下一轮
              </Button>
            )}
            <Button variant="outline" className="tech-secondary h-9" onClick={handleClear} disabled={!hasMemory || state === "loading"}>
              清空记忆
            </Button>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-4">
          <div className="rounded-lg border border-white/[0.06] bg-[#0d0d10]/55 p-3">
            <p className="text-[11px] font-bold uppercase tracking-wide text-white/35">可学习反馈</p>
            <p className="mt-2 text-2xl font-black text-white">{feedbackSignals.length}</p>
            <p className="mt-1 text-xs text-white/35">当前页面实际样本</p>
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
            <p className="text-[11px] font-bold uppercase tracking-wide text-white/35">生成 / 应用</p>
            <p className="mt-2 text-sm font-bold text-white">{generatedLabel}</p>
            <p className="mt-1 text-xs text-white/35">{appliedLabel}</p>
          </div>
        </div>

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
                  {[...memory.scoreBoostRules.map((rule) => ({ ...rule, type: "boost" })), ...memory.scorePenaltyRules.map((rule) => ({ ...rule, type: "penalty" }))].slice(0, 6).map((rule, index) => (
                    <div key={`${rule.type}-${rule.pattern}-${index}`} className="rounded-md border border-white/[0.06] bg-white/[0.035] p-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-bold text-white/80">{rule.pattern}</span>
                        <Badge variant="outline" className={cn("rounded-md", rule.type === "boost" ? "border-emerald-500/10 bg-emerald-500/10 text-emerald-300" : "border-amber-500/10 bg-amber-500/10 text-amber-200")}>{rule.type === "boost" ? "+" : "-"}{rule.weight}</Badge>
                      </div>
                      <p className="mt-1 line-clamp-2 text-xs leading-5 text-white/45">{rule.reason}</p>
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
    copyText(buildFeedbackLearningPack(filteredSignals, { mode, now: new Date().toISOString() }));
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
        <div className="grid gap-3 xl:grid-cols-3">
          <DraftBlock icon={<MessageSquareText className="h-4 w-4" />} title="直接回复" description="发到原帖或评论下面，用来先建立互动。" value={item.replyDraft} source={draftSourceForItem(item)} />
          <DraftBlock icon={<Quote className="h-4 w-4" />} title="引用转发" description="引用这条内容再发表自己的观点。" value={item.quoteDraft} source={draftSourceForItem(item)} />
          <DraftBlock icon={<Lightbulb className="h-4 w-4" />} title="内容选题" description="把这个信号延展成你自己的原创帖。" value={item.postIdea} source={draftSourceForItem(item)} />
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
  const [usedDraftInput, setUsedDraftInput] = useState(signal?.usedDraft || primaryDraft);

  useEffect(() => {
    setUsedDraftInput(signal?.usedDraft || primaryDraft);
  }, [signal?.usedDraft, primaryDraft]);

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
              <a href={sourceUrl} target="_blank" rel="noreferrer">
                <ExternalLink className="h-3.5 w-3.5" /> 打开原帖
              </a>
            </Button>
          ) : null}
          <Button variant="outline" size="sm" className="tech-secondary h-8" onClick={() => copyText(primaryDraft)}>
            <Copy className="h-3.5 w-3.5" /> {copyLabel}
          </Button>
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











