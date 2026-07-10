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
    return {
      summary: clean(memory.summary),
      effectiveKeywords: Array.isArray(memory.effectiveKeywords) ? memory.effectiveKeywords.map(clean).filter(Boolean).slice(0, 8) : [],
      replyStyleRules: Array.isArray(memory.replyStyleRules) ? memory.replyStyleRules.map(clean).filter(Boolean).slice(0, 8) : [],
      avoidReplyPatterns: Array.isArray(memory.avoidReplyPatterns) ? memory.avoidReplyPatterns.map(clean).filter(Boolean).slice(0, 8) : [],
      nextExperiment: clean(memory.nextExperiment),
    };
  }

  function buildDraftRequestInput({ mode: modeInput, profile, items, feedbackSignals, growthMemory, locale }) {
    const mode = normalizeMode(modeInput);
    const queueItems = (Array.isArray(items) ? items : []).slice(0, AI_DRAFT_LIMIT);

    return {
      mode,
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
        language: normalizeLocale(locale) === "en" ? "English" : "Simplified Chinese",
        voice: "direct, useful, specific, and low-hype",
        constraints: [
          "Use only the supplied post and profile. Do not invent claims, metrics, offers, links, or private context.",
          "Start from a specific observation, question, or useful next step related to the source post; avoid generic praise and advertising language.",
          "Treat profile.productContext as a disclosure policy. Mention a product or identity only when it improves relevance or trust.",
          "Keep drafts concise enough for their intended X use. Do not assume consent to contact or promise a service that the profile did not state.",
          "For growth mode, make replyDraft ready to post, quoteDraft suitable for a quote post, postIdea a distinct content seed, and outreachDraft a respectful optional follow-up.",
        ],
      },
      styleSamples: buildStyleSamples(feedbackSignals),
      growthMemory: normalizeGrowthMemoryForPrompt(growthMemory),
      items: queueItems.map((item) => ({
        itemId: itemDraftKey(item),
        platform: clean(item?.platform),
        name: clean(item?.name ?? item?.author),
        url: clean(item?.url),
        text: clean(item?.note ?? item?.text),
        score: Number.isFinite(Number(item?.score)) ? Math.max(0, Math.min(100, Math.round(Number(item.score)))) : 0,
        label: clean(item?.label),
        reasons: Array.isArray(item?.reasons) ? item.reasons.map(clean).filter(Boolean) : [],
        localDrafts:
          mode === "outbound"
            ? { draft: clean(item?.draft) }
            : { replyDraft: clean(item?.replyDraft), quoteDraft: clean(item?.quoteDraft), postIdea: clean(item?.postIdea), outreachDraft: clean(item?.outreachDraft) },
      })),
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
            "Generate concise, source-specific engagement drafts for a public-growth workflow. Follow the payload styleGuide and use payload.locale for every narrative field. Use growthMemory as optional historical feedback, not as a source of facts. Preserve itemId exactly. Do not fabricate context or write generic sales copy. Return only the requested JSON object.",
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
    itemDraftKey,
    normalizeAiDraft,
    normalizeAiDraftResponse,
  };
});
