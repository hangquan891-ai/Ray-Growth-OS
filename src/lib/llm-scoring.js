(function initLlmScoring(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  root.LlmScoring = api;
})(typeof globalThis !== "undefined" ? globalThis : window, function createLlmScoringApi() {
  const AI_SCORE_LIMIT = 20;
  const MODE_LABELS = {
    outbound: ["High intent", "Warm", "Low"],
    growth: ["Engage now", "Watch", "Skip"],
  };

  function clean(value) {
    return String(value ?? "").trim();
  }

  function clampScore(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return 0;
    return Math.max(0, Math.min(100, Math.round(number)));
  }

  function normalizeUrl(value) {
    const raw = clean(value).replace(/[),.;，。；、]+$/, "");
    if (!raw) return "";

    try {
      const url = new URL(raw);
      url.hash = "";
      for (const key of [...url.searchParams.keys()]) {
        if (/^(utm_|ref$|fbclid$|gclid$)/i.test(key)) {
          url.searchParams.delete(key);
        }
      }
      const query = url.searchParams.toString();
      return `${url.origin.toLowerCase()}${url.pathname.replace(/\/$/, "")}${query ? `?${query}` : ""}`;
    } catch {
      return raw;
    }
  }

  function hashValue(value) {
    let hash = 2166136261;
    const text = String(value);
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
  }

  function normalizeMode(mode) {
    return mode === "outbound" ? "outbound" : "growth";
  }

  function normalizeLocale(locale) {
    return locale === "en" ? "en" : "zh-CN";
  }

  function itemScoreKey(item) {
    const url = normalizeUrl(item?.url);
    if (url) return `url:${url}`;

    return [
      "text",
      clean(item?.platform).toLowerCase(),
      clean(item?.name ?? item?.author).toLowerCase(),
      hashValue(clean(item?.note ?? item?.text).toLowerCase().replace(/\s+/g, " ")),
    ].join(":");
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

  function normalizeLabel(label, score, mode) {
    const labels = MODE_LABELS[mode];
    const value = clean(label);
    if (labels.includes(value)) return value;

    const lower = value.toLowerCase();
    if (mode === "growth") {
      if (["engage", "engage now", "reply", "hot", "high", "立即互动"].includes(lower)) return "Engage now";
      if (["watch", "save", "medium", "观察", "收藏观察"].includes(lower)) return "Watch";
      if (["skip", "low", "跳过"].includes(lower)) return "Skip";
    } else {
      if (["high", "hot", "high intent", "高意向"].includes(lower)) return "High intent";
      if (["warm", "medium", "观察", "中等"].includes(lower)) return "Warm";
      if (["low", "skip", "低"].includes(lower)) return "Low";
    }

    return labelFromScore(score, mode);
  }

  function normalizeAiScore(score, modeInput) {
    const mode = normalizeMode(modeInput);
    const finalScore = clampScore(score?.score);
    const reason = clean(score?.reason) || "AI semantic scoring completed";

    return {
      itemId: clean(score?.itemId),
      score: finalScore,
      label: normalizeLabel(score?.label, finalScore, mode),
      targetFit: clampScore(score?.targetFit),
      painIntensity: clampScore(score?.painIntensity),
      replyValue: clampScore(score?.replyValue),
      contentPotential: clampScore(score?.contentPotential),
      timingRisk: clampScore(score?.timingRisk),
      recommendedAction: clean(score?.recommendedAction),
      reason,
      suggestedAngle: clean(score?.suggestedAngle),
    };
  }

  function normalizeAiScoreResponse(rawValue, modeInput) {
    const source = rawValue && typeof rawValue === "object" ? rawValue : {};
    const scores = Array.isArray(source.scores) ? source.scores : [];

    return {
      scores: scores.map((score) => normalizeAiScore(score, modeInput)).filter((score) => score.itemId),
    };
  }

  function scoreOverrideMap(overrides, modeInput) {
    const mode = normalizeMode(modeInput);
    if (!overrides || typeof overrides !== "object") return {};

    return Object.fromEntries(
      Object.entries(overrides)
        .map(([key, value]) => {
          const normalized = normalizeAiScore({ itemId: key, ...(value || {}) }, mode);
          return normalized.itemId ? [normalized.itemId, normalized] : null;
        })
        .filter(Boolean)
    );
  }

  function applyOverrideToItem(item, override, mode) {
    if (!override) return item;

    const nextItem = {
      ...item,
      score: override.score,
      label: override.label,
      reasons: [`AI: ${override.reason}`],
      aiScore: override,
    };

    if (mode === "growth" && override.recommendedAction) {
      nextItem.action = override.recommendedAction;
    }

    return nextItem;
  }

  function sortByScore(items) {
    return [...items].sort((left, right) => right.score - left.score);
  }

  function applyAiScoreOverrides(result, overrides) {
    const mode = normalizeMode(result?.mode);
    const map = scoreOverrideMap(overrides, mode);

    if (mode === "outbound") {
      return {
        ...result,
        leads: sortByScore((result?.leads ?? []).map((item) => applyOverrideToItem(item, map[itemScoreKey(item)], mode))),
      };
    }

    return {
      ...result,
      opportunities: sortByScore((result?.opportunities ?? []).map((item) => applyOverrideToItem(item, map[itemScoreKey(item)], mode))),
    };
  }

  function normalizeGrowthMemoryForPrompt(memory) {
    if (!memory || typeof memory !== "object" || !memory.active) return null;
    const activeKeywords = (keywords, rules) => {
      const inactivePatterns = Array.isArray(rules)
        ? rules.filter((rule) => rule?.status && rule.status !== "active").map((rule) => clean(rule?.pattern).toLowerCase()).filter(Boolean)
        : [];
      return Array.isArray(keywords)
        ? keywords.map(clean).filter(Boolean).filter((keyword) => {
            const value = keyword.toLowerCase();
            return !inactivePatterns.some((pattern) => Math.min(pattern.length, value.length) >= 4 && (pattern.includes(value) || value.includes(pattern)));
          })
        : [];
    };
    const compactRules = (rules) => Array.isArray(rules)
      ? rules
          .filter((rule) => !rule?.status || rule.status === "active")
          .slice(0, 5)
          .map((rule) => ({ pattern: clean(rule?.pattern).slice(0, 120), reason: clean(rule?.reason).slice(0, 240), weight: Math.max(1, Math.min(12, Math.round(Number(rule?.weight) || 4))) }))
      : [];
    return {
      summary: clean(memory.summary).slice(0, 500),
      effectiveKeywords: activeKeywords(memory.effectiveKeywords, memory.scoreBoostRules).slice(0, 6),
      weakKeywords: activeKeywords(memory.weakKeywords, memory.scorePenaltyRules).slice(0, 6),
      scoreBoostRules: compactRules(memory.scoreBoostRules),
      scorePenaltyRules: compactRules(memory.scorePenaltyRules),
      nextExperiment: clean(memory.nextExperiment).slice(0, 300),
    };
  }

  function buildScoreRequestInput({ mode: modeInput, profile, items, growthMemory, locale }) {
    const mode = normalizeMode(modeInput);

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
      rubric: {
        targetFit: "0-100: target customer or reader fit",
        painIntensity: "0-100: explicit pain, urgency, and need strength",
        replyValue: "0-100: whether the operator can add specific value in a reply or outreach",
        contentPotential: "0-100: whether the signal can become quote, post, thread, or sales learning material",
        timingRisk: "0-100: freshness, spam risk, conflict risk, and execution timing risk",
      },
      growthMemory: normalizeGrowthMemoryForPrompt(growthMemory),
      items: (Array.isArray(items) ? items : []).slice(0, AI_SCORE_LIMIT).map((item) => ({
        itemId: itemScoreKey(item),
        platform: clean(item?.platform),
        name: clean(item?.name ?? item?.author),
        url: clean(item?.url),
        text: clean(item?.note ?? item?.text),
        localScore: clampScore(item?.score),
        localLabel: clean(item?.label),
        localReasons: Array.isArray(item?.reasons) ? item.reasons.map(clean).filter(Boolean) : [],
      })),
    };
  }

  function createScoreResponseSchema(modeInput) {
    const mode = normalizeMode(modeInput);
    return {
      type: "object",
      additionalProperties: false,
      required: ["scores"],
      properties: {
        scores: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: [
              "itemId",
              "score",
              "label",
              "targetFit",
              "painIntensity",
              "replyValue",
              "contentPotential",
              "timingRisk",
              "recommendedAction",
              "reason",
              "suggestedAngle",
            ],
            properties: {
              itemId: { type: "string" },
              score: { type: "integer" },
              label: { type: "string", enum: MODE_LABELS[mode] },
              targetFit: { type: "integer" },
              painIntensity: { type: "integer" },
              replyValue: { type: "integer" },
              contentPotential: { type: "integer" },
              timingRisk: { type: "integer" },
              recommendedAction: { type: "string" },
              reason: { type: "string" },
              suggestedAngle: { type: "string" },
            },
          },
        },
      },
    };
  }

  function buildOpenAiScoreRequestBody({ model, payload }) {
    const mode = normalizeMode(payload?.mode);
    const safePayload = {
      ...payload,
      mode,
      items: Array.isArray(payload?.items) ? payload.items.slice(0, AI_SCORE_LIMIT) : [],
    };

    return {
      model: clean(model) || "gpt-5.5",
      input: [
        {
          role: "system",
          content:
            "Score public conversations for growth or outbound value. Use only evidence in the supplied payload. Do not invent author intent, facts, metrics, URLs, or context. Treat growthMemory as a reversible prioritization hint, not ground truth. Preserve every itemId exactly. Use payload.locale for reason and suggestedAngle; keep label values exactly as required by the schema. Return only the requested JSON object.",
        },
        {
          role: "user",
          content: JSON.stringify(safePayload),
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "ray_growth_score_response",
          schema: createScoreResponseSchema(mode),
          strict: true,
        },
      },
    };
  }

  function extractResponseOutputText(response) {
    if (typeof response?.output_text === "string") return response.output_text;

    const output = Array.isArray(response?.output) ? response.output : [];
    for (const outputItem of output) {
      const content = Array.isArray(outputItem?.content) ? outputItem.content : [];
      for (const contentItem of content) {
        if (typeof contentItem?.text === "string") return contentItem.text;
        if (typeof contentItem?.output_text === "string") return contentItem.output_text;
      }
    }

    return "";
  }
  return {
    AI_SCORE_LIMIT,
    applyAiScoreOverrides,
    buildOpenAiScoreRequestBody,
    buildScoreRequestInput,
    createScoreResponseSchema,
    extractResponseOutputText,
    itemScoreKey,
    normalizeAiScore,
    normalizeAiScoreResponse,
  };
});
