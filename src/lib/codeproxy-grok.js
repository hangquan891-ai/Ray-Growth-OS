(function initCodeProxyGrok(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  root.CodeProxyGrok = api;
})(typeof globalThis !== "undefined" ? globalThis : window, function createCodeProxyGrokApi() {
  const CODEPROXY_BASE_URL = "https://codeproxy.dev";
  const DEFAULT_GROK_PROXY_MODEL = "grok-4.3-fast";
  const DEFAULT_AI_RESPONSE_MODEL = "gpt-5.5";
  const GROK_PROXY_CONFIG_STORAGE_KEY = "ray-growth-os:grok-proxy-config:v1";
  const AI_RESPONSE_CONFIG_STORAGE_KEY = "ray-growth-os:ai-response-config:v1";
  const X_PROFILE_CONFIG_STORAGE_KEY = "ray-growth-os:x-profile-config:v1";
  const ANTHROPIC_VERSION = "2023-06-01";

  function clean(value) {
    return String(value ?? "").trim();
  }

  function clampInteger(value, fallback, min, max) {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.max(min, Math.min(max, Math.round(number)));
  }

  function clampTemperature(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return 0.2;
    return Math.max(0, Math.min(1, number));
  }

  function normalizeGrokProxyConfig(input) {
    const source = input && typeof input === "object" ? input : {};
    const apiKey = clean(source.apiKey);
    const model = clean(source.model);

    return {
      apiKey,
      model: model && model !== "grok-4" ? model : DEFAULT_GROK_PROXY_MODEL,
    };
  }

  function normalizeAiResponseConfig(input) {
    const source = input && typeof input === "object" ? input : {};
    const apiKey = clean(source.apiKey);
    const model = clean(source.model);

    return {
      apiKey,
      model: model || DEFAULT_AI_RESPONSE_MODEL,
    };
  }
  function normalizeXProfileConfig(input) {
    const source = input && typeof input === "object" ? input : {};
    return {
      profileUrl: normalizeXProfileUrl(source.profileUrl ?? source.url ?? ""),
    };
  }
  function buildCodeProxyMessageRequest({ prompt, model, maxTokens = 1800, temperature = 0.2 }) {
    return {
      url: `${CODEPROXY_BASE_URL}/v1/messages`,
      headers: {
        "Content-Type": "application/json",
        "anthropic-version": ANTHROPIC_VERSION,
      },
      body: {
        model: clean(model) || DEFAULT_GROK_PROXY_MODEL,
        messages: [{ role: "user", content: clean(prompt) }],
        max_tokens: clampInteger(maxTokens, 1800, 1, 8000),
        temperature: clampTemperature(temperature),
      },
    };
  }

  function buildStructuredGrokSignalPrompt(prompt) {
    const basePrompt = clean(prompt);
    return `${basePrompt}

Return only valid JSON. Do not use Markdown, code fences, tables, or extra commentary.
JSON shape:
{
  "accountRadar": {
    "accountType": "competitor | KOL | target_user | community | unknown",
    "competitorPosition": "what the target account appears to own or attract",
    "ourPosition": "how the user's product/account is positioned from the prompt",
    "audienceOverlap": "which audience segment overlaps and why it matters",
    "opportunityGap": "what this account does not fully solve that the user can speak to",
    "recommendedAngles": ["reply angle 1", "reply angle 2", "reply angle 3"],
    "nextStep": "one concrete next action before importing or replying",
    "keywords": ["search keyword", "pain keyword"],
    "riskNotes": "what is uncertain or should be verified"
  },
  "signals": [
    {
      "platform": "X",
      "author": "account or author name",
      "url": "https://x.com/.../status/... or empty string if unknown",
      "text": "one concise summary of the original discussion and pain point",
      "reason": "why this is worth replying to or saving",
      "tags": ["short topic tag", "intent tag"],
      "confidence": 0
    }
  ]
}
Rules:
- Return accountRadar when the task is account radar or competitor/KOL analysis; otherwise omit it or keep fields empty.
- Return 8-15 high-quality signals when possible; return fewer if quality is low.
- Never fabricate URLs. Use an empty string when the exact URL is unavailable.
- confidence must be an integer from 0 to 100.
- text and reason should be short enough to review quickly.
- If no useful signals are found, return {"signals":[]} or {"accountRadar": {...}, "signals":[]}.
`;
  }

  function normalizeXProfileUrl(value) {
    const raw = clean(value).replace(/^@+/, "");
    if (!raw) return "";

    if (/^https?:\/\//i.test(raw)) {
      try {
        const url = new URL(raw);
        const host = url.hostname.toLowerCase().replace(/^www\./, "");
        if (host !== "x.com" && host !== "twitter.com") return raw;
        const username = url.pathname.split("/").filter(Boolean)[0] || "";
        return username ? `https://x.com/${username}` : raw;
      } catch {
        return raw;
      }
    }

    const username = raw.split(/[/?#\s]/)[0];
    return username ? `https://x.com/${username}` : raw;
  }

  function extractXUsername(value) {
    const normalizedUrl = normalizeXProfileUrl(value);
    try {
      const url = new URL(normalizedUrl);
      const host = url.hostname.toLowerCase().replace(/^www\./, "");
      if (host !== "x.com" && host !== "twitter.com") return "";
      return url.pathname.split("/").filter(Boolean)[0] || "";
    } catch {
      return clean(value).replace(/^@+/, "").split(/[/?#\s]/)[0] || "";
    }
  }

  function buildXProfilePullPrompt({ profileUrl, contextPrompt, profileSnapshot = "" }) {
    const normalizedUrl = normalizeXProfileUrl(profileUrl);
    const basePrompt = clean(contextPrompt);
    const pulledData = clean(profileSnapshot);

    return `${basePrompt}

竞品洞察任务：对比一个公开 X 账号的定位与受众，并从周围挖可互动线索。
目标账号：${normalizedUrl}
${pulledData ? `\n竞品洞察已读取到的公开 X 数据：\n${pulledData}\n` : ""}
请把这个账号当成获客入口，而不是只分析主页本身。先做“目标账号 vs 我的产品/账号”的商业对比，再产出可导入的互动线索：
1. 判断它更像竞品账号、行业 KOL、社区账号、目标用户还是未知账号；如果像竞品或 KOL，优先挖它背后的受众和评论语境。
2. 对比它的定位和上方我的产品定位：受众重叠在哪里、它没有覆盖什么痛点、我方可以用什么角度切进去。
3. accountRadar 必须说明：账号类型、竞品/目标账号定位、我方定位、受众重叠、机会缺口、推荐切入角度、下一步动作和需要验证的关键词。
4. 从公开资料、近期内容语境和可见讨论里，找出可能有真实痛点、替代方案需求、购买意图或高互动价值的人和话题。
5. 每条 Signal 必须能进入互动队列：说明是谁、在哪里、为什么值得回复/引用/收藏，以及推荐切入角度。
6. 如果只能看到账号资料，也要围绕受众画像和可验证关键词给出少量高质量候选，不要硬凑数量。
7. 不要读取私信、后台数据、非公开数据；不要编造链接、账号、评论或互动。
8. 找不到足够高质量结果时少返回，而不是凑数。
9. 如果候选结果来自“我的账号/我方账号/目标账号本人”的帖子或主页，不要作为 Signal 返回；竞品洞察要找的是外部目标用户、竞品受众、评论者和相关讨论，不是我方自己。`;
  }
  function extractCodeProxyMessageText(response) {
    if (typeof response?.content === "string") return response.content;

    if (Array.isArray(response?.content)) {
      return response.content
        .map((item) => {
          if (typeof item === "string") return item;
          if (typeof item?.text === "string") return item.text;
          return "";
        })
        .filter(Boolean)
        .join("\n")
        .trim();
    }

    if (Array.isArray(response?.choices)) {
      return response.choices
        .map((choice) => choice?.message?.content ?? choice?.delta?.content ?? choice?.text ?? "")
        .filter(Boolean)
        .join("\n")
        .trim();
    }

    if (typeof response?.text === "string") return response.text;
    return "";
  }

  return {
    ANTHROPIC_VERSION,
    CODEPROXY_BASE_URL,
    DEFAULT_GROK_PROXY_MODEL,
    DEFAULT_AI_RESPONSE_MODEL,
    GROK_PROXY_CONFIG_STORAGE_KEY,
    AI_RESPONSE_CONFIG_STORAGE_KEY,
    X_PROFILE_CONFIG_STORAGE_KEY,
    buildCodeProxyMessageRequest,
    buildStructuredGrokSignalPrompt,
    buildXProfilePullPrompt,
    extractXUsername,
    normalizeXProfileUrl,
    normalizeGrokProxyConfig,
    normalizeAiResponseConfig,
    normalizeXProfileConfig,
    extractCodeProxyMessageText,
  };
});
