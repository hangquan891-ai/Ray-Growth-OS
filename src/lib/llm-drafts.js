(function initLlmDrafts(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  root.LlmDrafts = api;
})(typeof globalThis !== "undefined" ? globalThis : window, function createLlmDraftsApi() {
  const AI_DRAFT_LIMIT = 10;

  function clean(value) {
    return String(value ?? "").trim();
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

  function countMatches(value, pattern) {
    return (clean(value).match(pattern) || []).length;
  }

  function latinLanguageHint(value) {
    const text = clean(value).toLowerCase();
    const words = text.match(/[a-zà-öø-ÿœß]+/g) || [];
    const wordSet = new Set(words);
    const score = (candidates) => candidates.reduce((total, word) => total + (wordSet.has(word) ? 1 : 0), 0);
    const scores = [
      { language: "Spanish", score: score(["el", "la", "los", "las", "una", "para", "con", "pero", "como", "necesito", "clientes"]) + (/[¿¡ñ]/.test(text) ? 3 : 0) },
      { language: "Portuguese", score: score(["uma", "para", "com", "mas", "como", "preciso", "clientes", "não"]) + (/[ãõ]/.test(text) ? 3 : 0) },
      { language: "French", score: score(["le", "les", "des", "une", "pour", "avec", "mais", "besoin", "clients"]) + (/[àâçéèêëîïôûùœ]/.test(text) ? 2 : 0) },
      { language: "German", score: score(["der", "die", "das", "und", "ist", "nicht", "mit", "für", "brauche", "kunden"]) + (/[äöüß]/.test(text) ? 3 : 0) },
      { language: "Italian", score: score(["il", "lo", "gli", "una", "per", "con", "non", "come", "bisogno", "clienti"]) },
      { language: "English", score: score(["the", "a", "an", "and", "is", "are", "to", "for", "with", "how", "need", "needs", "users", "customers", "asks"]) },
    ].sort((left, right) => right.score - left.score);

    if (scores[0].score >= 2 || (scores[0].language === "English" && scores[0].score >= 1)) return scores[0].language;
    return "Latin-script language (infer the exact language from the source text)";
  }

  function detectSourceLanguage(value) {
    const text = clean(value).replace(/https?:\/\/\S+/gi, " ");
    if (!text) return "Unclear";

    const kanaCount = countMatches(text, /[\u3040-\u30ff]/g);
    const hangulCount = countMatches(text, /[\uac00-\ud7af]/g);
    const hanCount = countMatches(text, /[\u3400-\u4dbf\u4e00-\u9fff]/g);
    const arabicCount = countMatches(text, /[\u0600-\u06ff]/g);
    const hebrewCount = countMatches(text, /[\u0590-\u05ff]/g);
    const devanagariCount = countMatches(text, /[\u0900-\u097f]/g);
    const thaiCount = countMatches(text, /[\u0e00-\u0e7f]/g);
    const cyrillicCount = countMatches(text, /[\u0400-\u04ff]/g);
    const latinCount = countMatches(text, /[A-Za-zÀ-ɏ]/g);

    if (kanaCount > 0) return "Japanese";
    const scripts = [
      { language: "Korean", count: hangulCount },
      { language: "Chinese (preserve the source's script)", count: hanCount },
      { language: "Arabic", count: arabicCount },
      { language: "Hebrew", count: hebrewCount },
      { language: "Devanagari-script language (infer the exact language from the source text)", count: devanagariCount },
      { language: "Thai", count: thaiCount },
      { language: "Cyrillic-script language (infer the exact language from the source text)", count: cyrillicCount },
    ].sort((left, right) => right.count - left.count);

    if (scripts[0].count > 0 && scripts[0].count >= Math.max(2, Math.round(latinCount * 0.25))) return scripts[0].language;
    if (latinCount > 0) return latinLanguageHint(text);
    if (scripts[0].count > 0) return scripts[0].language;
    return "Unclear";
  }

  function itemDraftKey(item) {
    const url = normalizeUrl(item?.url);
    if (url) return `url:${url}`;

    return [
      "text",
      clean(item?.platform).toLowerCase(),
      clean(item?.name ?? item?.author).toLowerCase(),
      hashValue(clean(item?.note ?? item?.text).toLowerCase().replace(/\s+/g, " ")),
    ].join(":");
  }

  function positiveFeedback(value) {
    return ["got_reply", "followed", "reshared"].includes(clean(value));
  }

  function normalizeAiDraft(draft, modeInput) {
    const mode = normalizeMode(modeInput);
    const itemId = clean(draft?.itemId);
    const base = {
      itemId,
      rationale: clean(draft?.rationale),
      toneNotes: clean(draft?.toneNotes),
      model: clean(draft?.model),
      generatedAt: clean(draft?.generatedAt),
    };

    if (mode === "outbound") {
      return {
        ...base,
        draft: clean(draft?.draft ?? draft?.primaryDraft ?? draft?.outreachDraft),
      };
    }

    return {
      ...base,
      replyDraft: clean(draft?.replyDraft ?? draft?.draft ?? draft?.primaryDraft),
      quoteDraft: clean(draft?.quoteDraft),
      postIdea: clean(draft?.postIdea),
      outreachDraft: clean(draft?.outreachDraft),
    };
  }

  function normalizeAiDraftResponse(rawValue, modeInput) {
    const mode = normalizeMode(modeInput);
    const source = rawValue && typeof rawValue === "object" ? rawValue : {};
    const drafts = Array.isArray(source.drafts) ? source.drafts : [];

    return {
      drafts: drafts
        .map((draft) => normalizeAiDraft(draft, mode))
        .filter((draft) => draft.itemId && (mode === "outbound" ? draft.draft : draft.replyDraft || draft.quoteDraft || draft.postIdea || draft.outreachDraft)),
    };
  }

  function draftOverrideMap(overrides, modeInput) {
    const mode = normalizeMode(modeInput);
    if (!overrides || typeof overrides !== "object") return {};

    return Object.fromEntries(
      Object.entries(overrides)
        .map(([key, value]) => {
          const normalized = normalizeAiDraft({ itemId: key, ...(value || {}) }, mode);
          return normalized.itemId ? [normalized.itemId, normalized] : null;
        })
        .filter(Boolean)
    );
  }

  function applyDraftToItem(item, override, mode) {
    if (!override) return item;

    if (mode === "outbound") {
      return {
        ...item,
        draft: override.draft || item.draft,
        aiDraft: override,
      };
    }

    return {
      ...item,
      replyDraft: override.replyDraft || item.replyDraft,
      quoteDraft: override.quoteDraft || item.quoteDraft,
      postIdea: override.postIdea || item.postIdea,
      outreachDraft: override.outreachDraft || item.outreachDraft,
      aiDraft: override,
    };
  }

  function applyAiDraftOverrides(result, overrides) {
    const mode = normalizeMode(result?.mode);
    const map = draftOverrideMap(overrides, mode);

    if (mode === "outbound") {
      return {
        ...result,
        leads: (result?.leads ?? []).map((item) => applyDraftToItem(item, map[itemDraftKey(item)], mode)),
      };
    }

    return {
      ...result,
      opportunities: (result?.opportunities ?? []).map((item) => applyDraftToItem(item, map[itemDraftKey(item)], mode)),
    };
  }

  function buildStyleSamples(feedbackSignals) {
    return (Array.isArray(feedbackSignals) ? feedbackSignals : [])
      .filter((signal) => positiveFeedback(signal?.feedback) && clean(signal?.usedDraft))
      .sort((left, right) => new Date(right.feedbackAt || right.usedDraftAt || 0).getTime() - new Date(left.feedbackAt || left.usedDraftAt || 0).getTime())
      .slice(0, 8)
      .map((signal) => ({
        platform: clean(signal.platform),
        author: clean(signal.author),
        originalSignal: clean(signal.text),
        actualReply: clean(signal.usedDraft),
        feedback: clean(signal.feedback),
        reason: clean(signal.reason),
        tags: Array.isArray(signal.tags) ? signal.tags.map(clean).filter(Boolean) : [],
      }));
  }

  function normalizeGrowthMemoryForPrompt(memory) {
    if (!memory || typeof memory !== "object" || !memory.active) return null;
    const inactivePatterns = Array.isArray(memory.scoreBoostRules)
      ? memory.scoreBoostRules.filter((rule) => rule?.status && rule.status !== "active").map((rule) => clean(rule?.pattern).toLowerCase()).filter(Boolean)
      : [];
    const effectiveKeywords = Array.isArray(memory.effectiveKeywords)
      ? memory.effectiveKeywords.map(clean).filter(Boolean).filter((keyword) => {
          const value = keyword.toLowerCase();
          return !inactivePatterns.some((pattern) => Math.min(pattern.length, value.length) >= 4 && (pattern.includes(value) || value.includes(pattern)));
        })
      : [];
    return {
      summary: clean(memory.summary).slice(0, 500),
      effectiveKeywords: effectiveKeywords.slice(0, 6),
      replyStyleRules: Array.isArray(memory.replyStyleRules) ? memory.replyStyleRules.map(clean).filter(Boolean).slice(0, 4) : [],
      avoidReplyPatterns: Array.isArray(memory.avoidReplyPatterns) ? memory.avoidReplyPatterns.map(clean).filter(Boolean).slice(0, 3) : [],
      nextExperiment: clean(memory.nextExperiment).slice(0, 300),
    };
  }

  function buildDraftRequestInput({ mode: modeInput, profile, items, feedbackSignals, growthMemory, locale }) {
    const mode = normalizeMode(modeInput);
    const normalizedLocale = normalizeLocale(locale);
    const fallbackLanguage = normalizedLocale === "en" ? "English" : "Simplified Chinese";
    const queueItems = (Array.isArray(items) ? items : []).slice(0, AI_DRAFT_LIMIT);

    return {
      mode,
      locale: normalizedLocale,
      profile: {
        productName: clean(profile?.productName),
        description: clean(profile?.description),
        targetCustomer: clean(profile?.targetCustomer),
        competitors: clean(profile?.competitors),
        painPoints: clean(profile?.painPoints),
        replyGoal: clean(profile?.replyGoal),
        productContext: clean(profile?.productContext),
      },
      styleGuide: {
        language: "Match each item's source language",
        fallbackLanguage,
        voice: "direct, useful, specific, and low-hype",
        constraints: [
          "Write every draft field in item.sourceLanguage, which represents the original post language. If it is missing or Unclear, infer the dominant natural language from the source text. Never translate drafts into the interface language; use fallbackLanguage only when both are genuinely unclear.",
          "Use only the supplied post and profile. Do not invent claims, metrics, offers, links, or private context.",
          "Start from a specific observation, question, or useful next step related to the source post; avoid generic praise and advertising language.",
          "Treat profile.productContext as a disclosure policy. Mention a product or identity only when it improves relevance or trust.",
          "Keep drafts concise enough for their intended X use. Do not assume consent to contact or promise a service that the profile did not state.",
          "For growth mode, make replyDraft ready to post, quoteDraft suitable for a quote post, postIdea a distinct content seed, and outreachDraft a respectful optional follow-up.",
        ],
      },
      styleSamples: buildStyleSamples(feedbackSignals),
      growthMemory: normalizeGrowthMemoryForPrompt(growthMemory),
      items: queueItems.map((item) => {
        const text = clean(item?.note ?? item?.text);
        const declaredSourceLanguage = clean(item?.sourceLanguage);
        return {
          itemId: itemDraftKey(item),
          platform: clean(item?.platform),
          name: clean(item?.name ?? item?.author),
          url: clean(item?.url),
          text,
          sourceLanguage: declaredSourceLanguage || detectSourceLanguage(text),
          score: Number.isFinite(Number(item?.score)) ? Math.max(0, Math.min(100, Math.round(Number(item.score)))) : 0,
          label: clean(item?.label),
          reasons: Array.isArray(item?.reasons) ? item.reasons.map(clean).filter(Boolean) : [],
          localDrafts:
            mode === "outbound"
              ? { draft: clean(item?.draft) }
              : { replyDraft: clean(item?.replyDraft), quoteDraft: clean(item?.quoteDraft), postIdea: clean(item?.postIdea), outreachDraft: clean(item?.outreachDraft) },
        };
      }),
    };
  }

  function createDraftResponseSchema(modeInput) {
    const mode = normalizeMode(modeInput);
    const draftProperties =
      mode === "outbound"
        ? {
            draft: { type: "string" },
          }
        : {
            replyDraft: { type: "string" },
            quoteDraft: { type: "string" },
            postIdea: { type: "string" },
            outreachDraft: { type: "string" },
          };
    const draftRequired = mode === "outbound" ? ["draft"] : ["replyDraft", "quoteDraft", "postIdea", "outreachDraft"];

    return {
      type: "object",
      additionalProperties: false,
      required: ["drafts"],
      properties: {
        drafts: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["itemId", ...draftRequired, "rationale", "toneNotes"],
            properties: {
              itemId: { type: "string" },
              ...draftProperties,
              rationale: { type: "string" },
              toneNotes: { type: "string" },
            },
          },
        },
      },
    };
  }

  function buildOpenAiDraftRequestBody({ model, payload }) {
    const mode = normalizeMode(payload?.mode);
    const safePayload = {
      ...payload,
      mode,
      items: Array.isArray(payload?.items) ? payload.items.slice(0, AI_DRAFT_LIMIT) : [],
    };

    return {
      model: clean(model) || "gpt-5.5",
      input: [
        {
          role: "system",
          content:
            "Generate concise, source-specific engagement drafts for a public-growth workflow. For each item, item.sourceLanguage identifies the original post language and takes precedence over the language of item.text because older text may be a localized summary. Write every draft field in item.sourceLanguage; only infer from item.text when sourceLanguage is Unclear or missing. Do not translate drafts into the interface language; use styleGuide.fallbackLanguage only when both are genuinely unclear. Use payload.locale only for rationale and toneNotes so those explanations remain readable in the interface. Follow the rest of payload.styleGuide. Use growthMemory as optional historical feedback, not as a source of facts. Preserve itemId exactly. Do not fabricate context or write generic sales copy. Return only the requested JSON object.",
        },
        {
          role: "user",
          content: JSON.stringify(safePayload),
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "ray_growth_draft_response",
          schema: createDraftResponseSchema(mode),
          strict: true,
        },
      },
    };
  }

  return {
    AI_DRAFT_LIMIT,
    applyAiDraftOverrides,
    buildDraftRequestInput,
    buildOpenAiDraftRequestBody,
    createDraftResponseSchema,
    detectSourceLanguage,
    itemDraftKey,
    normalizeAiDraft,
    normalizeAiDraftResponse,
  };
});
