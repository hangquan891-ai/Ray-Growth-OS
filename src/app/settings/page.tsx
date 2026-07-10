"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Bot, CheckCircle2, KeyRound, Radar, Save, ShieldCheck, Trash2, UserRound } from "lucide-react";

import { ActionToastHost, showToast, type ActionToastTone } from "@/components/action-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  AI_RESPONSE_CONFIG_STORAGE_KEY,
  DEFAULT_AI_RESPONSE_MODEL,
  DEFAULT_GROK_PROXY_MODEL,
  GROK_PROXY_CONFIG_STORAGE_KEY,
  X_PROFILE_CONFIG_STORAGE_KEY,
  normalizeAiResponseConfig,
  normalizeGrokProxyConfig,
  normalizeXProfileConfig,
} from "@/lib/codeproxy-grok";
import { DEFAULT_WORKBENCH_STATE, WORKBENCH_STORAGE_KEY, serializeWorkbenchState } from "@/lib/workbench-state";

const CODEPROXY_MESSAGES_URL = "https://codeproxy.dev/v1/messages";
const CODEPROXY_RESPONSES_URL = "https://codeproxy.dev/v1/responses";

type ProxyConfig = {
  apiKey: string;
  model: string;
};

type XProfileConfig = {
  profileUrl: string;
};

function maskSecret(value: string) {
  const secret = value.trim();
  if (!secret) return "未配置";
  if (secret.length <= 10) return `${secret.slice(0, 3)}***`;
  return `${secret.slice(0, 6)}...${secret.slice(-4)}`;
}

function statusClass(hasKey: boolean) {
  return hasKey ? "border-emerald-500/10 bg-emerald-500/10 text-emerald-300" : "border-amber-500/10 bg-amber-500/10 text-amber-300";
}

export default function SettingsPage() {
  const [grokApiKey, setGrokApiKey] = useState("");
  const [grokModel, setGrokModel] = useState(DEFAULT_GROK_PROXY_MODEL);
  const [aiApiKey, setAiApiKey] = useState("");
  const [aiModel, setAiModel] = useState(DEFAULT_AI_RESPONSE_MODEL);
  const [xProfileUrl, setXProfileUrl] = useState("");
  const [message, setMessage] = useState("这里配置 Grok 找人、GPT-5.5 评分/草稿，以及 AI 帮填定位使用的 X 主页。");

  useEffect(() => {
    try {
      const storedGrok = window.localStorage.getItem(GROK_PROXY_CONFIG_STORAGE_KEY);
      const grokConfig = normalizeGrokProxyConfig(storedGrok ? JSON.parse(storedGrok) : {}) as ProxyConfig;
      setGrokApiKey(grokConfig.apiKey);
      setGrokModel(grokConfig.model || DEFAULT_GROK_PROXY_MODEL);

      const storedAi = window.localStorage.getItem(AI_RESPONSE_CONFIG_STORAGE_KEY);
      const aiConfig = normalizeAiResponseConfig(storedAi ? JSON.parse(storedAi) : {}) as ProxyConfig;
      setAiApiKey(aiConfig.apiKey);
      setAiModel(aiConfig.model || DEFAULT_AI_RESPONSE_MODEL);

      const storedXProfile = window.localStorage.getItem(X_PROFILE_CONFIG_STORAGE_KEY);
      const xProfileConfig = normalizeXProfileConfig(storedXProfile ? JSON.parse(storedXProfile) : {}) as XProfileConfig;
      setXProfileUrl(xProfileConfig.profileUrl);
    } catch {
      notify("本地配置读取失败，已回退为默认模型。可以重新保存一次。", "error");
    }
  }, []);

  const grokHasKey = useMemo(() => grokApiKey.trim().length > 0, [grokApiKey]);
  const aiHasKey = useMemo(() => aiApiKey.trim().length > 0, [aiApiKey]);
  const xProfileSaved = useMemo(() => xProfileUrl.trim().length > 0, [xProfileUrl]);

  function notify(nextMessage: string, tone: ActionToastTone = "success") {
    setMessage(nextMessage);
    showToast(nextMessage, tone);
  }

  function saveGrokConfig() {
    const config = normalizeGrokProxyConfig({ apiKey: grokApiKey, model: grokModel }) as ProxyConfig;
    try {
      window.localStorage.setItem(GROK_PROXY_CONFIG_STORAGE_KEY, JSON.stringify(config));
      setGrokApiKey(config.apiKey);
      setGrokModel(config.model);
      notify(config.apiKey ? "已保存 Grok 配置。现在可以回到工作台使用竞品洞察和中转查询。" : "已保存 Grok 默认模型，但还没有填写密钥。", config.apiKey ? "success" : "info");
    } catch {
      notify("保存失败：浏览器禁止访问 localStorage。请检查隐私模式或站点权限。", "error");
    }
  }

  function saveAiConfig() {
    const config = normalizeAiResponseConfig({ apiKey: aiApiKey, model: aiModel }) as ProxyConfig;
    try {
      window.localStorage.setItem(AI_RESPONSE_CONFIG_STORAGE_KEY, JSON.stringify(config));
      setAiApiKey(config.apiKey);
      setAiModel(config.model);
      notify(config.apiKey ? "已保存 GPT-5.5 配置。评分和草稿生成会走 codeproxy.dev/v1/responses。" : "已保存 GPT-5.5 默认模型，但还没有填写密钥。", config.apiKey ? "success" : "info");
    } catch {
      notify("保存失败：浏览器禁止访问 localStorage。请检查隐私模式或站点权限。", "error");
    }
  }

  function saveXProfileConfig() {
    const config = normalizeXProfileConfig({ profileUrl: xProfileUrl }) as XProfileConfig;
    try {
      window.localStorage.setItem(X_PROFILE_CONFIG_STORAGE_KEY, JSON.stringify(config));
      setXProfileUrl(config.profileUrl);
      notify(config.profileUrl ? "已保存 X 主页地址。回到第 1 步后可以让 AI 生成一版定位草稿。" : "已保存空的 X 主页地址。需要填写后才可以 AI 帮填定位。", config.profileUrl ? "success" : "info");
    } catch {
      notify("保存失败：浏览器禁止访问 localStorage。请检查隐私模式或站点权限。", "error");
    }
  }

  function clearXProfileConfig() {
    try {
      window.localStorage.removeItem(X_PROFILE_CONFIG_STORAGE_KEY);
    } catch {}
    setXProfileUrl("");
    notify("已清空 X 主页地址。", "info");
  }

  function clearGrokConfig() {
    try {
      window.localStorage.removeItem(GROK_PROXY_CONFIG_STORAGE_KEY);
    } catch {}
    setGrokApiKey("");
    setGrokModel(DEFAULT_GROK_PROXY_MODEL);
    notify("已清空 Grok 找人配置。", "info");
  }

  function clearAiConfig() {
    try {
      window.localStorage.removeItem(AI_RESPONSE_CONFIG_STORAGE_KEY);
    } catch {}
    setAiApiKey("");
    setAiModel(DEFAULT_AI_RESPONSE_MODEL);
    notify("已清空 GPT-5.5 评分/草稿配置。", "info");
  }

  function clearWorkbenchData() {
    const confirmed = window.confirm("只清空工作台测试数据、队列、反馈和增长记忆；Grok / GPT-5.5 密钥会保留。确认清空吗？");
    if (!confirmed) return;

    try {
      window.localStorage.setItem(WORKBENCH_STORAGE_KEY, serializeWorkbenchState(DEFAULT_WORKBENCH_STATE));
      notify("已清空工作台测试数据，密钥配置已保留。返回工作台后会从空白状态开始。", "success");
    } catch {
      notify("清空失败：浏览器禁止访问 localStorage。请检查隐私模式或站点权限。", "error");
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
              <KeyRound className="mr-1 h-3.5 w-3.5" /> 密钥设置
            </Badge>
            <h1 className="mt-4 text-3xl font-black text-white sm:text-5xl">AI 接口配置</h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-white/55 sm:text-base">Grok 用来找讨论和做竞品洞察，GPT-5.5 用来评分和生成草稿。两者都通过 codeproxy.dev 中转，请分别保存密钥和模型。</p>
          </div>
          <Button asChild variant="outline" className="tech-secondary w-full sm:w-auto">
            <Link href="/">
              <ArrowLeft className="h-4 w-4" /> 返回工作台
            </Link>
          </Button>
        </div>

        <div className="grid gap-5 lg:grid-cols-2">
          <Card className="fade-up delay-1 overflow-hidden border border-white/[0.08] bg-white/[0.03] text-white shadow-2xl shadow-blue-500/5 backdrop-blur-md">
            <CardHeader className="border-b border-white/[0.08] bg-[#0d0d10]/70">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2 text-xl text-white">
                    <Radar className="h-5 w-5 text-blue-200" /> Grok 找人
                  </CardTitle>
                  <CardDescription className="mt-2 text-white/55">用于 Grok 找讨论、竞品洞察与竞品/KOL 受众挖掘，并生成可导入 Signal。</CardDescription>
                </div>
                <Badge variant="outline" className={statusClass(grokHasKey)}>{grokHasKey ? "已配置" : "未配置"}</Badge>
              </div>
            </CardHeader>
            <CardContent className="grid gap-5 p-5 sm:p-6">
              <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_190px]">
                <div className="grid gap-2">
                  <Label className="text-xs font-bold uppercase tracking-wider text-white/45">Grok / codeproxy 密钥</Label>
                  <Input type="password" value={grokApiKey} onChange={(event) => setGrokApiKey(event.target.value)} placeholder="sk-..." className="border-white/[0.08] bg-[#0d0d10]/80 text-white placeholder:text-white/35" autoComplete="off" />
                </div>
                <div className="grid gap-2">
                  <Label className="text-xs font-bold uppercase tracking-wider text-white/45">Grok 模型</Label>
                  <Input value={grokModel} onChange={(event) => setGrokModel(event.target.value)} placeholder={DEFAULT_GROK_PROXY_MODEL} className="border-white/[0.08] bg-[#0d0d10]/80 text-white placeholder:text-white/35" />
                </div>
              </div>
              <div className="grid gap-3 rounded-lg border border-white/[0.08] bg-white/[0.03] p-4 text-sm text-white/65 sm:grid-cols-3">
                <div>
                  <p className="text-xs font-bold uppercase tracking-wider text-white/35">接口</p>
                  <p className="mt-2 break-all font-mono text-xs text-blue-200/80">{CODEPROXY_MESSAGES_URL}</p>
                </div>
                <div>
                  <p className="text-xs font-bold uppercase tracking-wider text-white/35">模型</p>
                  <p className="mt-2 font-mono text-xs text-white/75">{grokModel.trim() || DEFAULT_GROK_PROXY_MODEL}</p>
                </div>
                <div>
                  <p className="text-xs font-bold uppercase tracking-wider text-white/35">密钥</p>
                  <p className="mt-2 font-mono text-xs text-white/75">{maskSecret(grokApiKey)}</p>
                </div>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
                <Button variant="outline" className="tech-secondary" onClick={clearGrokConfig}>
                  <Trash2 className="h-4 w-4" /> 清空
                </Button>
                <Button className="tech-cta" onClick={saveGrokConfig}>
                  <Save className="h-4 w-4" /> 保存 Grok 配置
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card className="fade-up delay-2 overflow-hidden border border-white/[0.08] bg-white/[0.03] text-white shadow-2xl shadow-blue-500/5 backdrop-blur-md">
            <CardHeader className="border-b border-white/[0.08] bg-[#0d0d10]/70">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2 text-xl text-white">
                    <Bot className="h-5 w-5 text-blue-200" /> GPT-5.5 评分/草稿
                  </CardTitle>
                  <CardDescription className="mt-2 text-white/55">用于 AI 语义评分、下一步建议和回复草稿生成。</CardDescription>
                </div>
                <Badge variant="outline" className={statusClass(aiHasKey)}>{aiHasKey ? "已配置" : "未配置"}</Badge>
              </div>
            </CardHeader>
            <CardContent className="grid gap-5 p-5 sm:p-6">
              <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_190px]">
                <div className="grid gap-2">
                  <Label className="text-xs font-bold uppercase tracking-wider text-white/45">GPT-5.5 / codeproxy 密钥</Label>
                  <Input type="password" value={aiApiKey} onChange={(event) => setAiApiKey(event.target.value)} placeholder="sk-..." className="border-white/[0.08] bg-[#0d0d10]/80 text-white placeholder:text-white/35" autoComplete="off" />
                </div>
                <div className="grid gap-2">
                  <Label className="text-xs font-bold uppercase tracking-wider text-white/45">评分/草稿模型</Label>
                  <Input value={aiModel} onChange={(event) => setAiModel(event.target.value)} placeholder={DEFAULT_AI_RESPONSE_MODEL} className="border-white/[0.08] bg-[#0d0d10]/80 text-white placeholder:text-white/35" />
                </div>
              </div>
              <div className="grid gap-3 rounded-lg border border-white/[0.08] bg-white/[0.03] p-4 text-sm text-white/65 sm:grid-cols-3">
                <div>
                  <p className="text-xs font-bold uppercase tracking-wider text-white/35">接口</p>
                  <p className="mt-2 break-all font-mono text-xs text-blue-200/80">{CODEPROXY_RESPONSES_URL}</p>
                </div>
                <div>
                  <p className="text-xs font-bold uppercase tracking-wider text-white/35">模型</p>
                  <p className="mt-2 font-mono text-xs text-white/75">{aiModel.trim() || DEFAULT_AI_RESPONSE_MODEL}</p>
                </div>
                <div>
                  <p className="text-xs font-bold uppercase tracking-wider text-white/35">密钥</p>
                  <p className="mt-2 font-mono text-xs text-white/75">{maskSecret(aiApiKey)}</p>
                </div>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
                <Button variant="outline" className="tech-secondary" onClick={clearAiConfig}>
                  <Trash2 className="h-4 w-4" /> 清空
                </Button>
                <Button className="tech-cta" onClick={saveAiConfig}>
                  <Save className="h-4 w-4" /> 保存 GPT-5.5 配置
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
                  <UserRound className="h-5 w-5 text-blue-200" /> X 账号主页
                </CardTitle>
                <CardDescription className="mt-2 text-white/55">用于第 1 步的 AI 帮填定位：根据你的公开主页地址和已填内容，生成账号定位、目标读者、内容支柱和回复策略草稿。</CardDescription>
              </div>
              <Badge variant="outline" className={statusClass(xProfileSaved)}>{xProfileSaved ? "已保存" : "未填写"}</Badge>
            </div>
          </CardHeader>
          <CardContent className="grid gap-4 p-5 sm:p-6">
            <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
              <div className="grid gap-2">
                <Label className="text-xs font-bold uppercase tracking-wider text-white/45">X 主页地址</Label>
                <Input value={xProfileUrl} onChange={(event) => setXProfileUrl(event.target.value)} placeholder="https://x.com/yourname" className="border-white/[0.08] bg-[#0d0d10]/80 text-white placeholder:text-white/35" />
              </div>
              <div className="flex flex-col gap-2 sm:flex-row md:justify-end">
                <Button variant="outline" className="tech-secondary" onClick={clearXProfileConfig}>
                  <Trash2 className="h-4 w-4" /> 清空
                </Button>
                <Button className="tech-cta" onClick={saveXProfileConfig}>
                  <Save className="h-4 w-4" /> 保存主页
                </Button>
              </div>
            </div>
            <p className="text-xs leading-5 text-white/45">这里只保存公开主页链接，不读取私信或后台数据。AI 生成结果只是定位初稿，你可以回到工作台继续修改。</p>
          </CardContent>
        </Card>

        <div className="fade-up delay-4 grid gap-3 rounded-lg border border-blue-400/10 bg-blue-400/5 p-4 text-sm leading-6 text-blue-100/75 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
          <div>
            <div className="mb-2 flex items-center gap-2 font-semibold text-blue-100">
              <ShieldCheck className="h-4 w-4" /> 本地保存说明
            </div>
            密钥和 X 主页地址只保存在当前浏览器 localStorage，不进入工作台 JSON 备份。清空测试数据不会删除 Grok / GPT-5.5 密钥和 X 主页地址。{message ? <span className="ml-2 text-emerald-200"><CheckCircle2 className="mr-1 inline h-4 w-4" />{message}</span> : null}
          </div>
          <Button variant="outline" className="tech-secondary w-full md:w-auto" onClick={clearWorkbenchData}>
            <Trash2 className="h-4 w-4" /> 清空测试数据
          </Button>
        </div>
      </div>
    </main>
  );
}
