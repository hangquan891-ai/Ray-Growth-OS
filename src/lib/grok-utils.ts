export type GrokMode = "growth" | "outbound";

export type GrokPromptInput = {
  mode: GrokMode;
  name: string;
  description: string;
  targetCustomer: string;
  goalsOrCompetitors: string;
  pillarsOrPainPoints: string;
  keywords: string;
};

export type GrokSignal = {
  platform: string;
  name: string;
  url: string;
  note: string;
};

function clean(value: unknown) {
  return String(value ?? "").trim();
}

function trimBullet(value: string) {
  return value.replace(/^[-*•\d.\)\s]+/, "").trim();
}

function normalizeUrl(value: string) {
  return value.replace(/[),.;，。；）]+$/, "");
}

export function buildGrokSearchPrompt(input: GrokPromptInput) {
  const modeLabel = input.mode === "growth" ? "X 受众增长" : "X 主动获客";
  const action = input.mode === "growth" ? "适合公开回复、引用或延展成内容选题" : "有购买、试用、替代方案或明确求助意向";

  return `你是 Ray Growth OS 的线索雷达。请在 X 上帮我搜索最近 7 天的公开讨论，并只返回高质量候选信号。

模式：${modeLabel}
账号/产品：${clean(input.name)}
定位：${clean(input.description)}
目标用户：${clean(input.targetCustomer)}
增长目标/竞品：${clean(input.goalsOrCompetitors)}
内容支柱/痛点：${clean(input.pillarsOrPainPoints)}
搜索关键词：${clean(input.keywords) || "从上面的定位中自动判断"}

筛选标准：
1. 用户必须接近目标画像。
2. 内容里要有明确问题、痛点、求助、替代方案搜索或强互动价值。
3. 过滤纯吐槽、广告、抽奖、无上下文短句和明显垃圾内容。
4. 优先返回 ${action} 的帖子。
5. 排除我自己的账号、我方产品账号、自己发布的帖子或回复；只找外部目标用户、第三方讨论、竞品受众或潜在客户。

请返回 8-15 条结果。严格使用下面格式，每条一行，不要解释，不要 Markdown 表格：
X | 作者或账号 | 帖子链接 | 一句话摘要 + 为什么值得处理

如果找不到足够高质量结果，请少返回，不要编造链接。`;
}

export function parseGrokSignals(text: string): GrokSignal[] {
  const lines = clean(text)
    .split(/\r?\n/)
    .map((line) => trimBullet(line))
    .filter(Boolean);

  const signals: GrokSignal[] = [];
  const seen = new Set<string>();
  const xUrlPattern = /(https?:\/\/(?:www\.)?(?:x\.com|twitter\.com)\/[^\s)）]+)(?:\s|$)?/i;

  for (const line of lines) {
    const parts = line.split("|").map((part) => clean(part));
    if (parts.length >= 4) {
      const [platform, name, url, ...noteParts] = parts;
      const normalizedUrl = normalizeUrl(url);
      const note = noteParts.join(" | ");
      const key = normalizedUrl || `${name}-${note}`;
      if (note && !seen.has(key)) {
        seen.add(key);
        signals.push({ platform: platform || "X", name: name || "Grok 线索", url: normalizedUrl, note });
      }
      continue;
    }

    const match = line.match(xUrlPattern);
    if (match) {
      const url = normalizeUrl(match[1]);
      const urlObject = safeUrl(url);
      const name = urlObject?.pathname.split("/").filter(Boolean)[0] || "Grok 线索";
      const note = line.replace(match[1], "").replace(/[|:：-]+$/, "").trim() || line;
      if (!seen.has(url)) {
        seen.add(url);
        signals.push({ platform: "X", name, url, note });
      }
      continue;
    }

    if (line.length >= 20 && signals.length < 15) {
      const key = line.slice(0, 80);
      if (!seen.has(key)) {
        seen.add(key);
        signals.push({ platform: "X", name: "Grok 线索", url: "", note: line });
      }
    }
  }

  return signals.slice(0, 30);
}

function safeUrl(value: string) {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

export function formatSignalLines(signals: GrokSignal[]) {
  return signals.map((signal) => `${signal.platform} | ${signal.name} | ${signal.url} | ${signal.note}`).join("\n");
}