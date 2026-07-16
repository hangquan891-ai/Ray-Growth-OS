(function initGrowthMemory(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  root.GrowthMemory = api;
})(typeof globalThis !== "undefined" ? globalThis : window, function createGrowthMemoryApi() {
  const GROWTH_MEMORY_SAMPLE_LIMIT = 50;
  const GROWTH_MEMORY_ACTIVE_RULE_LIMIT = 10;
  const GROWTH_MEMORY_RULE_HISTORY_LIMIT = 20;
  const GROWTH_MEMORY_SAMPLE_KEY_LIMIT = 2000;
  const VALID_RULE_STATUSES = new Set(["active", "watch", "paused"]);

  const EMPTY_MERGE_STATS = {
    added: 0,
    merged: 0,
    strengthened: 0,
    weakened: 0,
    paused: 0,
  };

  const DEFAULT_GROWTH_MEMORY_STATE = {
    active: false,
    generatedAt: "",
    appliedAt: "",
    sampleCount: 0,
    positiveCount: 0,
    noReplyCount: 0,
    learningRunCount: 0,
    lastBatchSampleCount: 0,
    learnedSampleKeys: [],
    lastMergeStats: EMPTY_MERGE_STATS,
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

  function clip(value, limit) {
    return clean(value).slice(0, limit);
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

  function clampCount(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return 0;
    return Math.max(0, Math.round(number));
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
    const positiveEvidence = clampCount(source.positiveEvidence);
    const negativeEvidence = clampCount(source.negativeEvidence);
    const status = VALID_RULE_STATUSES.has(source.status) ? source.status : "active";
    return {
      pattern,
      reason,
      weight: clampWeight(source.weight),
      status,
      confidence: clampScore(source.confidence, 60),
      positiveEvidence,
      negativeEvidence,
      lastValidatedAt: clean(source.lastValidatedAt),
    };
  }

  function patternKey(value) {
    return clean(value)
      .toLowerCase()
      .replace(/[\s\-_.:,;!?，。；：！？、()[\]{}'"`]+/g, "");
  }

  function normalizeRules(value, limit = GROWTH_MEMORY_RULE_HISTORY_LIMIT) {
    if (!Array.isArray(value)) return [];
    const seen = new Set();
    const rules = [];
    for (const item of value) {
      const rule = normalizeRule(item);
      if (!rule) continue;
      const key = patternKey(rule.pattern);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      rules.push(rule);
      if (rules.length >= limit) break;
    }
    return rules;
  }

  function rulePriority(rule) {
    return [
      clampScore(rule?.confidence),
      clampCount(rule?.positiveEvidence) + clampCount(rule?.negativeEvidence),
      new Date(rule?.lastValidatedAt || 0).getTime() || 0,
      clampWeight(rule?.weight),
    ];
  }

  function compareRulePriority(left, right) {
    const leftPriority = rulePriority(left);
    const rightPriority = rulePriority(right);
    for (let index = 0; index < leftPriority.length; index += 1) {
      if (leftPriority[index] !== rightPriority[index]) return rightPriority[index] - leftPriority[index];
    }
    return patternKey(left?.pattern).localeCompare(patternKey(right?.pattern));
  }

  function enforceActiveRuleLimit(boostRules, penaltyRules, stats) {
    const combined = [
      ...boostRules.map((rule) => ({ kind: "boost", rule })),
      ...penaltyRules.map((rule) => ({ kind: "penalty", rule })),
    ];
    const active = combined.filter((entry) => entry.rule.status === "active").sort((left, right) => compareRulePriority(left.rule, right.rule));
    const allowed = new Set(active.slice(0, GROWTH_MEMORY_ACTIVE_RULE_LIMIT).map((entry) => entry.rule));
    for (const entry of active.slice(GROWTH_MEMORY_ACTIVE_RULE_LIMIT)) {
      if (!allowed.has(entry.rule)) {
        entry.rule.status = "watch";
        if (stats) stats.paused += 1;
      }
    }
    return { boostRules, penaltyRules };
  }

  function normalizeMergeStats(value) {
    const source = value && typeof value === "object" ? value : {};
    return {
      added: clampCount(source.added),
      merged: clampCount(source.merged),
      strengthened: clampCount(source.strengthened),
      weakened: clampCount(source.weakened),
      paused: clampCount(source.paused),
    };
  }

  function normalizeGrowthMemoryState(input) {
    const source = input && typeof input === "object" ? input : {};
    const limitedRules = enforceActiveRuleLimit(
      normalizeRules(source.scoreBoostRules),
      normalizeRules(source.scorePenaltyRules)
    );
    return {
      active: Boolean(source.active),
      generatedAt: clean(source.generatedAt),
      appliedAt: clean(source.appliedAt),
      sampleCount: clampCount(source.sampleCount),
      positiveCount: clampCount(source.positiveCount),
      noReplyCount: clampCount(source.noReplyCount),
      learningRunCount: clampCount(source.learningRunCount),
      lastBatchSampleCount: clampCount(source.lastBatchSampleCount),
      learnedSampleKeys: cleanList(source.learnedSampleKeys, GROWTH_MEMORY_SAMPLE_KEY_LIMIT),
      lastMergeStats: normalizeMergeStats(source.lastMergeStats),
      summary: clean(source.summary),
      effectiveKeywords: cleanList(source.effectiveKeywords),
      weakKeywords: cleanList(source.weakKeywords),
      accountRadarKeywords: cleanList(source.accountRadarKeywords),
      scoreBoostRules: limitedRules.boostRules,
      scorePenaltyRules: limitedRules.penaltyRules,
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
    if (![...memory.scoreBoostRules, ...memory.scorePenaltyRules].some((rule) => rule.status === "active")) return result;

    const mode = result?.mode === "outbound" ? "outbound" : "growth";
    const applyToItem = (item) => {
      const text = itemText(item);
      const boosts = memory.scoreBoostRules.filter((rule) => rule.status === "active" && ruleMatches(text, rule));
      const penalties = memory.scorePenaltyRules.filter((rule) => rule.status === "active" && ruleMatches(text, rule));
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

  function hashText(value) {
    const text = clean(value);
    let hash = 2166136261;
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
  }

  function feedbackSampleKey(signal) {
    const identity = clean(signal?.id) || clean(signal?.url) || `${clean(signal?.author)}:${clean(signal?.text)}`;
    const feedback = normalizeFeedback(signal?.feedback);
    const timestamp = clean(signal?.feedbackAt) || clean(signal?.processedAt);
    return `sample:${hashText(`${identity}|${feedback}|${timestamp}`)}`;
  }

  function compactRuleForPrompt(rule) {
    return {
      pattern: clip(rule?.pattern, 120),
      reason: clip(rule?.reason, 240),
      weight: clampWeight(rule?.weight),
      status: VALID_RULE_STATUSES.has(rule?.status) ? rule.status : "active",
      confidence: clampScore(rule?.confidence, 60),
      positiveEvidence: clampCount(rule?.positiveEvidence),
      negativeEvidence: clampCount(rule?.negativeEvidence),
    };
  }

  function buildGrowthMemoryRequestInput({ mode: modeInput, profile, signals, aiScores, aiDrafts, previousMemory, locale }) {
    const mode = modeInput === "outbound" ? "outbound" : "growth";
    const scoreMap = aiScores && typeof aiScores === "object" ? aiScores : {};
    const draftMap = aiDrafts && typeof aiDrafts === "object" ? aiDrafts : {};
    const previous = normalizeGrowthMemoryState(previousMemory);
    const learnedSampleKeys = new Set(previous.learnedSampleKeys);
    const samples = (Array.isArray(signals) ? signals : [])
      .filter((signal) => normalizeFeedback(signal?.feedback))
      .map((signal) => ({ signal, sampleKey: feedbackSampleKey(signal) }))
      .filter(({ sampleKey }) => !learnedSampleKeys.has(sampleKey))
      .sort((left, right) => new Date(right.signal.feedbackAt || right.signal.processedAt || 0).getTime() - new Date(left.signal.feedbackAt || left.signal.processedAt || 0).getTime())
      .slice(0, GROWTH_MEMORY_SAMPLE_LIMIT)
      .map(({ signal, sampleKey }) => {
        const possibleScore = [scoreMap[clean(signal.id)], scoreMap[`url:${clean(signal.url).replace(/\/$/, "")}`]].find(Boolean);
        const possibleDraft = [draftMap[clean(signal.id)], draftMap[`url:${clean(signal.url).replace(/\/$/, "")}`]].find(Boolean);
        return {
          sampleKey,
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
      existingMemory: {
        summary: clip(previous.summary, 500),
        scoreBoostRules: previous.scoreBoostRules.filter((rule) => rule.status !== "paused").slice(0, 5).map(compactRuleForPrompt),
        scorePenaltyRules: previous.scorePenaltyRules.filter((rule) => rule.status !== "paused").slice(0, 5).map(compactRuleForPrompt),
        replyStyleRules: previous.replyStyleRules.slice(0, 4),
        avoidReplyPatterns: previous.avoidReplyPatterns.slice(0, 3),
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
      required: ["pattern", "reason", "weight", "confidence", "positiveEvidence", "negativeEvidence"],
      properties: {
        pattern: { type: "string" },
        reason: { type: "string" },
        weight: { type: "integer" },
        confidence: { type: "integer" },
        positiveEvidence: { type: "integer" },
        negativeEvidence: { type: "integer" },
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
            "Extract practical, reversible learning from the new public interaction outcomes. Compare observed outcomes without claiming causality. Review only existing rules related to the new samples, reuse an existing pattern when a new rule is equivalent, and do not repeat unrelated old rules. For every rule, report confidence from 0 to 100 plus positiveEvidence and negativeEvidence counts grounded in the new samples. Use payload.locale for every narrative field. Keep rules specific and testable. Return only the requested JSON object.",
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
      lastBatchSampleCount: Number(sampleSummary.total) || 0,
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

  function sampleSearchText(sample) {
    return [sample?.text, sample?.reason, sample?.usedDraft, ...(Array.isArray(sample?.tags) ? sample.tags : [])]
      .map(clean)
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
  }

  function ruleEvidence(samples, rule) {
    let positiveEvidence = 0;
    let negativeEvidence = 0;
    for (const sample of Array.isArray(samples) ? samples : []) {
      if (!ruleMatches(sampleSearchText(sample), rule)) continue;
      if (positiveFeedback(sample.feedback)) positiveEvidence += 1;
      if (normalizeFeedback(sample.feedback) === "no_reply") negativeEvidence += 1;
    }
    return { positiveEvidence, negativeEvidence };
  }

  function ruleConfidence(positiveEvidence, negativeEvidence, kind, fallback = 60) {
    const positive = clampCount(positiveEvidence);
    const negative = clampCount(negativeEvidence);
    const total = positive + negative;
    if (total === 0) return clampScore(fallback, 60);
    const supportive = kind === "boost" ? positive : negative;
    return clampScore(((supportive + 1) / (total + 2)) * 100, fallback);
  }

  function ruleStatus(confidence, evidenceTotal) {
    const score = clampScore(confidence, 60);
    if (evidenceTotal >= 2 && score < 40) return "paused";
    if (score < 55) return "watch";
    return "active";
  }

  function patternsSimilar(left, right) {
    const leftKey = patternKey(left);
    const rightKey = patternKey(right);
    if (!leftKey || !rightKey) return false;
    if (leftKey === rightKey) return true;
    const containsDigits = /\d/.test(leftKey) || /\d/.test(rightKey);
    if (!containsDigits && Math.min(leftKey.length, rightKey.length) >= 4 && (leftKey.includes(rightKey) || rightKey.includes(leftKey))) return true;

    const tokenize = (value) => new Set(clean(value).toLowerCase().split(/[\s,;，。；、/]+/).filter((token) => token.length >= 2));
    const leftTokens = tokenize(left);
    const rightTokens = tokenize(right);
    if (Math.min(leftTokens.size, rightTokens.size) < 2) return false;
    let overlap = 0;
    for (const token of leftTokens) if (rightTokens.has(token)) overlap += 1;
    return overlap / Math.min(leftTokens.size, rightTokens.size) >= 0.75;
  }

  function mergeRuleGroup(previousRules, incomingRules, kind, samples, nowIso, stats) {
    const previous = normalizeRules(previousRules);
    const merged = previous.map((rule) => {
      const evidence = ruleEvidence(samples, rule);
      if (evidence.positiveEvidence + evidence.negativeEvidence === 0) return { ...rule };
      const positiveEvidence = rule.positiveEvidence + evidence.positiveEvidence;
      const negativeEvidence = rule.negativeEvidence + evidence.negativeEvidence;
      const confidence = ruleConfidence(positiveEvidence, negativeEvidence, kind, rule.confidence);
      const status = ruleStatus(confidence, positiveEvidence + negativeEvidence);
      if (confidence > rule.confidence) stats.strengthened += 1;
      if (confidence < rule.confidence) stats.weakened += 1;
      if (rule.status === "active" && status !== "active") stats.paused += 1;
      return {
        ...rule,
        positiveEvidence,
        negativeEvidence,
        confidence,
        status,
        lastValidatedAt: nowIso,
      };
    });

    for (const incomingRule of normalizeRules(incomingRules)) {
      const localEvidence = ruleEvidence(samples, incomingRule);
      const candidatePositive = Math.max(incomingRule.positiveEvidence, localEvidence.positiveEvidence);
      const candidateNegative = Math.max(incomingRule.negativeEvidence, localEvidence.negativeEvidence);
      const candidateConfidence = ruleConfidence(candidatePositive, candidateNegative, kind, incomingRule.confidence);
      const candidate = {
        ...incomingRule,
        positiveEvidence: candidatePositive,
        negativeEvidence: candidateNegative,
        confidence: candidateConfidence,
        status: ruleStatus(candidateConfidence, candidatePositive + candidateNegative),
        lastValidatedAt: nowIso,
      };
      const existingIndex = merged.findIndex((rule) => patternsSimilar(rule.pattern, candidate.pattern));
      if (existingIndex < 0) {
        merged.push(candidate);
        stats.added += 1;
        if (candidate.status !== "active") stats.paused += 1;
        continue;
      }

      const existing = merged[existingIndex];
      const positiveEvidence = Math.max(existing.positiveEvidence, (previous[existingIndex]?.positiveEvidence || 0) + candidatePositive);
      const negativeEvidence = Math.max(existing.negativeEvidence, (previous[existingIndex]?.negativeEvidence || 0) + candidateNegative);
      const confidence = ruleConfidence(positiveEvidence, negativeEvidence, kind, Math.max(existing.confidence, candidate.confidence));
      const status = ruleStatus(confidence, positiveEvidence + negativeEvidence);
      if (existing.status === "active" && status !== "active") stats.paused += 1;
      merged[existingIndex] = {
        ...existing,
        reason: candidate.reason || existing.reason,
        weight: clampWeight(Math.round((existing.weight + candidate.weight) / 2)),
        positiveEvidence,
        negativeEvidence,
        confidence,
        status,
        lastValidatedAt: nowIso,
      };
      stats.merged += 1;
    }

    return merged
      .sort((left, right) => {
        if (left.status === "active" && right.status !== "active") return -1;
        if (right.status === "active" && left.status !== "active") return 1;
        return compareRulePriority(left, right);
      })
      .slice(0, GROWTH_MEMORY_RULE_HISTORY_LIMIT);
  }

  function mergeLists(primary, secondary, limit = 8) {
    return cleanList([...(Array.isArray(primary) ? primary : []), ...(Array.isArray(secondary) ? secondary : [])], limit);
  }

  function mergeGrowthMemoryState(previousInput, incomingInput, payload, now = new Date()) {
    const previous = normalizeGrowthMemoryState(previousInput);
    const incoming = normalizeGrowthMemoryState(incomingInput);
    const samples = Array.isArray(payload?.samples) ? payload.samples : [];
    const sampleSummary = payload?.sampleSummary && typeof payload.sampleSummary === "object" ? payload.sampleSummary : {};
    const batchTotal = clampCount(sampleSummary.total || samples.length);
    const batchPositive = clampCount(sampleSummary.positive || samples.filter((sample) => positiveFeedback(sample.feedback)).length);
    const batchNoReply = clampCount(sampleSummary.noReply || samples.filter((sample) => normalizeFeedback(sample.feedback) === "no_reply").length);
    const nowIso = now instanceof Date ? now.toISOString() : new Date(now).toISOString();
    const stats = { ...EMPTY_MERGE_STATS };

    const boostRules = mergeRuleGroup(previous.scoreBoostRules, incoming.scoreBoostRules, "boost", samples, nowIso, stats);
    const penaltyRules = mergeRuleGroup(previous.scorePenaltyRules, incoming.scorePenaltyRules, "penalty", samples, nowIso, stats);
    const limitedRules = enforceActiveRuleLimit(boostRules, penaltyRules, stats);
    const migratedOpaqueCounts = previous.sampleCount > 0 && previous.learnedSampleKeys.length === 0;
    const learnedSampleKeys = mergeLists(
      samples.map((sample) => clean(sample.sampleKey)).filter(Boolean),
      previous.learnedSampleKeys,
      GROWTH_MEMORY_SAMPLE_KEY_LIMIT
    );

    const inactiveBoostRules = limitedRules.boostRules.filter((rule) => rule.status !== "active");
    const inactivePenaltyRules = limitedRules.penaltyRules.filter((rule) => rule.status !== "active");
    const effectiveKeywords = mergeLists(
      [...incoming.effectiveKeywords, ...limitedRules.boostRules.filter((rule) => rule.status === "active").map((rule) => rule.pattern)],
      previous.effectiveKeywords
    ).filter((keyword) => !inactiveBoostRules.some((rule) => patternsSimilar(rule.pattern, keyword)));
    const weakKeywords = mergeLists(
      [...incoming.weakKeywords, ...limitedRules.penaltyRules.filter((rule) => rule.status === "active").map((rule) => rule.pattern)],
      previous.weakKeywords
    ).filter((keyword) => !inactivePenaltyRules.some((rule) => patternsSimilar(rule.pattern, keyword)))
      .filter((keyword) => !effectiveKeywords.some((effective) => patternsSimilar(effective, keyword)));
    const accountRadarKeywords = mergeLists(incoming.accountRadarKeywords, previous.accountRadarKeywords)
      .filter((keyword) => !inactiveBoostRules.some((rule) => patternsSimilar(rule.pattern, keyword)));

    return normalizeGrowthMemoryState({
      active: false,
      generatedAt: incoming.generatedAt || nowIso,
      appliedAt: previous.appliedAt,
      sampleCount: migratedOpaqueCounts ? Math.max(previous.sampleCount, batchTotal) : previous.sampleCount + batchTotal,
      positiveCount: migratedOpaqueCounts ? Math.max(previous.positiveCount, batchPositive) : previous.positiveCount + batchPositive,
      noReplyCount: migratedOpaqueCounts ? Math.max(previous.noReplyCount, batchNoReply) : previous.noReplyCount + batchNoReply,
      learningRunCount: previous.learningRunCount + 1,
      lastBatchSampleCount: batchTotal,
      learnedSampleKeys,
      lastMergeStats: stats,
      summary: incoming.summary || previous.summary,
      effectiveKeywords,
      weakKeywords,
      accountRadarKeywords,
      scoreBoostRules: limitedRules.boostRules,
      scorePenaltyRules: limitedRules.penaltyRules,
      replyStyleRules: mergeLists(incoming.replyStyleRules, previous.replyStyleRules, 8),
      avoidReplyPatterns: mergeLists(incoming.avoidReplyPatterns, previous.avoidReplyPatterns, 8),
      nextExperiment: incoming.nextExperiment || previous.nextExperiment,
    });
  }

  function enabledKeywords(keywords, rules) {
    const inactiveRules = (Array.isArray(rules) ? rules : []).filter((rule) => rule.status !== "active");
    return (Array.isArray(keywords) ? keywords : [])
      .filter((keyword) => !inactiveRules.some((rule) => patternsSimilar(rule.pattern, keyword)));
  }

  function buildGrowthMemoryPromptContext(memoryInput, localeInput) {
    const memory = normalizeGrowthMemoryState(memoryInput);
    const locale = normalizeLocale(localeInput);
    if (!memory.active) return "";
    const effectiveKeywords = enabledKeywords(memory.effectiveKeywords, memory.scoreBoostRules);
    const weakKeywords = enabledKeywords(memory.weakKeywords, memory.scorePenaltyRules);
    const lines = [];
    if (memory.summary) lines.push(`${locale === "en" ? "Learning summary" : "增长记忆摘要"}：${clip(memory.summary, 500)}`);
    if (effectiveKeywords.length) lines.push(`${locale === "en" ? "Prioritize" : "优先寻找"}：${effectiveKeywords.slice(0, 6).join(", ")}`);
    if (weakKeywords.length) lines.push(`${locale === "en" ? "Deprioritize" : "降低优先级"}：${weakKeywords.slice(0, 6).join(", ")}`);
    if (memory.replyStyleRules.length) lines.push(`${locale === "en" ? "Effective style" : "有效话术风格"}：${memory.replyStyleRules.slice(0, 4).join(locale === "en" ? "; " : "；")}`);
    if (memory.avoidReplyPatterns.length) lines.push(`${locale === "en" ? "Avoid" : "避免"}：${memory.avoidReplyPatterns.slice(0, 3).join(locale === "en" ? "; " : "；")}`);
    if (memory.nextExperiment) lines.push(`${locale === "en" ? "Next experiment" : "下一轮实验"}：${clip(memory.nextExperiment, 300)}`);
    return lines.join("\n");
  }

  function growthMemoryKeywordText(memoryInput) {
    const memory = normalizeGrowthMemoryState(memoryInput);
    if (!memory.active) return "";
    const keywords = enabledKeywords([...memory.effectiveKeywords, ...memory.accountRadarKeywords], memory.scoreBoostRules);
    return cleanList(keywords, 8).join(", ");
  }

  return {
    DEFAULT_GROWTH_MEMORY_STATE,
    GROWTH_MEMORY_ACTIVE_RULE_LIMIT,
    GROWTH_MEMORY_SAMPLE_LIMIT,
    applyGrowthMemoryToQueueItems,
    buildGrowthMemoryPromptContext,
    buildGrowthMemoryRequestInput,
    buildOpenAiGrowthMemoryRequestBody,
    createGrowthMemoryResponseSchema,
    feedbackSampleKey,
    growthMemoryKeywordText,
    mergeGrowthMemoryState,
    normalizeGrowthMemoryResponse,
    normalizeGrowthMemoryState,
  };
});
