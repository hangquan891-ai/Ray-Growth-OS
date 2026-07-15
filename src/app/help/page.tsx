"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  CheckCircle2,
  CircleHelp,
  MessageSquareText,
  Puzzle,
  Radar,
  Search,
  ShieldCheck,
} from "lucide-react";

import { LanguageToggle, useI18n } from "@/components/language-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type HelpSectionId = "search" | "engage" | "account" | "plugin";

type HelpSection = {
  id: HelpSectionId;
  title: string;
  shortTitle: string;
  summary: string;
  capabilities: string[];
  steps: string[];
  icon: ReactNode;
  accent: string;
  href?: string;
};

export default function HelpPage() {
  const { locale } = useI18n();
  const tr = (zh: string, en: string) => (locale === "en" ? en : zh);
  const [activeSection, setActiveSection] = useState<HelpSectionId>("search");

  const sections = useMemo<HelpSection[]>(() => [
    {
      id: "search",
      title: tr("定位找人", "Find people"),
      shortTitle: tr("定位找人", "Find people"),
      summary: tr("先明确账号定位，再用同一份定位发现值得互动的公开讨论。", "Define your positioning, then use it to discover public discussions worth joining."),
      capabilities: [
        tr("保存账号/产品、目标人群、增长目标和用户痛点。", "Stores your account or product, target audience, growth goal, and user pain points."),
        tr("根据定位生成可复制的 Grok 搜索 Prompt。", "Generates a reusable Grok search prompt from your positioning."),
        tr("支持手动搜索和配置中转后的一键自动查询。", "Supports manual search and one-click automatic queries after proxy setup."),
        tr("把确认后的搜索结果导入互动队列。", "Imports confirmed search results into the engagement queue."),
      ],
      steps: [
        tr("填写定位信息；不知道怎么写时，可先在设置里保存 X 主页，再用 AI 生成初稿。", "Fill in positioning. If unsure, save your X profile in Settings and let AI draft it."),
        tr("点击“保存当前定位”，避免未确认的编辑被当作正式定位。", "Choose “Save current positioning” so unconfirmed edits are not treated as final."),
        tr("选择手动或自动方式查找公开讨论。", "Choose manual or automatic discovery."),
        tr("检查解析结果，确认后点击“导入结果”。", "Review parsed results, then choose “Import results.”"),
      ],
      icon: <Search className="h-5 w-5" />,
      accent: "border-sky-300/20 bg-sky-400/10 text-sky-100",
      href: "/?tab=search",
    },
    {
      id: "engage",
      title: tr("互动队列", "Engagement queue"),
      shortTitle: tr("互动队列", "Queue"),
      summary: tr("筛选机会、生成回复并记录结果，是把讨论真正变成增长行动的地方。", "Filter opportunities, draft replies, and record outcomes—the place where discussions become growth actions."),
      capabilities: [
        tr("按时间、处理状态、反馈状态和优先级筛选讨论。", "Filters discussions by time, execution status, feedback, and priority."),
        tr("批量运行 AI 评分，并为选中的讨论生成回复草稿。", "Runs batch AI scoring and drafts replies for selected discussions."),
        tr("复制回复并跳转来源，减少在 App 和 X 之间来回操作。", "Copies a reply and opens its source in one action."),
        tr("保存已回复、被关注、被转发等反馈，用于后续复盘。", "Stores replies, follows, reposts, and other feedback for later learning."),
      ],
      steps: [
        tr("先按时间和优先级筛出少量值得互动的讨论。", "Filter to a small set of timely, high-priority discussions."),
        tr("勾选条目后运行 AI 评分或生成草稿。", "Select items, then run AI scoring or generate drafts."),
        tr("点击“复制回复并跳转来源”，由你本人在 X 完成回复。", "Choose “Copy reply and open source,” then post the reply yourself on X."),
        tr("回到队列记录处理状态；使用插件时，replyUrl 和公开反馈可自动回写。", "Record the outcome in the queue; with the extension, replyUrl and public feedback can sync automatically."),
      ],
      icon: <MessageSquareText className="h-5 w-5" />,
      accent: "border-emerald-300/20 bg-emerald-400/10 text-emerald-100",
      href: "/?tab=engage",
    },
    {
      id: "account",
      title: tr("竞品洞察", "Competitor insights"),
      shortTitle: tr("竞品洞察", "Insights"),
      summary: tr("从竞品、KOL 或社区的公开受众与讨论中，补充新的互动机会。", "Find extra opportunities in public audiences and discussions around competitors, KOLs, or communities."),
      capabilities: [
        tr("围绕竞品账号、KOL 和社区生成洞察查询。", "Builds insight queries around competitors, KOLs, and communities."),
        tr("发现正在讨论相关痛点、替代方案或工作流的人。", "Finds people discussing relevant pain points, alternatives, or workflows."),
        tr("将确认后的结果补充到同一个互动队列。", "Adds confirmed results to the same engagement queue."),
        tr("这是可选的机会扩展工具，不影响主流程使用。", "This is an optional opportunity-expansion tool and is not required for the core flow."),
      ],
      steps: [
        tr("输入要观察的竞品、KOL、账号或社区。", "Enter the competitor, KOL, account, or community to inspect."),
        tr("复制 Prompt 手动查询，或配置 Grok 中转后一键查询。", "Copy the prompt for manual search, or configure Grok proxy for one-click search."),
        tr("只保留与定位和目标用户真正相关的讨论。", "Keep only discussions that genuinely match your positioning and audience."),
        tr("导入队列后，继续使用相同的评分和互动流程。", "After importing, use the same scoring and engagement workflow."),
      ],
      icon: <Radar className="h-5 w-5" />,
      accent: "border-violet-300/20 bg-violet-400/10 text-violet-100",
      href: "/?tab=account",
    },
    {
      id: "plugin",
      title: "Ray Growth OS X Helper",
      shortTitle: tr("X 助手插件", "X Helper"),
      summary: tr("连接互动队列和已登录的 X 页面，自动记录回复链接并回写公开反馈。", "Connects the engagement queue to your signed-in X page, records reply links, and syncs public feedback."),
      capabilities: [
        tr("从 App 点击打开原帖时，自动关联当前队列条目并同步 X 用户名。", "Automatically associates the current queue item and syncs your X username when you open a source post from the App."),
        tr("识别你本人发布的公开回复并保存 replyUrl。", "Detects your own public reply and stores its replyUrl."),
        tr("巡检已记录回复的公开回复、引用和转发结果。", "Checks recorded replies for public replies, quotes, and reposts."),
        tr("不会自动替你发布内容，也不会读取私信或绕过登录。", "Never posts on your behalf, reads DMs, or bypasses login."),
      ],
      steps: [
        tr("打开 chrome://extensions，开启开发者模式，点击“加载已解压的扩展程序”，选择 extension/ray-growth-os-x-helper。", "Open chrome://extensions, enable Developer mode, choose “Load unpacked,” and select extension/ray-growth-os-x-helper."),
        tr("在 App 设置里保存 X 主页，或在插件里保存一次 X 用户名。插件弹窗不需要保持打开。", "Save your X profile in App Settings, or save your X username once in the extension. The popup does not need to stay open."),
        tr("在互动队列点击“复制回复并打开原帖”。插件会自动读取并关联这一条，不需要手动读取队列。", "Choose “Copy reply and open source post” in the engagement queue. The extension reads and associates that item automatically; no manual queue sync is needed."),
        tr("由你本人在打开的 X 原帖页面发布回复；回复显示后，插件会自动保存 replyUrl 并回写 App。", "Post the reply yourself on the opened X source post. Once it appears, the extension saves its replyUrl and syncs it to the App automatically."),
        tr("若没有自动回写，就停留在原帖页点击“找回当前页回复并回写”。", "If automatic sync does not happen, stay on the source post and choose “Find reply on current page and sync.”"),
        tr("过一段时间后点击“巡检已记录的回复链接”检查公开反馈；“手动回写暂存反馈”只用于 App 当时没有成功接收的情况。", "Later, choose “Check recorded reply links” to inspect public feedback. “Manually sync stored feedback” is only for cases where the App did not receive an update."),
      ],
      icon: <Puzzle className="h-5 w-5" />,
      accent: "border-amber-300/20 bg-amber-400/10 text-amber-100",
    },
  ], [locale]);

  useEffect(() => {
    const requested = window.location.hash.replace(/^#/, "") as HelpSectionId;
    if (sections.some((section) => section.id === requested)) setActiveSection(requested);

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((left, right) => right.intersectionRatio - left.intersectionRatio)[0];
        if (visible?.target.id) setActiveSection(visible.target.id as HelpSectionId);
      },
      { rootMargin: "-18% 0px -62% 0px", threshold: [0.15, 0.4, 0.7] }
    );

    sections.forEach((section) => {
      const element = document.getElementById(section.id);
      if (element) observer.observe(element);
    });
    return () => observer.disconnect();
  }, [sections]);

  return (
    <main className="surface-grid tech-shell min-h-screen text-white">
      <header className="sticky top-0 z-40 border-b border-white/[0.07] bg-[#08090d]/90 px-4 py-3 backdrop-blur-xl sm:px-6 lg:px-8">
        <div className="mx-auto flex max-w-[1480px] flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-blue-300/15 bg-blue-400/10 text-blue-100">
              <BookOpen className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <p className="truncate text-sm font-black">Ray Growth OS</p>
                <Badge variant="outline" className="rounded-md border-white/[0.08] bg-white/[0.04] text-white/50">{tr("帮助中心", "Help center")}</Badge>
              </div>
              <p className="mt-1 text-xs text-white/40">{tr("页面与插件使用说明", "Page and extension guide")}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <LanguageToggle />
            <Button asChild variant="outline" size="sm" className="tech-secondary h-9 w-auto">
              <Link href="/"><ArrowLeft className="h-4 w-4" /> {tr("返回工作台", "Back to workbench")}</Link>
            </Button>
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-[1480px] grid-cols-[minmax(0,1fr)] gap-5 px-4 py-5 sm:px-6 lg:grid-cols-[260px_minmax(0,1fr)] lg:px-8 lg:py-8">
        <aside className="min-w-0 lg:sticky lg:top-24 lg:self-start">
          <div className="max-w-full rounded-lg border border-white/[0.08] bg-[#0b0d12]/88 p-3 shadow-2xl shadow-black/25 backdrop-blur-xl lg:p-4">
            <div className="mb-3 hidden items-center justify-between px-2 lg:flex">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.16em] text-white/35">{tr("帮助目录", "Contents")}</p>
                <p className="mt-1 text-[11px] text-white/25">{tr("4 个使用章节", "4 guide sections")}</p>
              </div>
              <CircleHelp className="h-4 w-4 text-blue-200/60" />
            </div>
            <nav className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden lg:grid lg:overflow-visible lg:pb-0" aria-label={tr("帮助目录", "Help contents")}> 
              {sections.map((section, index) => (
                <a
                  key={section.id}
                  href={`#${section.id}`}
                  onClick={() => setActiveSection(section.id)}
                  className={cn(
                    "group flex min-w-max items-center gap-3 rounded-lg border px-3 py-2.5 text-left text-sm transition-all lg:min-w-0",
                    activeSection === section.id
                      ? "border-blue-300/20 bg-blue-400/10 text-white"
                      : "border-transparent text-white/45 hover:border-white/[0.07] hover:bg-white/[0.035] hover:text-white/75"
                  )}
                >
                  <span className={cn("grid h-8 w-8 shrink-0 place-items-center rounded-md border", activeSection === section.id ? section.accent : "border-white/[0.07] bg-white/[0.025] text-white/35")}>{section.icon}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[10px] font-bold text-white/25">0{index + 1}</span>
                    <span className="block truncate font-bold">{section.shortTitle}</span>
                  </span>
                  <ArrowRight className={cn("hidden h-4 w-4 shrink-0 lg:block", activeSection === section.id ? "text-blue-200" : "text-white/15 group-hover:text-white/40")} />
                </a>
              ))}
            </nav>
          </div>
        </aside>

        <div className="min-w-0">
          <section className="hero-card overflow-hidden rounded-xl border p-5 sm:p-8 lg:p-10">
            <Badge variant="outline" className="rounded-md border-emerald-300/20 bg-emerald-400/10 text-emerald-100">
              <BookOpen className="mr-1 h-3.5 w-3.5" /> {tr("从这里开始", "Start here")}
            </Badge>
            <h1 className="mt-5 max-w-4xl text-3xl font-black leading-[1.04] tracking-[-0.035em] sm:text-5xl lg:text-6xl">
              {tr("看懂每个页面，完成第一次增长闭环。", "Understand every page. Complete your first growth loop.")}
            </h1>
            <p className="mt-4 max-w-3xl text-sm leading-7 text-white/55 sm:text-base">
              {tr("Ray Growth OS 把公开讨论变成可执行的互动机会。按“定位 → 找讨论 → 排优先级 → 回复 → 记录反馈”的顺序使用，就不会迷路。", "Ray Growth OS turns public discussions into actionable opportunities. Follow positioning → discovery → prioritization → reply → feedback to stay on track.")}
            </p>
            <div className="mt-6 grid gap-2 sm:grid-cols-4">
              {[
                tr("完善定位", "Position"),
                tr("找到讨论", "Discover"),
                tr("筛选互动", "Prioritize"),
                tr("记录反馈", "Learn"),
              ].map((label, index) => (
                <div key={label} className="flex items-center gap-2 rounded-lg border border-white/[0.07] bg-white/[0.025] px-3 py-3 text-sm font-bold text-white/70">
                  <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-blue-400/10 text-xs text-blue-100">{index + 1}</span>
                  {label}
                </div>
              ))}
            </div>
          </section>

          <div className="mt-5 grid gap-5">
            {sections.map((section, index) => (
              <section key={section.id} id={section.id} className="scroll-mt-24 overflow-hidden rounded-xl border border-white/[0.08] bg-[#0b0d12]/82 shadow-2xl shadow-black/20 backdrop-blur-xl">
                <div className="flex flex-col gap-4 border-b border-white/[0.07] bg-white/[0.018] p-5 sm:flex-row sm:items-start sm:justify-between sm:p-7">
                  <div className="flex min-w-0 items-start gap-4">
                    <span className={cn("grid h-12 w-12 shrink-0 place-items-center rounded-lg border", section.accent)}>{section.icon}</span>
                    <div className="min-w-0">
                      <p className="text-xs font-black uppercase tracking-[0.16em] text-white/25">{tr(`第 ${index + 1} 章`, `Chapter ${index + 1}`)}</p>
                      <h2 className="mt-1 text-2xl font-black text-white sm:text-3xl">{section.title}</h2>
                      <p className="mt-2 max-w-3xl text-sm leading-6 text-white/50">{section.summary}</p>
                    </div>
                  </div>
                  {section.href ? (
                    <Button asChild variant="outline" size="sm" className="tech-secondary h-9 w-full shrink-0 sm:w-auto">
                      <Link href={section.href}>{tr("打开这个页面", "Open this page")} <ArrowRight className="h-4 w-4" /></Link>
                    </Button>
                  ) : null}
                </div>

                <div className="grid gap-7 p-5 sm:p-7 xl:grid-cols-[0.9fr_1.1fr]">
                  <div>
                    <div className="flex items-center gap-2 text-sm font-black text-white">
                      <ShieldCheck className="h-4 w-4 text-blue-200" /> {tr("它能做什么", "What it does")}
                    </div>
                    <div className="mt-4 grid gap-3">
                      {section.capabilities.map((item) => (
                        <div key={item} className="flex items-start gap-3 rounded-lg border border-white/[0.06] bg-white/[0.02] p-3 text-sm leading-6 text-white/58">
                          <CheckCircle2 className="mt-1 h-4 w-4 shrink-0 text-emerald-300" />
                          <span>{item}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div>
                    <div className="flex items-center gap-2 text-sm font-black text-white">
                      <BookOpen className="h-4 w-4 text-amber-200" /> {tr("如何使用", "How to use it")}
                    </div>
                    <ol className="mt-4 grid gap-3">
                      {section.steps.map((step, stepIndex) => (
                        <li key={step} className="flex items-start gap-3">
                          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full border border-amber-300/15 bg-amber-400/[0.08] text-xs font-black text-amber-100">{stepIndex + 1}</span>
                          <p className="pt-0.5 text-sm leading-6 text-white/58">{step}</p>
                        </li>
                      ))}
                    </ol>
                  </div>
                </div>
              </section>
            ))}
          </div>

          <div className="mt-5 flex flex-col gap-4 rounded-xl border border-blue-300/15 bg-blue-400/[0.06] p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
            <div>
              <p className="font-black">{tr("还是不知道从哪里开始？", "Still not sure where to start?")}</p>
              <p className="mt-1 text-sm leading-6 text-white/50">{tr("回到工作台打开“新手任务”，系统会把你带到下一步需要操作的位置。", "Return to the workbench and open Getting started. It will take you to the exact place for the next action.")}</p>
            </div>
            <Button asChild className="tech-cta w-full shrink-0 sm:w-auto">
              <Link href="/?guide=1">{tr("返回并查看新手任务", "Open getting started")} <ArrowRight className="h-4 w-4" /></Link>
            </Button>
          </div>
        </div>
      </div>
    </main>
  );
}
