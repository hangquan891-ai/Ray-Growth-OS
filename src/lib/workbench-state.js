(function initWorkbenchState(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  root.WorkbenchState = api;
})(typeof globalThis !== "undefined" ? globalThis : window, function createWorkbenchStateApi() {
  const CURRENT_VERSION = 1;
  const WORKBENCH_STORAGE_KEY = "ray-growth-os:workbench:v1";
  const VALID_MODES = new Set(["outbound", "growth"]);
  const FORM_FIELDS = ["productName", "description", "targetCustomer", "competitors", "painPoints", "replyGoal", "productContext", "leadInput"];

  const EMPTY_FORM_STATE = {
    productName: "",
    description: "",
    targetCustomer: "",
    competitors: "",
    painPoints: "",
    replyGoal: "",
    productContext: "",
    leadInput: "",
  };

  const EMPTY_FORMS_STATE = {
    outbound: EMPTY_FORM_STATE,
    growth: EMPTY_FORM_STATE,
  };

  const DEFAULT_GROK_BRIDGE_STATE = {
    keywords: "",
    grokResult: "",
    accountResult: "",
    xProfileUrl: "",
  };

  const DEFAULT_SIGNAL_STATE = {
    outbound: [],
    growth: [],
  };

  const DEFAULT_AI_SCORE_STATE = {
    outbound: {},
    growth: {},
  };

  const DEFAULT_AI_DRAFT_STATE = {
    outbound: {},
    growth: {},
  };

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

  const DEFAULT_WORKBENCH_STATE = {
    version: CURRENT_VERSION,
    mode: "growth",
    forms: EMPTY_FORMS_STATE,
    grokBridge: DEFAULT_GROK_BRIDGE_STATE,
    signals: DEFAULT_SIGNAL_STATE,
    aiScores: DEFAULT_AI_SCORE_STATE,
    aiDrafts: DEFAULT_AI_DRAFT_STATE,
    growthMemory: DEFAULT_GROWTH_MEMORY_STATE,
  };

  function isPlainObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }

  function stringOrFallback(value, fallback) {
    return typeof value === "string" ? value : String(fallback ?? "");
  }

  function normalizeMode(value, fallbackMode) {
    if (VALID_MODES.has(value)) return value;
    if (VALID_MODES.has(fallbackMode)) return fallbackMode;
    return "growth";
  }

  function normalizeFormState(input, fallback) {
    const source = isPlainObject(input) ? input : {};
    const base = isPlainObject(fallback) ? fallback : EMPTY_FORM_STATE;

    return FORM_FIELDS.reduce((form, field) => {
      form[field] = stringOrFallback(source[field], base[field]);
      return form;
    }, {});
  }

  function normalizeFormsState(input, fallback) {
    const source = isPlainObject(input) ? input : {};
    const base = isPlainObject(fallback) ? fallback : EMPTY_FORMS_STATE;

    return {
      outbound: normalizeFormState(source.outbound, base.outbound),
      growth: normalizeFormState(source.growth, base.growth),
    };
  }

  function normalizeGrokBridgeState(input, fallback) {
    const source = isPlainObject(input) ? input : {};
    const base = isPlainObject(fallback) ? fallback : DEFAULT_GROK_BRIDGE_STATE;

    return {
      keywords: stringOrFallback(source.keywords, base.keywords),
      grokResult: stringOrFallback(source.grokResult, base.grokResult),
      accountResult: stringOrFallback(source.accountResult, base.accountResult),
      xProfileUrl: stringOrFallback(source.xProfileUrl, base.xProfileUrl),
    };
  }

  function normalizeSignal(input) {
    const source = isPlainObject(input) ? input : {};
    const signal = {
      id: stringOrFallback(source.id, ""),
      source: stringOrFallback(source.source, "manual"),
      platform: stringOrFallback(source.platform, "X"),
      author: stringOrFallback(source.author, source.name || "Unnamed signal"),
      url: stringOrFallback(source.url, ""),
      text: stringOrFallback(source.text, source.note || ""),
      importedAt: stringOrFallback(source.importedAt, ""),
      status: stringOrFallback(source.status, "new"),
      tags: Array.isArray(source.tags) ? source.tags.map((tag) => stringOrFallback(tag, "")).filter(Boolean) : [],
    };
    const reason = stringOrFallback(source.reason, "").trim();
    const confidence = Number(source.confidence);
    const processedAt = stringOrFallback(source.processedAt, "").trim();
    const processedAction = stringOrFallback(source.processedAction, "").trim();
    const feedback = stringOrFallback(source.feedback, "").trim();
    const feedbackAt = stringOrFallback(source.feedbackAt, "").trim();
    const replyUrl = stringOrFallback(source.replyUrl, "").trim();
    const replyUrlAt = stringOrFallback(source.replyUrlAt, "").trim();
    const usedDraft = stringOrFallback(source.usedDraft, "").trim();
    const usedDraftAt = stringOrFallback(source.usedDraftAt, "").trim();

    if (reason) signal.reason = reason;
    if (Number.isFinite(confidence)) signal.confidence = Math.max(0, Math.min(100, Math.round(confidence)));
    if (processedAt) signal.processedAt = processedAt;
    if (processedAction) signal.processedAction = processedAction;
    if (feedback) signal.feedback = feedback;
    if (feedbackAt) signal.feedbackAt = feedbackAt;
    if (replyUrl) signal.replyUrl = replyUrl;
    if (replyUrlAt) signal.replyUrlAt = replyUrlAt;
    if (usedDraft) signal.usedDraft = usedDraft;
    if (usedDraftAt) signal.usedDraftAt = usedDraftAt;

    return signal;
  }

  function normalizeSignalList(input) {
    return Array.isArray(input) ? input.map(normalizeSignal).filter((signal) => signal.text || signal.url) : [];
  }

  function normalizeSignalsState(input, fallback) {
    const source = isPlainObject(input) ? input : {};
    const base = isPlainObject(fallback) ? fallback : DEFAULT_SIGNAL_STATE;

    return {
      outbound: normalizeSignalList(source.outbound ?? base.outbound),
      growth: normalizeSignalList(source.growth ?? base.growth),
    };
  }

  function numberOrFallback(value, fallback = 0) {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.max(0, Math.min(100, Math.round(number)));
  }

  function normalizeAiScore(input, fallbackItemId = "") {
    const source = isPlainObject(input) ? input : {};
    const itemId = stringOrFallback(source.itemId, fallbackItemId);
    if (!itemId) return null;

    return {
      itemId,
      score: numberOrFallback(source.score),
      label: stringOrFallback(source.label, ""),
      targetFit: numberOrFallback(source.targetFit),
      painIntensity: numberOrFallback(source.painIntensity),
      replyValue: numberOrFallback(source.replyValue),
      contentPotential: numberOrFallback(source.contentPotential),
      timingRisk: numberOrFallback(source.timingRisk),
      recommendedAction: stringOrFallback(source.recommendedAction, ""),
      reason: stringOrFallback(source.reason, ""),
      suggestedAngle: stringOrFallback(source.suggestedAngle, ""),
    };
  }

  function normalizeAiScoreMap(input, fallback) {
    const source = isPlainObject(input) ? input : {};
    const base = isPlainObject(fallback) ? fallback : {};
    const scores = {};

    for (const [key, value] of Object.entries({ ...base, ...source })) {
      const score = normalizeAiScore(value, key);
      if (score) scores[score.itemId] = score;
    }

    return scores;
  }

  function normalizeAiScoresState(input, fallback) {
    const source = isPlainObject(input) ? input : {};
    const base = isPlainObject(fallback) ? fallback : DEFAULT_AI_SCORE_STATE;

    return {
      outbound: normalizeAiScoreMap(source.outbound ?? base.outbound, base.outbound),
      growth: normalizeAiScoreMap(source.growth ?? base.growth, base.growth),
    };
  }

  function normalizeAiDraft(input, fallbackItemId = "") {
    const source = isPlainObject(input) ? input : {};
    const itemId = stringOrFallback(source.itemId, fallbackItemId);
    if (!itemId) return null;

    return {
      itemId,
      draft: stringOrFallback(source.draft, ""),
      replyDraft: stringOrFallback(source.replyDraft, ""),
      quoteDraft: stringOrFallback(source.quoteDraft, ""),
      postIdea: stringOrFallback(source.postIdea, ""),
      outreachDraft: stringOrFallback(source.outreachDraft, ""),
      rationale: stringOrFallback(source.rationale, ""),
      toneNotes: stringOrFallback(source.toneNotes, ""),
      model: stringOrFallback(source.model, ""),
      generatedAt: stringOrFallback(source.generatedAt, ""),
    };
  }

  function normalizeAiDraftMap(input, fallback) {
    const source = isPlainObject(input) ? input : {};
    const base = isPlainObject(fallback) ? fallback : {};
    const drafts = {};

    for (const [key, value] of Object.entries({ ...base, ...source })) {
      const draft = normalizeAiDraft(value, key);
      if (draft) drafts[draft.itemId] = draft;
    }

    return drafts;
  }

  function normalizeAiDraftsState(input, fallback) {
    const source = isPlainObject(input) ? input : {};
    const base = isPlainObject(fallback) ? fallback : DEFAULT_AI_DRAFT_STATE;

    return {
      outbound: normalizeAiDraftMap(source.outbound ?? base.outbound, base.outbound),
      growth: normalizeAiDraftMap(source.growth ?? base.growth, base.growth),
    };
  }

  function normalizeStringList(input, fallback = [], limit = 8) {
    const source = Array.isArray(input) ? input : Array.isArray(fallback) ? fallback : [];
    return Array.from(new Set(source.map((item) => stringOrFallback(item, "").trim()).filter(Boolean))).slice(0, limit);
  }

  function normalizeMemoryRule(input) {
    const source = isPlainObject(input) ? input : {};
    const pattern = stringOrFallback(source.pattern, "").trim();
    const reason = stringOrFallback(source.reason, "").trim();
    if (!pattern || !reason) return null;
    const weight = Math.max(1, Math.min(12, Math.round(Math.abs(Number(source.weight) || 4))));
    return { pattern, reason, weight };
  }

  function normalizeMemoryRuleList(input, fallback = []) {
    const source = Array.isArray(input) ? input : Array.isArray(fallback) ? fallback : [];
    return source.map(normalizeMemoryRule).filter(Boolean).slice(0, 6);
  }

  function normalizeGrowthMemoryState(input, fallback) {
    const source = isPlainObject(input) ? input : {};
    const base = isPlainObject(fallback) ? fallback : DEFAULT_GROWTH_MEMORY_STATE;

    return {
      active: Boolean(source.active ?? base.active),
      generatedAt: stringOrFallback(source.generatedAt, base.generatedAt),
      appliedAt: stringOrFallback(source.appliedAt, base.appliedAt),
      sampleCount: Math.max(0, Math.round(Number(source.sampleCount ?? base.sampleCount) || 0)),
      positiveCount: Math.max(0, Math.round(Number(source.positiveCount ?? base.positiveCount) || 0)),
      noReplyCount: Math.max(0, Math.round(Number(source.noReplyCount ?? base.noReplyCount) || 0)),
      summary: stringOrFallback(source.summary, base.summary),
      effectiveKeywords: normalizeStringList(source.effectiveKeywords, base.effectiveKeywords),
      weakKeywords: normalizeStringList(source.weakKeywords, base.weakKeywords),
      accountRadarKeywords: normalizeStringList(source.accountRadarKeywords, base.accountRadarKeywords),
      scoreBoostRules: normalizeMemoryRuleList(source.scoreBoostRules, base.scoreBoostRules),
      scorePenaltyRules: normalizeMemoryRuleList(source.scorePenaltyRules, base.scorePenaltyRules),
      replyStyleRules: normalizeStringList(source.replyStyleRules, base.replyStyleRules, 8),
      avoidReplyPatterns: normalizeStringList(source.avoidReplyPatterns, base.avoidReplyPatterns, 8),
      nextExperiment: stringOrFallback(source.nextExperiment, base.nextExperiment),
    };
  }
  function normalizeWorkbenchState(input, fallback = DEFAULT_WORKBENCH_STATE) {
    const source = isPlainObject(input) ? input : {};
    const base = isPlainObject(fallback) ? fallback : DEFAULT_WORKBENCH_STATE;

    return {
      version: CURRENT_VERSION,
      mode: normalizeMode(source.mode, base.mode),
      forms: normalizeFormsState(source.forms, base.forms),
      grokBridge: normalizeGrokBridgeState(source.grokBridge, base.grokBridge),
      signals: normalizeSignalsState(source.signals, base.signals),
      aiScores: normalizeAiScoresState(source.aiScores, base.aiScores),
      aiDrafts: normalizeAiDraftsState(source.aiDrafts, base.aiDrafts),
      growthMemory: normalizeGrowthMemoryState(source.growthMemory, base.growthMemory),
    };
  }

  function parseStoredWorkbenchState(rawValue, fallback = DEFAULT_WORKBENCH_STATE) {
    if (!rawValue) return normalizeWorkbenchState(undefined, fallback);

    try {
      return normalizeWorkbenchState(JSON.parse(rawValue), fallback);
    } catch {
      return normalizeWorkbenchState(undefined, fallback);
    }
  }

  function serializeWorkbenchState(snapshot) {
    return JSON.stringify(normalizeWorkbenchState(snapshot));
  }

  function createOperationalWorkbenchSnapshot(snapshot, savedForms) {
    const current = normalizeWorkbenchState(snapshot);
    const persistedForms = normalizeFormsState(savedForms, current.forms);

    return {
      ...current,
      forms: {
        outbound: {
          ...persistedForms.outbound,
          leadInput: current.forms.outbound.leadInput,
        },
        growth: {
          ...persistedForms.growth,
          leadInput: current.forms.growth.leadInput,
        },
      },
    };
  }

  function backupDateStamp(now) {
    const date = now ? new Date(now) : new Date();
    if (Number.isNaN(date.getTime())) return new Date().toISOString().slice(0, 10);
    return date.toISOString().slice(0, 10);
  }

  function createWorkbenchBackup(snapshot, now) {
    const state = normalizeWorkbenchState(snapshot);
    return {
      filename: `ray-growth-os-backup-${backupDateStamp(now)}.json`,
      json: JSON.stringify(state, null, 2),
    };
  }

  function parseWorkbenchBackup(rawValue, fallback = DEFAULT_WORKBENCH_STATE) {
    try {
      return {
        ok: true,
        state: normalizeWorkbenchState(JSON.parse(rawValue), fallback),
        error: "",
      };
    } catch {
      return {
        ok: false,
        state: null,
        error: "Invalid JSON backup",
      };
    }
  }

  return {
    CURRENT_VERSION,
    createOperationalWorkbenchSnapshot,
    createWorkbenchBackup,
    parseWorkbenchBackup,
    DEFAULT_AI_DRAFT_STATE,
    DEFAULT_AI_SCORE_STATE,
    DEFAULT_GROK_BRIDGE_STATE,
    DEFAULT_GROWTH_MEMORY_STATE,
    DEFAULT_SIGNAL_STATE,
    DEFAULT_WORKBENCH_STATE,
    WORKBENCH_STORAGE_KEY,
    normalizeWorkbenchState,
    parseStoredWorkbenchState,
    serializeWorkbenchState,
  };
});

