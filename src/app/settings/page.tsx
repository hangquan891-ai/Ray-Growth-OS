"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Bot, CheckCircle2, KeyRound, Radar, Save, ShieldCheck, Trash2, UserRound } from "lucide-react";

import { ActionToastHost, showToast, type ActionToastTone } from "@/components/action-toast";
import { LanguageToggle, useI18n } from "@/components/language-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  DEFAULT_AI_RESPONSE_MODEL,
  DEFAULT_GROK_PROXY_MODEL,
  normalizeAiResponseConfig,
  normalizeGrokProxyConfig,
  normalizeXProfileConfig,
} from "@/lib/codeproxy-grok";
import { loadSharedSettings, saveSharedSettings, type SharedSettings, writeLocalState } from "@/lib/local-state-client";
import { DEFAULT_WORKBENCH_STATE } from "@/lib/workbench-state";

const CODEPROXY_MESSAGES_URL = "https://codeproxy.dev/v1/messages";
const CODEPROXY_RESPONSES_URL = "https://codeproxy.dev/v1/responses";

type ProxyConfig = {
  apiKey: string;
  model: string;
};

type XProfileConfig = {
  profileUrl: string;
};

function maskSecret(value: string, locale: "zh-CN" | "en") {
  const secret = value.trim();
  if (!secret) return locale === "en" ? "Not configured" : "未配置";
  if (secret.length <= 10) return `${secret.slice(0, 3)}***`;
  return `${secret.slice(0, 6)}...${secret.slice(-4)}`;
}

function statusClass(hasKey: boolean) {
  const layout = "w-fit shrink-0 whitespace-nowrap";
  return hasKey ? `${layout} border-emerald-500/10 bg-emerald-500/10 text-emerald-300` : `${layout} border-amber-500/10 bg-amber-500/10 text-amber-300`;
}

export default function SettingsPage() {
  const { locale, t } = useI18n();
  const tr = (zh: string, en: string) => (locale === "en" ? en : zh);
  const [grokApiKey, setGrokApiKey] = useState("");
  const [grokModel, setGrokModel] = useState(DEFAULT_GROK_PROXY_MODEL);
  const [aiApiKey, setAiApiKey] = useState("");
  const [aiModel, setAiModel] = useState(DEFAULT_AI_RESPONSE_MODEL);
  const [xProfileUrl, setXProfileUrl] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    let cancelled = false;
    void loadSharedSettings()
      .then((settings) => {
        if (cancelled) return;
        setGrokApiKey(settings.grok.apiKey);
        setGrokModel(settings.grok.model || DEFAULT_GROK_PROXY_MODEL);
        setAiApiKey(settings.ai.apiKey);
        setAiModel(settings.ai.model || DEFAULT_AI_RESPONSE_MODEL);
        setXProfileUrl(settings.xProfile.profileUrl);
      })
      .catch(() => {
        if (!cancelled) notify(tr("本机共享配置读取失败，请确认本地服务仍在运行。", "Shared local settings could not be read. Make sure the local service is still running."), "error");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const grokHasKey = useMemo(() => grokApiKey.trim().length > 0, [grokApiKey]);
  const aiHasKey = useMemo(() => aiApiKey.trim().length > 0, [aiApiKey]);
  const xProfileSaved = useMemo(() => xProfileUrl.trim().length > 0, [xProfileUrl]);

  function notify(nextMessage: string, tone: ActionToastTone = "success") {
    setMessage(nextMessage);
    showToast(nextMessage, tone);
  }

  function settingsPayload(overrides: Partial<Pick<SharedSettings, "grok" | "ai" | "xProfile">> = {}): SharedSettings {
    return {
      version: 1,
      grok: overrides.grok ?? (normalizeGrokProxyConfig({ apiKey: grokApiKey, model: grokModel }) as ProxyConfig),
      ai: overrides.ai ?? (normalizeAiResponseConfig({ apiKey: aiApiKey, model: aiModel }) as ProxyConfig),
      xProfile: overrides.xProfile ?? (normalizeXProfileConfig({ profileUrl: xProfileUrl }) as XProfileConfig),
    };
  }

  async function saveGrokConfig() {
    const config = normalizeGrokProxyConfig({ apiKey: grokApiKey, model: grokModel }) as ProxyConfig;
    try {
      await saveSharedSettings(settingsPayload({ grok: config }));
      setGrokApiKey(config.apiKey);
      setGrokModel(config.model);
      notify(config.apiKey ? tr("已保存 Grok 配置。现在可以回到工作台使用竞品洞察和中转查询。", "Grok settings saved. You can now use competitor insights and proxy search.") : tr("已保存 Grok 默认模型，但还没有填写密钥。", "The default Grok model was saved, but no API key is configured yet."), config.apiKey ? "success" : "info");
    } catch {
      notify(tr("保存失败：无法写入本机共享数据库，请确认本地服务仍在运行。", "Save failed because the shared local database is unavailable. Make sure the local service is running."), "error");
    }
  }

  async function saveAiConfig() {
    const config = normalizeAiResponseConfig({ apiKey: aiApiKey, model: aiModel }) as ProxyConfig;
    try {
      await saveSharedSettings(settingsPayload({ ai: config }));
      setAiApiKey(config.apiKey);
      setAiModel(config.model);
      notify(config.apiKey ? tr("已保存 GPT-5.5 配置。评分和草稿生成会走 codeproxy.dev/v1/responses。", "AI settings saved. Scoring and drafts will use codeproxy.dev/v1/responses.") : tr("已保存 GPT-5.5 默认模型，但还没有填写密钥。", "The default AI model was saved, but no API key is configured yet."), config.apiKey ? "success" : "info");
    } catch {
      notify(tr("保存失败：无法写入本机共享数据库，请确认本地服务仍在运行。", "Save failed because the shared local database is unavailable. Make sure the local service is running."), "error");
    }
  }

  async function saveXProfileConfig() {
    const config = normalizeXProfileConfig({ profileUrl: xProfileUrl }) as XProfileConfig;
    try {
      await saveSharedSettings(settingsPayload({ xProfile: config }));
      setXProfileUrl(config.profileUrl);
      notify(config.profileUrl ? tr("已保存 X 主页地址。回到第 1 步后可以让 AI 生成一版定位草稿。", "Public X profile saved. Return to positioning to generate a draft.") : tr("已保存空的 X 主页地址。需要填写后才可以 AI 帮填定位。", "An empty X profile was saved. Add a profile URL before using AI positioning."), config.profileUrl ? "success" : "info");
    } catch {
      notify(tr("保存失败：无法写入本机共享数据库，请确认本地服务仍在运行。", "Save failed because the shared local database is unavailable. Make sure the local service is running."), "error");
    }
  }

  async function clearXProfileConfig() {
    try {
      await saveSharedSettings(settingsPayload({ xProfile: normalizeXProfileConfig({}) as XProfileConfig }));
      setXProfileUrl("");
      notify(tr("已清空 X 主页地址。", "Public X profile cleared."), "info");
    } catch {
      notify(tr("清空失败：无法写入本机共享数据库。", "Clear failed because the shared local database is unavailable."), "error");
    }
  }

  async function clearGrokConfig() {
    try {
      const config = normalizeGrokProxyConfig({}) as ProxyConfig;
      await saveSharedSettings(settingsPayload({ grok: config }));
      setGrokApiKey("");
      setGrokModel(DEFAULT_GROK_PROXY_MODEL);
      notify(tr("已清空 Grok 找人配置。", "Grok discovery settings cleared."), "info");
    } catch {
      notify(tr("清空失败：无法写入本机共享数据库。", "Clear failed because the shared local database is unavailable."), "error");
    }
  }

  async function clearAiConfig() {
    try {
      const config = normalizeAiResponseConfig({}) as ProxyConfig;
      await saveSharedSettings(settingsPayload({ ai: config }));
      setAiApiKey("");
      setAiModel(DEFAULT_AI_RESPONSE_MODEL);
      notify(tr("已清空 GPT-5.5 评分/草稿配置。", "AI scoring and draft settings cleared."), "info");
    } catch {
      notify(tr("清空失败：无法写入本机共享数据库。", "Clear failed because the shared local database is unavailable."), "error");
    }
  }

  async function clearWorkbenchData() {
    const confirmed = window.confirm(tr("只清空工作台测试数据、队列、反馈和增长记忆；Grok / GPT-5.5 密钥会保留。确认清空吗？", "Clear local workbench data, queue items, feedback, and growth learning? Grok and AI keys will be kept."));
    if (!confirmed) return;

    try {
      await writeLocalState("workbench", DEFAULT_WORKBENCH_STATE);
      notify(tr("已清空工作台测试数据，密钥配置已保留。返回工作台后会从空白状态开始。", "Local workbench data was cleared and API settings were kept. The workbench will start empty."), "success");
    } catch {
      notify(tr("清空失败：无法写入本机共享数据库，请确认本地服务仍在运行。", "Clear failed because the shared local database is unavailable. Make sure the local service is running."), "error");
    }
  }

  return (
    <main className="surface-grid tech-shell min-h-screen overflow-hidden px-4 py-6 text-white sm:px-6 lg:px-8">
      <ActionToastHost />
      <div className="ambient-layer" aria-hidden="true">
        <div className="ambient-blob ambient-blob-purple -left-28 top-0" />
        <div className="ambient-blob ambient-blob-blue right-[-12rem] top-20" />
        <div className="ambient-blob ambient-blob-indigo bottom-[-12rem] left-1/3" />
      </div>

      <div className="mx-auto grid min-h-[calc(100vh-3rem)] w-full max-w-6xl content-center gap-5">
        <div className="fade-up flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <Badge variant="outline" className="rounded-md border-white/[0.08] bg-white/[0.04] text-white/70">
              <KeyRound className="mr-1 h-3.5 w-3.5" /> {t("keySettings")}
            </Badge>
            <h1 className="mt-4 text-3xl font-black text-white sm:text-5xl">{t("apiSettings")}</h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-white/55 sm:text-base">{tr("Grok 用来找讨论和做竞品洞察，GPT-5.5 用来评分和生成草稿。两者都通过 codeproxy.dev 中转，请分别保存密钥和模型。", "Grok discovers public discussions and competitor opportunities. The AI model scores signals and generates drafts. Save each key and model separately.")}</p>
          </div>
          <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:flex-nowrap">
          <LanguageToggle />
          <Button asChild variant="outline" className="tech-secondary flex-1 sm:flex-none">
            <Link href="/">
              <ArrowLeft className="h-4 w-4" /> {t("backToWorkbench")}
            </Link>
          </Button>
          </div>
        </div>

        <div className="grid gap-5 lg:grid-cols-2">
          <Card className="fade-up delay-1 overflow-hidden border border-white/[0.08] bg-white/[0.03] text-white shadow-2xl shadow-blue-500/5 backdrop-blur-md">
            <CardHeader className="border-b border-white/[0.08] bg-[#0d0d10]/70">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2 text-xl text-white">
                    <Radar className="h-5 w-5 text-blue-200" /> {t("grokSearch")}
                  </CardTitle>
                  <CardDescription className="mt-2 text-white/55">{tr("用于 Grok 找讨论、竞品洞察与竞品/KOL 受众挖掘，并生成可导入 Signal。", "Use Grok to discover public discussions, inspect competitors or KOL audiences, and return importable signals.")}</CardDescription>
                </div>
                <Badge variant="outline" className={statusClass(grokHasKey)}>{grokHasKey ? t("configured") : t("notConfigured")}</Badge>
              </div>
            </CardHeader>
            <CardContent className="grid gap-5 p-5 sm:p-6">
              <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_190px]">
                <div className="grid gap-2">
                  <Label className="text-xs font-bold uppercase tracking-wider text-white/45">Grok / codeproxy {tr("密钥", "API key")}</Label>
                  <Input type="password" value={grokApiKey} onChange={(event) => setGrokApiKey(event.target.value)} placeholder="sk-..." className="border-white/[0.08] bg-[#0d0d10]/80 text-white placeholder:text-white/35" autoComplete="off" />
                </div>
                <div className="grid gap-2">
                  <Label className="text-xs font-bold uppercase tracking-wider text-white/45">Grok {tr("模型", "model")}</Label>
                  <Input value={grokModel} onChange={(event) => setGrokModel(event.target.value)} placeholder={DEFAULT_GROK_PROXY_MODEL} className="border-white/[0.08] bg-[#0d0d10]/80 text-white placeholder:text-white/35" />
                </div>
              </div>
              <div className="grid gap-3 rounded-lg border border-white/[0.08] bg-white/[0.03] p-4 text-sm text-white/65 sm:grid-cols-3">
                <div>
                  <p className="text-xs font-bold uppercase tracking-wider text-white/35">{tr("接口", "Endpoint")}</p>
                  <p className="mt-2 break-all font-mono text-xs text-blue-200/80">{CODEPROXY_MESSAGES_URL}</p>
                </div>
                <div>
                  <p className="text-xs font-bold uppercase tracking-wider text-white/35">{tr("模型", "Model")}</p>
                  <p className="mt-2 font-mono text-xs text-white/75">{grokModel.trim() || DEFAULT_GROK_PROXY_MODEL}</p>
                </div>
                <div>
                  <p className="text-xs font-bold uppercase tracking-wider text-white/35">{tr("密钥", "API key")}</p>
                  <p className="mt-2 font-mono text-xs text-white/75">{maskSecret(grokApiKey, locale)}</p>
                </div>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
                <Button variant="outline" className="tech-secondary" onClick={clearGrokConfig}>
                  <Trash2 className="h-4 w-4" /> {t("clear")}
                </Button>
                <Button className="tech-cta" onClick={saveGrokConfig}>
                  <Save className="h-4 w-4" /> {tr("保存 Grok 配置", "Save Grok settings")}
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card className="fade-up delay-2 overflow-hidden border border-white/[0.08] bg-white/[0.03] text-white shadow-2xl shadow-blue-500/5 backdrop-blur-md">
            <CardHeader className="border-b border-white/[0.08] bg-[#0d0d10]/70">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2 text-xl text-white">
                    <Bot className="h-5 w-5 text-blue-200" /> {t("aiScoringDrafts")}
                  </CardTitle>
                  <CardDescription className="mt-2 text-white/55">{tr("用于 AI 语义评分、下一步建议和回复草稿生成。", "Use the AI model for semantic scoring, next-step suggestions, and reply drafts.")}</CardDescription>
                </div>
                <Badge variant="outline" className={statusClass(aiHasKey)}>{aiHasKey ? t("configured") : t("notConfigured")}</Badge>
              </div>
            </CardHeader>
            <CardContent className="grid gap-5 p-5 sm:p-6">
              <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_190px]">
                <div className="grid gap-2">
                  <Label className="text-xs font-bold uppercase tracking-wider text-white/45">GPT-5.5 / codeproxy {tr("密钥", "API key")}</Label>
                  <Input type="password" value={aiApiKey} onChange={(event) => setAiApiKey(event.target.value)} placeholder="sk-..." className="border-white/[0.08] bg-[#0d0d10]/80 text-white placeholder:text-white/35" autoComplete="off" />
                </div>
                <div className="grid gap-2">
                  <Label className="text-xs font-bold uppercase tracking-wider text-white/45">{tr("评分/草稿模型", "Scoring & draft model")}</Label>
                  <Input value={aiModel} onChange={(event) => setAiModel(event.target.value)} placeholder={DEFAULT_AI_RESPONSE_MODEL} className="border-white/[0.08] bg-[#0d0d10]/80 text-white placeholder:text-white/35" />
                </div>
              </div>
              <div className="grid gap-3 rounded-lg border border-white/[0.08] bg-white/[0.03] p-4 text-sm text-white/65 sm:grid-cols-3">
                <div>
                  <p className="text-xs font-bold uppercase tracking-wider text-white/35">{tr("接口", "Endpoint")}</p>
                  <p className="mt-2 break-all font-mono text-xs text-blue-200/80">{CODEPROXY_RESPONSES_URL}</p>
                </div>
                <div>
                  <p className="text-xs font-bold uppercase tracking-wider text-white/35">{tr("模型", "Model")}</p>
                  <p className="mt-2 font-mono text-xs text-white/75">{aiModel.trim() || DEFAULT_AI_RESPONSE_MODEL}</p>
                </div>
                <div>
                  <p className="text-xs font-bold uppercase tracking-wider text-white/35">{tr("密钥", "API key")}</p>
                  <p className="mt-2 font-mono text-xs text-white/75">{maskSecret(aiApiKey, locale)}</p>
                </div>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
                <Button variant="outline" className="tech-secondary" onClick={clearAiConfig}>
                  <Trash2 className="h-4 w-4" /> {t("clear")}
                </Button>
                <Button className="tech-cta" onClick={saveAiConfig}>
                  <Save className="h-4 w-4" /> {tr("保存 AI 配置", "Save AI settings")}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>

        <Card className="fade-up delay-3 overflow-hidden border border-white/[0.08] bg-white/[0.03] text-white shadow-2xl shadow-blue-500/5 backdrop-blur-md">
          <CardHeader className="border-b border-white/[0.08] bg-[#0d0d10]/70">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <CardTitle className="flex items-center gap-2 text-xl text-white">
                  <UserRound className="h-5 w-5 text-blue-200" /> {t("xProfile")}
                </CardTitle>
                <CardDescription className="mt-2 text-white/55">{tr("用于第 1 步的 AI 帮填定位：根据你的公开主页地址和已填内容，生成账号定位、目标读者、内容支柱和回复策略草稿。", "Used for AI positioning: the public profile URL and your current inputs help generate a draft positioning, audience, topics, and engagement strategy.")}</CardDescription>
              </div>
              <Badge variant="outline" className={statusClass(xProfileSaved)}>{xProfileSaved ? tr("已保存", "Saved") : tr("未填写", "Empty")}</Badge>
            </div>
          </CardHeader>
          <CardContent className="grid gap-4 p-5 sm:p-6">
            <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
              <div className="grid gap-2">
                <Label className="text-xs font-bold uppercase tracking-wider text-white/45">{tr("X 主页地址", "Public X profile URL")}</Label>
                <Input value={xProfileUrl} onChange={(event) => setXProfileUrl(event.target.value)} placeholder="https://x.com/yourname" className="border-white/[0.08] bg-[#0d0d10]/80 text-white placeholder:text-white/35" />
              </div>
              <div className="flex flex-col gap-2 sm:flex-row md:justify-end">
                <Button variant="outline" className="tech-secondary" onClick={clearXProfileConfig}>
                  <Trash2 className="h-4 w-4" /> {t("clear")}
                </Button>
                <Button className="tech-cta" onClick={saveXProfileConfig}>
                  <Save className="h-4 w-4" /> {tr("保存主页", "Save profile")}
                </Button>
              </div>
            </div>
            <p className="text-xs leading-5 text-white/45">{tr("这里只保存公开主页链接，不读取私信或后台数据。AI 生成结果只是定位初稿，你可以回到工作台继续修改。", "Only the public profile URL is stored here. The app does not read DMs or private analytics. AI output is an editable starting draft.")}</p>
          </CardContent>
        </Card>

        <div className="fade-up delay-4 grid gap-3 rounded-lg border border-blue-400/10 bg-blue-400/5 p-4 text-sm leading-6 text-blue-100/75 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
          <div>
            <div className="mb-2 flex items-center gap-2 font-semibold text-blue-100">
              <ShieldCheck className="h-4 w-4" /> {tr("本机共享存储", "Shared local storage")}
            </div>
            {tr("设置和新工作台数据保存在这台电脑的 SQLite 数据库中，同一台电脑上的浏览器会读取同一份数据。升级时只迁移当前浏览器里的 Grok / GPT-5.5 / X 主页设置，旧队列和历史反馈不会迁移；清空测试数据也不会删除这些设置。", "Settings and new workbench data are stored in a SQLite database on this computer, shared by browsers on the same device. During upgrade, only Grok, AI, and X profile settings are migrated from the current browser; legacy queues and feedback are not migrated. Clearing workbench data keeps these settings.")}{message ? <span className="ml-2 text-emerald-200"><CheckCircle2 className="mr-1 inline h-4 w-4" />{message}</span> : null}
          </div>
          <Button variant="outline" className="tech-secondary w-full md:w-auto" onClick={clearWorkbenchData}>
            <Trash2 className="h-4 w-4" /> {tr("清空测试数据", "Clear local workbench data")}
          </Button>
        </div>
      </div>
    </main>
  );
}
