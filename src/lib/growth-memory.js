(function initGrowthMemory(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  root.GrowthMemory = api;
})(typeof globalThis !== "undefined" ? globalThis : window, function createGrowthMemoryApi() {
  const GROWTH_MEMORY_SAMPLE_LIMIT = 50;

  const DEFAULT_GROWTH_MEMORY_STATE = {
    active: false,
    generatedAt: "",
    appliedAt: "",
    sampleCount: 0,
    positiveCount: 0,
    noReplyCount: 0,
    summary: "",
    effectiveKeywords: [],
    weakKeywords: [],
    accountRadarKeywords: [],
    scoreBoostRules: [],
    scorePenaltyRules: [],
    replyStyleRules: [],
    avoidReplyPatterns: [],
    nextExperiment: "",
  };

  function clean(value) {
    return String(value ?? "").trim();
  }

  function normalizeLocale(locale) {
    return locale === "en" ? "en" : "zh-CN";
  }

  function cleanList(value, limit = 8) {
    return Array.isArray(value)
      ? Array.from(new Set(value.map(clean).filter(Boolean))).slice(0, limit)
      : [];
  }

  function clampScore(value, fallback = 0) {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.max(0, Math.min(100, Math.round(number)));
  }

  function clampWeight(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return 4;
    return Math.max(1, Math.min(12, Math.round(Math.abs(number))));
  }

  function normalizeFeedback(value) {
    const text = clean(value);
    return ["got_reply", "no_reply", "followed", "reshared"].includes(text) ? text : "";
  }

  function positiveFeedback(value) {
    return ["got_reply", "followed", "reshared"].includes(normalizeFeedback(value));
  }

  function normalizeRule(rule) {
    const source = rule && typeof rule === "object" ? rule : {};
    const pattern = clean(source.pattern);
    const reason = clean(source.reason);
    if (!pattern || !reason) return null;
    return {
      pattern,
      reason,
      weight: clampWeight(source.weight),
    };
  }

  function normalizeRules(value, limit = 6) {
    return Array.isArray(value) ? value.map(normalizeRule).filter(Boolean).slice(0, limit) : [];
  }

  function normalizeGrowthMemoryState(input) {
    const source = input && typeof input === "object" ? input : {};
    return {
      active: Boolean(source.active),
      generatedAt: clean(source.generatedAt),
      appliedAt: clean(source.appliedAt),
      sampleCount: Math.max(0, Math.round(Number(source.sampleCount) || 0)),
      positiveCount: Math.max(0, Math.round(Number(source.positiveCount) || 0)),
      noReplyCount: Math.max(0, Math.round(Number(source.noReplyCount) || 0)),
      summary: clean(source.summary),
      effectiveKeywords: cleanList(source.effectiveKeywords),
      weakKeywords: cleanList(source.weakKeywords),
      accountRadarKeywords: cleanList(source.accountRadarKeywords),
      scoreBoostRules: normalizeRules(source.scoreBoostRules),
      scorePenaltyRules: normalizeRules(source.scorePenaltyRules),
      replyStyleRules: cleanList(source.replyStyleRules, 8),
      avoidReplyPatterns: cleanList(source.avoidReplyPatterns, 8),
      nextExperiment: clean(source.nextExperiment),
    };
  }

  function itemText(item) {
    return [item?.platform, item?.name ?? item?.author, item?.note ?? item?.text, item?.label, item?.action, ...(Array.isArray(item?.reasons) ? item.reasons : [])]
      .map(clean)
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
  }

  function ruleMatches(text, rule) {
    const pattern = clean(rule?.pattern).toLowerCase();
    if (!pattern) return false;
    return text.includes(pattern);
  }

  function labelFromScore(score, mode) {
    if (mode === "outbound") {
      if (score >= 70) return "High intent";
      if (score >= 40) return "Warm";
      return "Low";
    }
    if (score >= 70) return "Engage now";
    if (score >= 40) return "Watch";
    return "Skip";
  }

  function applyGrowthMemoryToQueueItems(result, memoryInput) {
    const memory = normalizeGrowthMemoryState(memoryInput);
    if (!memory.active) return result;

    const mode = result?.mode === "outbound" ? "outbound" : "growth";
    const applyToItem = (item) => {
      const text = itemText(item);
      const boosts = memory.scoreBoostRules.filter((rule) => ruleMatches(text, rule));
      const penalties = memory.scorePenaltyRules.filter((rule) => ruleMatches(text, rule));
      if (!boosts.length && !penalties.length) return item;

      const delta = boosts.reduce((sum, rule) => sum + rule.weight, 0) - penalties.reduce((sum, rule) => sum + rule.weight, 0);
      const nextScore = clampScore(Number(item.score) + delta, Number(item.score) || 0);
      const memoryReasons = [
        ...boosts.map((rule) => `增长记忆 +${rule.weight}: ${rule.reason}`),
        ...penalties.map((rule) => `增长记忆 -${rule.weight}: ${rule.reason}`),
      ];

      return {
        ...item,
        score: nextScore,
        label: labelFromScore(nextScore, mode),
        reasons: [...memoryReasons, ...(Array.isArray(item.reasons) ? item.reasons : [])].slice(0, 5),
        growthMemoryApplied: true,
      };
    };

    if (mode === "outbound") {
      return {
        ...result,
        leads: [...(result?.leads ?? []).map(applyToItem)].sort((left, right) => right.score - left.score),
      };
    }

    return {
      ...result,
      opportunities: [...(result?.opportunities ?? []).map(applyToItem)].sort((left, right) => right.score - left.score),
    };
  }

  function buildGrowthMemoryRequestInput({ mode: modeInput, profile, signals, aiScores, aiDrafts, locale }) {
    const mode = modeInput === "outbound" ? "outbound" : "growth";
    const scoreMap = aiScores && typeof aiScores === "object" ? aiScores : {};
    const draftMap = aiDrafts && typeof aiDrafts === "object" ? aiDrafts : {};
    const samples = (Array.isArray(signals) ? signals : [])
      .filter((signal) => normalizeFeedback(signal?.feedback))
      .sort((left, right) => new Date(right.feedbackAt || right.processedAt || 0).getTime() - new Date(left.feedbackAt || left.processedAt || 0).getTime())
      .slice(0, GROWTH_MEMORY_SAMPLE_LIMIT)
      .map((signal) => {
        const possibleScore = [scoreMap[clean(signal.id)], scoreMap[`url:${clean(signal.url).replace(/\/$/, "")}`]].find(Boolean);
        const possibleDraft = [draftMap[clean(signal.id)], draftMap[`url:${clean(signal.url).replace(/\/$/, "")}`]].find(Boolean);
        return {
          platform: clean(signal.platform),
          author: clean(signal.author),
          url: clean(signal.url),
          text: clean(signal.text),
          tags: cleanList(signal.tags, 6),
          reason: clean(signal.reason),
          confidence: clampScore(signal.confidence),
          status: clean(signal.status),
          feedback: normalizeFeedback(signal.feedback),
          feedbackAt: clean(signal.feedbackAt),
          usedDraft: clean(signal.usedDraft),
          score: possibleScore
            ? {
                score: clampScore(possibleScore.score),
                label: clean(possibleScore.label),
                reason: clean(possibleScore.reason),
                suggestedAngle: clean(possibleScore.suggestedAngle),
              }
            : null,
          draft: possibleDraft
            ? {
                replyDraft: clean(possibleDraft.replyDraft ?? possibleDraft.draft),
                quoteDraft: clean(possibleDraft.quoteDraft),
                postIdea: clean(possibleDraft.postIdea),
                rationale: clean(possibleDraft.rationale),
                toneNotes: clean(possibleDraft.toneNotes),
              }
            : null,
        };
      });

    return {
      mode,
      locale: normalizeLocale(locale),
      profile: {
        productName: clean(profile?.productName),
        description: clean(profile?.description),
        targetCustomer: clean(profile?.targetCustomer),
        competitors: clean(profile?.competitors),
        painPoints: clean(profile?.painPoints),
      },
      sampleSummary: {
        total: samples.length,
        positive: samples.filter((sample) => positiveFeedback(sample.feedback)).length,
        noReply: samples.filter((sample) => sample.feedback === "no_reply").length,
      },
      samples,
    };
  }

  function createGrowthMemoryResponseSchema() {
    const ruleSchema = {
      type: "object",
      additionalProperties: false,
      required: ["pattern", "reason", "weight"],
      properties: {
        pattern: { type: "string" },
        reason: { type: "string" },
        weight: { type: "integer" },
      },
    };

    return {
      type: "object",
      additionalProperties: false,
      required: [
        "summary",
        "effectiveKeywords",
        "weakKeywords",
        "accountRadarKeywords",
        "scoreBoostRules",
        "scorePenaltyRules",
        "replyStyleRules",
        "avoidReplyPatterns",
        "nextExperiment",
      ],
      properties: {
        summary: { type: "string" },
        effectiveKeywords: { type: "array", items: { type: "string" } },
        weakKeywords: { type: "array", items: { type: "string" } },
        accountRadarKeywords: { type: "array", items: { type: "string" } },
        scoreBoostRules: { type: "array", items: ruleSchema },
        scorePenaltyRules: { type: "array", items: ruleSchema },
        replyStyleRules: { type: "array", items: { type: "string" } },
        avoidReplyPatterns: { type: "array", items: { type: "string" } },
        nextExperiment: { type: "string" },
      },
    };
  }

  function buildOpenAiGrowthMemoryRequestBody({ model, payload }) {
    const safePayload = {
      ...payload,
      samples: Array.isArray(payload?.samples) ? payload.samples.slice(0, GROWTH_MEMORY_SAMPLE_LIMIT) : [],
    };

    return {
      model: clean(model) || "gpt-5.5",
      input: [
        {
          role: "system",
          content:
            "Extract practical, reversible learning from public interaction outcomes. Compare observed outcomes without claiming causality that the samples do not support. Use payload.locale for every narrative field. Keep rules specific, testable, and grounded in the supplied samples. Return only the requested JSON object.",
        },
        {
          role: "user",
          content: JSON.stringify(safePayload),
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "ray_growth_memory_response",
          schema: createGrowthMemoryResponseSchema(),
          strict: true,
        },
      },
    };
  }

  function normalizeGrowthMemoryResponse(rawValue, payload) {
    const source = rawValue && typeof rawValue === "object" ? rawValue : {};
    const sampleSummary = payload?.sampleSummary && typeof payload.sampleSummary === "object" ? payload.sampleSummary : {};
    return normalizeGrowthMemoryState({
      active: false,
      generatedAt: new Date().toISOString(),
      appliedAt: "",
      sampleCount: Number(sampleSummary.total) || (Array.isArray(payload?.samples) ? payload.samples.length : 0),
      positiveCount: Number(sampleSummary.positive) || 0,
      noReplyCount: Number(sampleSummary.noReply) || 0,
      summary: source.summary,
      effectiveKeywords: source.effectiveKeywords,
      weakKeywords: source.weakKeywords,
      accountRadarKeywords: source.accountRadarKeywords,
      scoreBoostRules: source.scoreBoostRules,
      scorePenaltyRules: source.scorePenaltyRules,
      replyStyleRules: source.replyStyleRules,
      avoidReplyPatterns: source.avoidReplyPatterns,
      nextExperiment: source.nextExperiment,
    });
  }

  function buildGrowthMemoryPromptContext(memoryInput, localeInput) {
    const memory = normalizeGrowthMemoryState(memoryInput);
    const locale = normalizeLocale(localeInput);
    if (!memory.active) return "";
    const lines = [];
    if (memory.summary) lines.push(`${locale === "en" ? "Learning summary" : "增长记忆摘要"}：${memory.summary}`);
    if (memory.effectiveKeywords.length) lines.push(`${locale === "en" ? "Prioritize" : "优先寻找"}：${memory.effectiveKeywords.join(", ")}`);
    if (memory.weakKeywords.length) lines.push(`${locale === "en" ? "Deprioritize" : "降低优先级"}：${memory.weakKeywords.join(", ")}`);
    if (memory.replyStyleRules.length) lines.push(`${locale === "en" ? "Effective style" : "有效话术风格"}：${memory.replyStyleRules.join(locale === "en" ? "; " : "；")}`);
    if (memory.avoidReplyPatterns.length) lines.push(`${locale === "en" ? "Avoid" : "避免"}：${memory.avoidReplyPatterns.join(locale === "en" ? "; " : "；")}`);
    if (memory.nextExperiment) lines.push(`${locale === "en" ? "Next experiment" : "下一轮实验"}：${memory.nextExperiment}`);
    return lines.join("\n");
  }

  function growthMemoryKeywordText(memoryInput) {
    const memory = normalizeGrowthMemoryState(memoryInput);
    if (!memory.active) return "";
    return [...memory.effectiveKeywords, ...memory.accountRadarKeywords].join(", ");
  }

  return {
    DEFAULT_GROWTH_MEMORY_STATE,
    GROWTH_MEMORY_SAMPLE_LIMIT,
    applyGrowthMemoryToQueueItems,
    buildGrowthMemoryPromptContext,
    buildGrowthMemoryRequestInput,
    buildOpenAiGrowthMemoryRequestBody,
    createGrowthMemoryResponseSchema,
    growthMemoryKeywordText,
    normalizeGrowthMemoryResponse,
    normalizeGrowthMemoryState,
  };
});
