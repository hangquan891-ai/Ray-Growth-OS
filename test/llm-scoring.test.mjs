import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);

const {
  AI_SCORE_LIMIT,
  applyAiScoreOverrides,
  buildScoreRequestInput,
  buildOpenAiScoreRequestBody,
  createScoreResponseSchema,
  extractResponseOutputText,
  normalizeAiScoreResponse,
} = require("../src/lib/llm-scoring.js");

test("normalizeAiScoreResponse clamps dimensions and canonicalizes labels by mode", () => {
  const normalized = normalizeAiScoreResponse(
    {
      scores: [
        {
          itemId: "url:https://x.com/a/status/1",
          score: 129,
          label: "go now",
          targetFit: 33,
          painIntensity: -3,
          replyValue: 20,
          contentPotential: 18,
          timingRisk: 999,
          recommendedAction: "reply first",
          reason: "clear target and pain",
          suggestedAngle: "share a concrete first-user loop",
        },
      ],
    },
    "growth"
  );

  assert.equal(normalized.scores.length, 1);
  assert.equal(normalized.scores[0].score, 100);
  assert.equal(normalized.scores[0].label, "Engage now");
  assert.equal(normalized.scores[0].targetFit, 33);
  assert.equal(normalized.scores[0].painIntensity, 0);
  assert.equal(normalized.scores[0].timingRisk, 100);
  assert.equal(normalized.scores[0].reason, "clear target and pain");
});

test("applyAiScoreOverrides updates matching queue items without dropping drafts", () => {
  const result = {
    mode: "growth",
    queries: [],
    opportunities: [
      {
        platform: "X",
        name: "AI founder",
        url: "https://x.com/a/status/1",
        note: "asks how to get first users after building with AI Coding",
        score: 45,
        label: "Watch",
        reasons: ["local rule"],
        action: "collect",
        replyDraft: "reply draft",
        quoteDraft: "quote draft",
        postIdea: "post idea",
      },
    ],
  };

  const updated = applyAiScoreOverrides(result, {
    "url:https://x.com/a/status/1": {
      itemId: "url:https://x.com/a/status/1",
      score: 91,
      label: "Engage now",
      targetFit: 90,
      painIntensity: 88,
      replyValue: 84,
      contentPotential: 76,
      timingRisk: 12,
      recommendedAction: "reply then quote",
      reason: "strong target fit and public reply value",
      suggestedAngle: "explain a concrete first-user search loop",
    },
  });

  assert.equal(updated.opportunities[0].score, 91);
  assert.equal(updated.opportunities[0].label, "Engage now");
  assert.deepEqual(updated.opportunities[0].reasons, ["AI: strong target fit and public reply value"]);
  assert.equal(updated.opportunities[0].action, "reply then quote");
  assert.equal(updated.opportunities[0].replyDraft, "reply draft");
  assert.equal(updated.opportunities[0].aiScore.targetFit, 90);
});

test("buildScoreRequestInput limits queue items and includes stable item ids", () => {
  const items = Array.from({ length: AI_SCORE_LIMIT + 3 }, (_, index) => ({
    platform: "X",
    name: `maker ${index}`,
    url: `https://x.com/maker/status/${index}`,
    note: `note ${index}`,
    score: index,
    label: "Watch",
    reasons: ["local"],
  }));

  const payload = buildScoreRequestInput({
    mode: "growth",
    profile: {
      productName: "Ray",
      description: "AI Coding creator",
      targetCustomer: "indie developers",
      competitors: "",
      painPoints: "AI Coding, first users",
    },
    items,
  });

  assert.equal(payload.items.length, AI_SCORE_LIMIT);
  assert.equal(payload.items[0].itemId, "url:https://x.com/maker/status/0");
  assert.equal(payload.items[0].localScore, 0);
  assert.equal(payload.items[0].text, "note 0");
});


test("buildOpenAiScoreRequestBody uses Responses structured output format", () => {
  const payload = buildScoreRequestInput({
    mode: "outbound",
    profile: { productName: "LaunchRadar", description: "", targetCustomer: "SaaS founders", competitors: "", painPoints: "first users" },
    items: [{ platform: "X", name: "maker", url: "https://x.com/maker/status/1", note: "need first users", score: 80, label: "High intent", reasons: ["local"] }],
  });

  const body = buildOpenAiScoreRequestBody({ model: "gpt-5.5", payload });

  assert.equal(body.model, "gpt-5.5");
  assert.equal(body.text.format.type, "json_schema");
  assert.equal(body.text.format.name, "ray_growth_score_response");
  assert.equal(body.text.format.strict, true);
  assert.deepEqual(body.text.format.schema.properties.scores.items.properties.label.enum, ["High intent", "Warm", "Low"]);
  assert.ok(JSON.stringify(body.input).includes("need first users"));
});

test("extractResponseOutputText reads direct and nested Responses API text", () => {
  assert.equal(extractResponseOutputText({ output_text: "{\"scores\":[]}" }), "{\"scores\":[]}");
  assert.equal(
    extractResponseOutputText({
      output: [
        {
          content: [
            { type: "output_text", text: "{\"scores\":[{\"score\":80}]}" },
          ],
        },
      ],
    }),
    "{\"scores\":[{\"score\":80}]}"
  );
});
test("createScoreResponseSchema is strict and rejects extra score fields", () => {
  const schema = createScoreResponseSchema("outbound");

  assert.equal(schema.type, "object");
  assert.equal(schema.additionalProperties, false);
  assert.equal(schema.properties.scores.items.additionalProperties, false);
  assert.deepEqual(schema.properties.scores.items.properties.label.enum, ["High intent", "Warm", "Low"]);
});