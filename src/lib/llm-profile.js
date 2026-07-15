(function initLlmProfile(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  root.LlmProfile = api;
})(typeof globalThis !== "undefined" ? globalThis : window, function createLlmProfileApi() {
  const FIELD_LIMITS = {
    productName: 80,
    competitors: 120,
    description: 260,
    targetCustomer: 220,
    painPoints: 180,
    replyGoal: 180,
    productContext: 240,
    reasoning: 260,
  };

  function clean(value) {
    return String(value ?? "").trim();
  }

  function normalizeMode(mode) {
    return mode === "outbound" ? "outbound" : "growth";
  }

  function normalizeLocale(locale) {
    return locale === "en" ? "en" : "zh-CN";
  }

  function compactText(value, limit) {
    const text = clean(value).replace(/\s+/g, " ");
    if (text.length <= limit) return text;
    return `${text.slice(0, Math.max(0, limit - 1)).trim()}…`;
  }

  function normalizeGeneratedProfile(rawValue, modeInput, localeInput) {
    const mode = normalizeMode(modeInput);
    const locale = normalizeLocale(localeInput);
    const source = rawValue && typeof rawValue === "object" ? rawValue : {};
    const profile = source.profile && typeof source.profile === "object" ? source.profile : source;

    const fallbackGoal = locale === "en"
      ? mode === "outbound"
        ? "Start a relevant conversation and confirm the current problem before proposing a next step."
        : "Contribute one actionable idea that invites a follow-up or continued discussion."
      : mode === "outbound"
        ? "先建立可信互动，确认对方是否有当前痛点，再讨论是否需要下一步。"
        : "先贡献一个可执行观点，让对方愿意关注、回复或继续交流。";
    const fallbackContext = locale === "en"
      ? "Mention the operator or product only when it makes the reply more relevant; do not make unverified claims."
      : "只在有助于理解回复时说明身份或产品，不写无法验证的承诺。";

    return {
      productName: compactText(profile.productName, FIELD_LIMITS.productName),
      competitors: compactText(profile.competitors, FIELD_LIMITS.competitors),
      description: compactText(profile.description, FIELD_LIMITS.description),
      targetCustomer: compactText(profile.targetCustomer, FIELD_LIMITS.targetCustomer),
      painPoints: compactText(profile.painPoints, FIELD_LIMITS.painPoints),
      replyGoal: compactText(profile.replyGoal, FIELD_LIMITS.replyGoal) || fallbackGoal,
      productContext: compactText(profile.productContext, FIELD_LIMITS.productContext) || fallbackContext,
      reasoning: compactText(profile.reasoning, FIELD_LIMITS.reasoning),
    };
  }

  function buildProfileRequestInput({ mode: modeInput, xProfileUrl, current, locale: localeInput }) {
    const mode = normalizeMode(modeInput);
    const locale = normalizeLocale(localeInput);
    const growthFields = locale === "en"
      ? {
          productName: "Account or product name",
          competitors: "Growth goal or alternatives",
          description: "Positioning",
          targetCustomer: "Target audience",
          painPoints: "Topics or pain points",
          replyGoal: "Engagement goal or next step",
          productContext: "When and how to disclose the product or identity",
        }
      : {
          productName: "账号名称",
          competitors: "增长目标",
          description: "账号定位",
          targetCustomer: "目标读者",
          painPoints: "内容支柱",
          replyGoal: "互动目的或下一步",
          productContext: "产品/身份露出方式",
        };
    const outboundFields = locale === "en"
      ? {
          productName: "Product name",
          competitors: "Competitors or alternatives",
          description: "Product description",
          targetCustomer: "Target customer",
          painPoints: "Core pain points",
          replyGoal: "Engagement goal or next step",
          productContext: "When and how to disclose the product or identity",
        }
      : {
          productName: "产品名称",
          competitors: "竞品或替代方案",
          description: "产品描述",
          targetCustomer: "目标客户",
          painPoints: "核心痛点",
          replyGoal: "互动目的或下一步",
          productContext: "产品/身份露出方式",
        };
    return {
      mode,
      locale,
      xProfileUrl: clean(xProfileUrl),
      fieldMeaning: mode === "outbound" ? outboundFields : growthFields,
      current: {
        productName: clean(current?.productName),
        competitors: clean(current?.competitors),
        description: clean(current?.description),
        targetCustomer: clean(current?.targetCustomer),
        painPoints: clean(current?.painPoints),
        replyGoal: clean(current?.replyGoal),
        productContext: clean(current?.productContext),
      },
      rules: [
        locale === "en" ? "Write all fields in English." : "所有字段使用简体中文。",
        "Infer only from the public X URL and the supplied fields. If the profile cannot be read, do not present unseen posts or metrics as fact.",
        "Produce form-ready positioning that can guide public-discussion discovery, scoring, and draft generation.",
        "Make replyGoal concrete and make productContext a clear disclosure rule, not a sales slogan.",
        "Avoid generic slogans and unverifiable metrics such as follower or post counts.",
      ],
    };
  }

  function createProfileResponseSchema() {
    const profileProperties = {
      productName: { type: "string" },
      competitors: { type: "string" },
      description: { type: "string" },
      targetCustomer: { type: "string" },
      painPoints: { type: "string" },
      replyGoal: { type: "string" },
      productContext: { type: "string" },
      reasoning: { type: "string" },
    };

    return {
      type: "object",
      additionalProperties: false,
      required: ["profile"],
      properties: {
        profile: {
          type: "object",
          additionalProperties: false,
          required: Object.keys(profileProperties),
          properties: profileProperties,
        },
      },
    };
  }

  function buildOpenAiProfileRequestBody({ model, payload }) {
    const safePayload = buildProfileRequestInput(payload || {});
    const normalizedModel = clean(model) || "gpt-5.5";
    const isGpt55 = /^gpt-5\.5(?:$|-)/i.test(normalizedModel);

    return {
      model: normalizedModel,
      max_output_tokens: 2400,
      ...(isGpt55 ? { reasoning: { effort: "none" } } : {}),
      input: [
        {
          role: "system",
          content:
            "Create concise, form-ready positioning for a public-growth workflow. Use only the public X URL and supplied user input; never claim to have read unavailable profile data. Follow payload.locale for every generated field, keep uncertainty explicit, and return only the requested JSON object.",
        },
        {
          role: "user",
          content: JSON.stringify(safePayload),
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "ray_growth_profile_response",
          schema: createProfileResponseSchema(),
          strict: true,
        },
      },
    };
  }

  return {
    buildOpenAiProfileRequestBody,
    buildProfileRequestInput,
    createProfileResponseSchema,
    normalizeGeneratedProfile,
  };
});
