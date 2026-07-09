import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);

const {
  applyGrowthMemoryToQueueItems,
  buildGrowthMemoryPromptContext,
  buildGrowthMemoryRequestInput,
  buildOpenAiGrowthMemoryRequestBody,
  createGrowthMemoryResponseSchema,
  growthMemoryKeywordText,
  normalizeGrowthMemoryResponse,
  normalizeGrowthMemoryState,
} = require("../src/lib/growth-memory.js");

test("buildGrowthMemoryRequestInput extracts only feedback samples", () => {
  const payload = buildGrowthMemoryRequestInput({
    mode: "growth",
    profile: { productName: "Ray", description: "AI Coding creator", targetCustomer: "indie devs" },
    signals: [
      {
        id: "a",
        platform: "X",
        author: "maker",
        url: "https://x.com/maker/status/1",
        text: "asks how to find first users",
        feedback: "got_reply",
        feedbackAt: "2026-07-08T01:00:00.000Z",
        usedDraft: "share a concrete search loop",
        tags: ["first users"],
      },
      { id: "b", text: "no feedback yet", feedback: "none" },
      { id: "c", text: "too generic", feedback: "no_reply", feedbackAt: "2026-07-07T01:00:00.000Z" },
    ],
    aiScores: {
      "url:https://x.com/maker/status/1": { score: 92, label: "Engage now", reason: "clear pain", suggestedAngle: "first-user loop" },
    },
    aiDrafts: {
      "url:https://x.com/maker/status/1": { replyDraft: "AI reply", toneNotes: "direct" },
    },
  });

  assert.equal(payload.mode, "growth");
  assert.equal(payload.samples.length, 2);
  assert.equal(payload.sampleSummary.positive, 1);
  assert.equal(payload.sampleSummary.noReply, 1);
  assert.equal(payload.samples[0].score.score, 92);
  assert.equal(payload.samples[0].draft.replyDraft, "AI reply");
});

test("normalizeGrowthMemoryResponse and prompt helpers produce reversible memory", () => {
  const memory = normalizeGrowthMemoryResponse(
    {
      summary: "First-user pain works best.",
      effectiveKeywords: ["first users", "0 traffic", "first users"],
      weakKeywords: ["generic AI news"],
      accountRadarKeywords: ["Cursor alternative"],
      scoreBoostRules: [{ pattern: "first users", reason: "got replies", weight: 8 }],
      scorePenaltyRules: [{ pattern: "giveaway", reason: "low intent", weight: 30 }],
      replyStyleRules: ["Start with a concrete observation"],
      avoidReplyPatterns: ["Do not pitch immediately"],
      nextExperiment: "Ask one diagnostic question first.",
    },
    { sampleSummary: { total: 4, positive: 3, noReply: 1 } }
  );

  assert.equal(memory.active, false);
  assert.equal(memory.sampleCount, 4);
  assert.deepEqual(memory.effectiveKeywords, ["first users", "0 traffic"]);
  assert.equal(memory.scorePenaltyRules[0].weight, 12);

  const activeMemory = normalizeGrowthMemoryState({ ...memory, active: true });
  assert.ok(buildGrowthMemoryPromptContext(activeMemory).includes("first users"));
  assert.equal(growthMemoryKeywordText(activeMemory), "first users, 0 traffic, Cursor alternative");
});

test("applyGrowthMemoryToQueueItems adjusts scores only when active", () => {
  const result = {
    mode: "growth",
    queries: [],
    opportunities: [
      {
        platform: "X",
        name: "maker",
        url: "https://x.com/a/status/1",
        note: "I built with AI Coding but cannot find first users",
        score: 64,
        label: "Watch",
        reasons: ["local"],
        action: "watch",
        replyDraft: "",
        quoteDraft: "",
        postIdea: "",
      },
      {
        platform: "X",
        name: "promo",
        url: "https://x.com/b/status/1",
        note: "AI giveaway thread",
        score: 72,
        label: "Engage now",
        reasons: ["local"],
        action: "reply",
        replyDraft: "",
        quoteDraft: "",
        postIdea: "",
      },
    ],
  };

  const inactive = applyGrowthMemoryToQueueItems(result, { active: false, scoreBoostRules: [{ pattern: "first users", reason: "works", weight: 8 }] });
  assert.equal(inactive.opportunities[0].score, 64);

  const updated = applyGrowthMemoryToQueueItems(result, {
    active: true,
    scoreBoostRules: [{ pattern: "first users", reason: "got replies", weight: 8 }],
    scorePenaltyRules: [{ pattern: "giveaway", reason: "low intent", weight: 6 }],
  });

  assert.equal(updated.opportunities[0].score, 72);
  assert.equal(updated.opportunities[0].label, "Engage now");
  assert.equal(updated.opportunities[1].score, 66);
  assert.equal(updated.opportunities[0].growthMemoryApplied, true);
});

test("buildOpenAiGrowthMemoryRequestBody uses strict Responses JSON schema", () => {
  const payload = buildGrowthMemoryRequestInput({
    mode: "growth",
    profile: { productName: "Ray" },
    signals: [{ text: "needs users", feedback: "got_reply" }],
  });
  const body = buildOpenAiGrowthMemoryRequestBody({ model: "gpt-5.5", payload });
  const schema = createGrowthMemoryResponseSchema();

  assert.equal(body.model, "gpt-5.5");
  assert.equal(body.text.format.name, "ray_growth_memory_response");
  assert.equal(body.text.format.strict, true);
  assert.equal(schema.properties.scoreBoostRules.items.additionalProperties, false);
});