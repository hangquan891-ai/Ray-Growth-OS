(function initOutbound(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  root.Outbound = api;
})(typeof globalThis !== "undefined" ? globalThis : window, function createOutboundApi() {
  const CHANNELS = ["X"];
  const GROWTH_CHANNELS = ["X"];

  const INTENT_TERMS = [
    "求推荐",
    "怎么找",
    "找不到",
    "有没有工具",
    "替代",
    "alternative",
    "looking for",
    "recommend",
    "help",
    "need",
    "trial",
    "付费",
    "购买",
  ];

  const REPLYABLE_TERMS = [
    "问",
    "怎么",
    "为什么",
    "求",
    "卡住",
    "0 流量",
    "没流量",
    "第一批用户",
    "找用户",
    "找客户",
    "踩坑",
    "求推荐",
    "help",
    "how",
    "why",
  ];

  const FILLER_WORDS = new Set([
    "的",
    "了",
    "和",
    "我",
    "一个",
    "没有",
    "怎么",
    "the",
    "and",
    "for",
    "with",
    "that",
  ]);

  function cleanText(value) {
    return String(value ?? "").trim();
  }

  function splitList(value) {
    return cleanText(value)
      .split(/[,，、\n]/)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  function unique(items) {
    return [...new Set(items.filter(Boolean))];
  }

  function tokenize(value) {
    const text = cleanText(value).toLowerCase();
    const latin = text.match(/[a-z0-9][a-z0-9+-]{1,}/g) ?? [];
    const cjk = text.match(/[\u4e00-\u9fff]{2,}/g) ?? [];
    return unique([...latin, ...cjk]).filter((token) => !FILLER_WORDS.has(token));
  }

  function containsAny(text, terms) {
    const normalized = cleanText(text).toLowerCase();
    return terms.some((term) => normalized.includes(cleanText(term).toLowerCase()));
  }

  function clampScore(score) {
    return Math.max(0, Math.min(100, Math.round(score)));
  }

  function scoreLabel(score) {
    if (score >= 70) return "High intent";
    if (score >= 40) return "Warm";
    return "Low";
  }

  function growthLabel(score) {
    if (score >= 70) return "Engage now";
    if (score >= 40) return "Watch";
    return "Skip";
  }

  function shorten(text, maxLength) {
    const value = cleanText(text);
    return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
  }

  function buildQuery(channel, phrase, product, intent) {
    const target = cleanText(product.targetCustomer) || "SaaS 创始人";
    const competitor = splitList(product.competitors)[0] || cleanText(product.name);

    if (channel === "X") {
      return `"${phrase}" ("${target}" OR SaaS OR indie)`;
    }
    if (channel === "Reddit") {
      return `site:reddit.com "${phrase}" ("${target}" OR SaaS)`;
    }
    if (channel === "GitHub") {
      return `site:github.com "${phrase}" "${competitor}"`;
    }
    return `"${phrase}" "${target}" ${intent}`;
  }

  function buildGrowthQuery(channel, phrase, profile, intent) {
    const reader = splitList(profile.targetReaders)[0] || "独立开发者";
    const pillar = splitList(profile.contentPillars)[0] || "AI Coding";

    if (channel === "X") {
      return `"${phrase}" ("${reader}" OR "${pillar}") -is:retweet`;
    }
    if (channel === "Reddit") {
      return `site:reddit.com "${phrase}" "${reader}"`;
    }
    if (channel === "GitHub") {
      return `site:github.com "${phrase}" "${pillar}"`;
    }
    return `"${phrase}" "${reader}" ${intent}`;
  }

  function generateSearchQueries(product) {
    const hasInput = [product.name, product.description, product.targetCustomer, product.competitors, product.painPoints].some((value) => cleanText(value));
    if (!hasInput) return [];

    const painPoints = splitList(product.painPoints);
    const competitors = splitList(product.competitors);
    const descriptionTokens = tokenize(product.description);
    const fallbackTerms = ["找不到付费用户", "SEO 太慢", "first customers"];
    const phrases = unique([
      ...painPoints,
      ...competitors.map((name) => `${name} alternative`),
      ...descriptionTokens.slice(0, 4),
      ...fallbackTerms,
    ]).slice(0, 12);

    const seeds = phrases.length >= 3 ? phrases : fallbackTerms;
    const intents = ["求助", "替代方案", "购买意图"];

    return CHANNELS.flatMap((channel) =>
      seeds.slice(0, 3).map((phrase, index) => ({
        channel,
        intent: intents[index] ?? "需求发现",
        query: buildQuery(channel, phrase, product, intents[index] ?? "需求发现"),
      }))
    );
  }

  function generateGrowthQueries(profile) {
    const hasInput = [profile.accountName, profile.positioning, profile.targetReaders, profile.contentPillars, profile.growthGoals].some((value) => cleanText(value));
    if (!hasInput) return [];

    const readers = splitList(profile.targetReaders);
    const pillars = splitList(profile.contentPillars);
    const goals = splitList(profile.growthGoals);
    const positionTokens = tokenize(profile.positioning);
    const fallbackTerms = ["AI Coding", "独立开发者", "0 流量"];
    const phrases = unique([
      ...pillars,
      ...readers,
      ...goals,
      ...positionTokens.slice(0, 4),
      ...fallbackTerms,
    ]).slice(0, 12);

    const seeds = phrases.length >= 3 ? phrases : fallbackTerms;
    const intents = ["找讨论", "找痛点", "找可回复问题"];

    return GROWTH_CHANNELS.flatMap((channel) =>
      seeds.slice(0, 3).map((phrase, index) => ({
        channel,
        intent: intents[index] ?? "增长机会",
        query: buildGrowthQuery(channel, phrase, profile, intents[index] ?? "增长机会"),
      }))
    );
  }

  function parseLeadInput(input) {
    return cleanText(input)
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const parts = line.split("|").map((part) => part.trim());
        const [platform = "未知渠道", name = "未命名线索", url = "", ...noteParts] = parts;
        return {
          platform,
          name,
          url,
          note: noteParts.join(" | ").trim(),
        };
      });
  }

  function scoreLead(lead, product) {
    const text = [lead.platform, lead.name, lead.url, lead.note].map(cleanText).join(" ");
    const painTerms = splitList(product.painPoints);
    const targetTokens = tokenize(product.targetCustomer);
    const productTokens = tokenize(`${product.name} ${product.description}`);
    const competitorTerms = splitList(product.competitors);

    let score = 10;
    const reasons = [];

    if (containsAny(text, painTerms)) {
      score += 35;
      reasons.push("痛点匹配");
    }
    if (containsAny(text, INTENT_TERMS)) {
      score += 25;
      reasons.push("购买/求助意图");
    }
    if (containsAny(text, targetTokens)) {
      score += 15;
      reasons.push("目标用户匹配");
    }
    if (containsAny(text, productTokens)) {
      score += 10;
      reasons.push("场景相关");
    }
    if (containsAny(text, competitorTerms)) {
      score += 10;
      reasons.push("竞品/替代需求");
    }
    if (/https?:\/\//i.test(cleanText(lead.url))) {
      score += 5;
      reasons.push("可回访链接");
    }

    const finalScore = clampScore(score);
    return {
      score: finalScore,
      label: scoreLabel(finalScore),
      reasons: reasons.length > 0 ? reasons : ["弱相关线索"],
    };
  }

  function scoreGrowthOpportunity(candidate, profile) {
    const text = [candidate.platform, candidate.name, candidate.url, candidate.note].map(cleanText).join(" ");
    const readerTerms = splitList(profile.targetReaders);
    const readerTokens = tokenize(profile.targetReaders);
    const pillarTerms = splitList(profile.contentPillars);
    const pillarTokens = tokenize(profile.contentPillars);
    const positioningTokens = tokenize(profile.positioning);

    let score = 10;
    const reasons = [];

    if (containsAny(text, [...readerTerms, ...readerTokens])) {
      score += 25;
      reasons.push("读者匹配");
    }
    if (containsAny(text, [...pillarTerms, ...pillarTokens, ...positioningTokens])) {
      score += 25;
      reasons.push("内容支柱匹配");
    }
    if (containsAny(text, REPLYABLE_TERMS)) {
      score += 25;
      reasons.push("可回复痛点");
    }
    if (containsAny(text, INTENT_TERMS)) {
      score += 15;
      reasons.push("潜在需求信号");
    }
    if (containsAny(text, ["转发", "引用", "讨论", "分享", "thread", "launch", "上线"])) {
      score += 10;
      reasons.push("适合公开互动");
    }
    if (/https?:\/\//i.test(cleanText(candidate.url))) {
      score += 5;
      reasons.push("可回访链接");
    }
    if (reasons.includes("内容支柱匹配") && reasons.includes("可回复痛点")) {
      score += 10;
      reasons.push("可延展选题");
    }

    const finalScore = clampScore(score);
    return {
      score: finalScore,
      label: growthLabel(finalScore),
      reasons: reasons.length > 0 ? reasons : ["暂不相关"],
    };
  }

  function generateOutreachDraft(lead, product) {
    const name = cleanText(lead.name) || "你好";
    const productName = cleanText(product.name) || "这个工具";
    const rawPain = cleanText(lead.note) || "你正在找更有效的获客方式";
    const pain = shorten(rawPain, 46);
    const draft = `${name}，看到你提到「${pain}」。我在做 ${productName}，可以帮你先把目标客户关键词、线索评分和第一版触达话术跑出来。要不要我用你的产品免费试跑 10 条线索？`;

    return draft.length <= 220 ? draft : `${draft.slice(0, 217)}...`;
  }

  function generateGrowthDrafts(candidate, profile) {
    const note = cleanText(candidate.note) || "这个话题";
    const pain = shorten(note, 42);
    const pillar = splitList(profile.contentPillars)[0] || "AI Coding";
    const reader = splitList(profile.targetReaders)[0] || "独立开发者";

    const reply = `这个点很真实。${pain} 时，先别急着做大功能，第一批用户可以从 20 个同类人的真实问题里挖，再把反馈沉淀成产品迭代和内容选题。`;
    const quote = `${pillar} 能把产品做快，但增长还是要回到真实用户。这个案例适合 ${reader} 看：先找问题密度高的人，再决定做什么。`;
    const postIdea = `从「${shorten(note, 28)}」延展一条原创帖：产品上线 0 流量时，独立开发者如何用 AI 找到第一批用户。`;
    const identity = cleanText(profile.accountName) || "我";
    const positioning = shorten(cleanText(profile.positioning) || `${pillar} 实践`, 36);
    const outreach = `${candidate.name || "你好"}，看到你提到「${pain}」。我是 ${identity}，主要在做 ${positioning}。如果你愿意，我可以结合你的场景分享一个更具体的做法，看看是否有帮助。`;

    return {
      reply: reply.length <= 220 ? reply : `${reply.slice(0, 217)}...`,
      quote: quote.length <= 220 ? quote : `${quote.slice(0, 217)}...`,
      postIdea,
      outreach: outreach.length <= 220 ? outreach : `${outreach.slice(0, 217)}...`,
      action: candidate.label === "Engage now" ? "优先回复或引用" : candidate.label === "Watch" ? "收藏观察" : "暂时跳过",
    };
  }

  function runOutboundWorkflow(product, leadInput) {
    const queries = generateSearchQueries(product);
    const leads = parseLeadInput(leadInput)
      .map((lead) => {
        const score = scoreLead(lead, product);
        const scoredLead = { ...lead, ...score };
        return {
          ...scoredLead,
          draft: generateOutreachDraft(scoredLead, product),
        };
      })
      .sort((left, right) => right.score - left.score);

    return { queries, leads };
  }

  function runGrowthWorkflow(profile, candidateInput) {
    const queries = generateGrowthQueries(profile);
    const opportunities = parseLeadInput(candidateInput)
      .map((candidate) => {
        const score = scoreGrowthOpportunity(candidate, profile);
        const scoredCandidate = { ...candidate, ...score };
        const drafts = generateGrowthDrafts(scoredCandidate, profile);
        return {
          ...scoredCandidate,
          replyDraft: drafts.reply,
          quoteDraft: drafts.quote,
          postIdea: drafts.postIdea,
          outreachDraft: drafts.outreach,
          action: drafts.action,
        };
      })
      .sort((left, right) => right.score - left.score);

    return { queries, opportunities };
  }

  return {
    generateGrowthDrafts,
    generateGrowthQueries,
    generateOutreachDraft,
    generateSearchQueries,
    parseLeadInput,
    runGrowthWorkflow,
    runOutboundWorkflow,
    scoreGrowthOpportunity,
    scoreLead,
  };
});
