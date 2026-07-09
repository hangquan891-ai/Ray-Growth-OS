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

  function compactText(value, limit) {
    const text = clean(value).replace(/\s+/g, " ");
    if (text.length <= limit) return text;
    return `${text.slice(0, Math.max(0, limit - 1)).trim()}…`;
  }

  function normalizeGeneratedProfile(rawValue, modeInput) {
    const mode = normalizeMode(modeInput);
    const source = rawValue && typeof rawValue === "object" ? rawValue : {};
    const profile = source.profile && typeof source.profile === "object" ? source.profile : source;

    const fallbackGoal =
      mode === "outbound"
        ? "先建立可信互动，确认对方是否有当前痛点，再轻量邀请试用或继续沟通。"
        : "先贡献一个可执行观点，让对方愿意关注、回复或继续交流。";
    const fallbackContext =
      mode === "outbound"
        ? "自然说明我正在做这个产品，只有在对方痛点明确时再提到下一步，不要硬卖。"
        : "自然说明我的身份和长期记录的主题，优先提供价值，不要像广告。";

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

  function buildProfileRequestInput({ mode: modeInput, xProfileUrl, current }) {
    const mode = normalizeMode(modeInput);
    return {
      mode,
      xProfileUrl: clean(xProfileUrl),
      fieldMeaning:
        mode === "outbound"
          ? {
              productName: "产品名称",
              competitors: "竞品或替代方案",
              description: "产品描述",
              targetCustomer: "目标客户",
              painPoints: "核心痛点",
              replyGoal: "互动目的或下一步",
              productContext: "产品/身份露出方式",
            }
          : {
              productName: "账号名称",
              competitors: "增长目标",
              description: "账号定位",
              targetCustomer: "目标读者",
              painPoints: "内容支柱",
              replyGoal: "互动目的或下一步",
              productContext: "产品/身份露出方式",
            },
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
        "用中文输出，像可直接粘进表单的定位草稿。",
        "优先根据公开 X 主页地址、账号名、简介和已有填写内容推断；如果不能读取主页，不要假装看到了具体动态。",
        "生成内容必须能用于后续 Grok 找目标讨论、AI 评分和回复草稿。",
        "replyGoal 要说明这次互动想让对方做什么，productContext 要说明什么时候露出身份/产品。",
        "不要写空泛口号，不要写粉丝数、帖子数等无法验证的数据。",
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

    return {
      model: clean(model) || "gpt-5.5",
      input: [
        {
          role: "system",
          content:
            "You are the onboarding positioning assistant for Ray Growth OS. Generate concise Chinese form fields for a GTM/growth workflow from a public X profile URL and any existing user input. Be practical, commercially useful, and honest about uncertainty. Return only the requested structured output.",
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