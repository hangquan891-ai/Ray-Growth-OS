import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);

const {
  buildOpenAiProfileRequestBody,
  buildProfileRequestInput,
  createProfileResponseSchema,
  normalizeGeneratedProfile,
} = require("../src/lib/llm-profile.js");

test("buildProfileRequestInput maps growth form meanings", () => {
  const input = buildProfileRequestInput({
    mode: "growth",
    xProfileUrl: "https://x.com/ray_codeproxy",
    current: { productName: "Ray", description: "AI Coding 出海日记" },
  });

  assert.equal(input.mode, "growth");
  assert.equal(input.xProfileUrl, "https://x.com/ray_codeproxy");
  assert.equal(input.fieldMeaning.productName, "账号名称");
  assert.equal(input.fieldMeaning.competitors, "增长目标");
  assert.equal(input.current.productName, "Ray");

  const englishInput = buildProfileRequestInput({ mode: "growth", locale: "en", xProfileUrl: "https://x.com/example", current: {} });
  assert.equal(englishInput.locale, "en");
  assert.equal(englishInput.fieldMeaning.targetCustomer, "Target audience");
});

test("buildOpenAiProfileRequestBody creates a strict Responses API schema", () => {
  const body = buildOpenAiProfileRequestBody({
    model: "gpt-5.5",
    payload: { mode: "outbound", xProfileUrl: "https://x.com/example", current: {} },
  });
  const schema = createProfileResponseSchema();

  assert.equal(body.model, "gpt-5.5");
  assert.equal(body.text.format.type, "json_schema");
  assert.equal(body.text.format.strict, true);
  assert.deepEqual(body.text.format.schema, schema);
  assert.match(body.input[0].content, /form-ready positioning/);
});

test("normalizeGeneratedProfile preserves practical defaults and trims long text", () => {
  const profile = normalizeGeneratedProfile(
    {
      profile: {
        productName: " Ray ",
        competitors: "提升互动质量",
        description: "A".repeat(400),
        targetCustomer: "独立开发者",
        painPoints: "AI Coding, 0 traffic",
        replyGoal: "",
        productContext: "",
        reasoning: "根据 X 主页和当前上下文推断",
      },
    },
    "growth"
  );

  assert.equal(profile.productName, "Ray");
  assert.equal(profile.targetCustomer, "独立开发者");
  assert.match(profile.replyGoal, /贡献/);
  assert.match(profile.productContext, /身份/);
  assert.ok(profile.description.length <= 260);

  const englishProfile = normalizeGeneratedProfile({ profile: {} }, "growth", "en");
  assert.match(englishProfile.replyGoal, /actionable idea/);
  assert.match(englishProfile.productContext, /unverified claims/);
});
