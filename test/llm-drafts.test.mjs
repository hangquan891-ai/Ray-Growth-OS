import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);

const {
  AI_DRAFT_LIMIT,
  applyAiDraftOverrides,
  buildDraftRequestInput,
  buildOpenAiDraftRequestBody,
  createDraftResponseSchema,
  detectSourceLanguage,
  itemDraftKey,
  normalizeAiDraftResponse,
} = require("../src/lib/llm-drafts.js");

test("buildDraftRequestInput includes queue items and positive style samples", () => {
  const items = Array.from({ length: AI_DRAFT_LIMIT + 2 }, (_, index) => ({
    platform: "X",
    name: `maker ${index}`,
    url: `https://x.com/maker/status/${index}`,
    note: "asks how to get first users",
    score: 80,
    label: "Engage now",
    reasons: ["pain"],
    replyDraft: "local reply",
    quoteDraft: "local quote",
    postIdea: "local post",
    outreachDraft: "local outreach",
  }));

  const payload = buildDraftRequestInput({
    mode: "growth",
    locale: "en",
    profile: { productName: "Ray", description: "AI Coding creator" },
    items,
    feedbackSignals: [
      {
        platform: "X",
        author: "founder",
        text: "needs users",
        feedback: "got_reply",
        usedDraft: "share a concrete first-user loop",
        usedDraftAt: "2026-07-07T09:00:00.000Z",
        tags: ["first users"],
      },
      { feedback: "no_reply", usedDraft: "do not include" },
    ],
  });

  assert.equal(payload.mode, "growth");
  assert.equal(payload.items.length, AI_DRAFT_LIMIT);
  assert.equal(payload.items[0].itemId, itemDraftKey(items[0]));
  assert.equal(payload.items[0].localDrafts.replyDraft, "local reply");
  assert.equal(payload.items[0].localDrafts.outreachDraft, "local outreach");
  assert.equal(payload.styleSamples.length, 1);
  assert.equal(payload.styleSamples[0].actualReply, "share a concrete first-user loop");
  assert.equal(payload.locale, "en");
  assert.equal(payload.styleGuide.language, "Match each item's source language");
  assert.equal(payload.styleGuide.fallbackLanguage, "English");
  assert.equal(payload.items[0].sourceLanguage, "English");
});

test("detectSourceLanguage recognizes common source scripts and languages", () => {
  assert.equal(detectSourceLanguage("How do I find my first users?"), "English");
  assert.equal(detectSourceLanguage("今天如何找到第一批用户？"), "Chinese (preserve the source's script)");
  assert.equal(detectSourceLanguage("最初のユーザーをどう探せばいいですか？"), "Japanese");
  assert.equal(detectSourceLanguage("Necesito encontrar clientes para mi producto"), "Spanish");
  assert.equal(detectSourceLanguage("첫 사용자를 어떻게 찾을 수 있나요?"), "Korean");
  assert.equal(detectSourceLanguage("https://x.com/example/status/1"), "Unclear");
});

test("buildDraftRequestInput assigns source language per item in a mixed batch", () => {
  const payload = buildDraftRequestInput({
    mode: "growth",
    locale: "zh-CN",
    items: [
      { platform: "X", name: "en", note: "这是一条旧版中文摘要", sourceLanguage: "en" },
      { platform: "X", name: "ja", note: "AIツールの使い方を知りたいです" },
      { platform: "X", name: "es", note: "Necesito clientes para mi producto" },
    ],
  });

  assert.equal(payload.styleGuide.fallbackLanguage, "Simplified Chinese");
  assert.deepEqual(payload.items.map((item) => item.sourceLanguage), ["en", "Japanese", "Spanish"]);
  assert.ok(payload.styleGuide.constraints[0].includes("item.sourceLanguage"));
});

test("normalizeAiDraftResponse and applyAiDraftOverrides update generated drafts only", () => {
  const result = {
    mode: "growth",
    queries: [],
    opportunities: [
      {
        platform: "X",
        name: "maker",
        url: "https://x.com/maker/status/1",
        note: "needs users",
        score: 88,
        label: "Engage now",
        reasons: ["local"],
        action: "reply",
        replyDraft: "local reply",
        quoteDraft: "local quote",
        postIdea: "local post",
        outreachDraft: "local outreach",
      },
    ],
  };
  const itemId = itemDraftKey(result.opportunities[0]);
  const normalized = normalizeAiDraftResponse(
    {
      drafts: [
        {
          itemId,
          replyDraft: "AI reply",
          quoteDraft: "AI quote",
          postIdea: "AI post",
          outreachDraft: "AI outreach",
          rationale: "matches pain",
          toneNotes: "direct",
        },
      ],
    },
    "growth"
  );
  const updated = applyAiDraftOverrides(result, Object.fromEntries(normalized.drafts.map((draft) => [draft.itemId, draft])));

  assert.equal(normalized.drafts.length, 1);
  assert.equal(updated.opportunities[0].replyDraft, "AI reply");
  assert.equal(updated.opportunities[0].quoteDraft, "AI quote");
  assert.equal(updated.opportunities[0].postIdea, "AI post");
  assert.equal(updated.opportunities[0].outreachDraft, "AI outreach");
  assert.equal(updated.opportunities[0].score, 88);
  assert.equal(updated.opportunities[0].aiDraft.rationale, "matches pain");
});

test("buildOpenAiDraftRequestBody uses strict structured output per mode", () => {
  const payload = buildDraftRequestInput({
    mode: "outbound",
    profile: { productName: "LaunchRadar" },
    items: [{ platform: "X", name: "maker", url: "https://x.com/m/status/1", note: "needs leads", draft: "local" }],
  });
  const body = buildOpenAiDraftRequestBody({ model: "gpt-5.5", payload });
  const schema = createDraftResponseSchema("outbound");

  assert.equal(body.model, "gpt-5.5");
  assert.ok(body.input[0].content.includes("sourceLanguage identifies the original post language"));
  assert.ok(body.input[0].content.includes("rationale and toneNotes"));
  assert.equal(body.text.format.name, "ray_growth_draft_response");
  assert.deepEqual(schema.properties.drafts.items.required, ["itemId", "draft", "rationale", "toneNotes"]);
  assert.equal(schema.properties.drafts.items.additionalProperties, false);

  const growthSchema = createDraftResponseSchema("growth");
  assert.deepEqual(growthSchema.properties.drafts.items.required, [
    "itemId",
    "replyDraft",
    "quoteDraft",
    "postIdea",
    "outreachDraft",
    "rationale",
    "toneNotes",
  ]);
});
