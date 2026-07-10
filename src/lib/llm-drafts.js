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

  function buildDraftRequestInput({ mode: modeInput, profile, items, feedbackSignals, growthMemory }) {
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
        language: "Chinese by default unless the source post is clearly English-only",
        voice: "direct, useful, specific, low-hype, founder-builder tone",
        constraints: [
          "Do not invent claims, metrics, or private context.",
          "Avoid hard selling. Lead with a concrete observation or useful mini-framework.",
          "Do not hide the author's identity or product completely when profile.productContext is provided; mention it lightly when it adds trust or context.",
          "Every replyDraft should serve profile.replyGoal: include a natural next step, question, or reason to continue the conversation without sounding like an ad.",
          "Keep reply drafts concise enough for X replies.",
          "For growth mode, make replyDraft directly usable, quoteDraft suitable for quoting, postIdea useful as a later content seed, and outreachDraft suitable for a private follow-up without hard selling.",
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
            "You are the draft generation engine for Ray Growth OS. Write practical, specific drafts in Ray's voice. Use profile.productContext and profile.replyGoal as the commercial intent: naturally reveal who Ray is or what the product/account does when useful, and include a light next step without hard selling. If growthMemory is provided, follow its proven style rules and avoid patterns. Preserve itemId exactly. Return only the requested structured output.",
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
