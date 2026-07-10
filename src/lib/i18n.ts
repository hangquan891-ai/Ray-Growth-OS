export type AppLocale = "zh-CN" | "en";

export const LOCALE_STORAGE_KEY = "ray-growth-os:locale:v1";

export const SUPPORTED_LOCALES: Array<{ value: AppLocale; label: string; shortLabel: string }> = [
  { value: "zh-CN", label: "中文", shortLabel: "中文" },
  { value: "en", label: "English", shortLabel: "EN" },
];

export function normalizeLocale(value: unknown): AppLocale {
  return value === "en" || String(value ?? "").toLowerCase().startsWith("en") ? "en" : "zh-CN";
}

export function outputLanguage(locale: unknown) {
  return normalizeLocale(locale) === "en" ? "English" : "Simplified Chinese";
}

const copy = {
  "zh-CN": {
    language: "语言",
    settings: "设置",
    localMvp: "本地 MVP",
    growthOpportunities: "增长机会",
    urgentActions: "个紧急动作",
    overview: "总览",
    findPeople: "定位找人",
    findShort: "找人",
    engageQueue: "互动队列",
    engageShort: "互动",
    competitorInsights: "竞品洞察",
    competitorShort: "竞品",
    insightTools: "洞察工具",
    csv: "CSV",
    aiWorkflow: "AI 工作流",
    growthLoop: "增长闭环",
    manualSearch: "手动搜索",
    automaticSearch: "自动查询",
    copyPrompt: "复制 Prompt",
    openGrok: "打开 Grok",
    importResults: "导入结果",
    configure: "配置",
    configured: "已配置",
    notConfigured: "未配置",
    save: "保存",
    clear: "清空",
    backToWorkbench: "返回工作台",
    apiSettings: "AI 接口配置",
    keySettings: "密钥设置",
    settingsIntro: "配置 Grok 搜索、AI 评分/草稿，以及 AI 帮填定位使用的公开 X 主页。",
    grokSearch: "Grok 搜索",
    aiScoringDrafts: "AI 评分与草稿",
    xProfile: "X 公开主页",
    localStorage: "本地保存说明",
    switchLanguage: "切换界面语言",
  },
  en: {
    language: "Language",
    settings: "Settings",
    localMvp: "Local MVP",
    growthOpportunities: "Growth opportunities",
    urgentActions: "urgent actions",
    overview: "Overview",
    findPeople: "Find people",
    findShort: "Find",
    engageQueue: "Engagement queue",
    engageShort: "Queue",
    competitorInsights: "Competitor insights",
    competitorShort: "Insights",
    insightTools: "Insight tools",
    csv: "CSV",
    aiWorkflow: "AI workflow",
    growthLoop: "Growth loop",
    manualSearch: "Manual search",
    automaticSearch: "Automatic search",
    copyPrompt: "Copy prompt",
    openGrok: "Open Grok",
    importResults: "Import results",
    configure: "Configure",
    configured: "Configured",
    notConfigured: "Not configured",
    save: "Save",
    clear: "Clear",
    backToWorkbench: "Back to workbench",
    apiSettings: "AI connection settings",
    keySettings: "API key settings",
    settingsIntro: "Configure Grok search, AI scoring and drafts, and the public X profile used for positioning suggestions.",
    grokSearch: "Grok discovery",
    aiScoringDrafts: "AI scoring & drafts",
    xProfile: "Public X profile",
    localStorage: "Local storage",
    switchLanguage: "Switch interface language",
  },
} as const;

export type TranslationKey = keyof (typeof copy)["zh-CN"];

export function translate(locale: AppLocale, key: TranslationKey) {
  return copy[locale][key];
}
