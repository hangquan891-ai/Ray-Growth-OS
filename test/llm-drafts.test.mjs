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
  }));

  const payload = buildDraftRequestInput({
    mode: "growth",
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
  assert.equal(payload.styleSamples.length, 1);
  assert.equal(payload.styleSamples[0].actualReply, "share a concrete first-user loop");
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
  assert.equal(body.text.format.name, "ray_growth_draft_response");
  assert.deepEqual(schema.properties.drafts.items.required, ["itemId", "draft", "rationale", "toneNotes"]);
  assert.equal(schema.properties.drafts.items.additionalProperties, false);
});