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
  feedbackSampleKey,
  growthMemoryKeywordText,
  mergeGrowthMemoryState,
  normalizeGrowthMemoryResponse,
  normalizeGrowthMemoryState,
} = require("../src/lib/growth-memory.js");

test("buildGrowthMemoryRequestInput extracts only feedback samples", () => {
  const payload = buildGrowthMemoryRequestInput({
    mode: "growth",
    locale: "en",
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
  assert.equal(payload.locale, "en");
  assert.equal(payload.samples[0].score.score, 92);
  assert.equal(payload.samples[0].draft.replyDraft, "AI reply");
  assert.equal(payload.samples[0].sampleKey, feedbackSampleKey({
    id: "a",
    url: "https://x.com/maker/status/1",
    author: "maker",
    text: "asks how to find first users",
    feedback: "got_reply",
    feedbackAt: "2026-07-08T01:00:00.000Z",
  }));
});

test("buildGrowthMemoryRequestInput skips feedback that was already learned", () => {
  const signal = {
    id: "learned",
    text: "first users are hard",
    feedback: "got_reply",
    feedbackAt: "2026-07-08T01:00:00.000Z",
  };
  const sampleKey = feedbackSampleKey(signal);
  const payload = buildGrowthMemoryRequestInput({
    mode: "growth",
    signals: [signal],
    previousMemory: {
      learnedSampleKeys: [sampleKey],
      scoreBoostRules: [{ pattern: "first users", reason: "worked before", weight: 6, status: "active", confidence: 75 }],
    },
  });

  assert.equal(payload.samples.length, 0);
  assert.equal(payload.existingMemory.scoreBoostRules.length, 1);
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

  const pausedKeywordMemory = normalizeGrowthMemoryState({
    ...activeMemory,
    effectiveKeywords: ["first users", "giveaway"],
    accountRadarKeywords: [],
    scoreBoostRules: [
      { pattern: "first users", reason: "works", weight: 6, status: "active" },
      { pattern: "giveaway", reason: "conflicting evidence", weight: 4, status: "paused" },
    ],
  });
  assert.equal(growthMemoryKeywordText(pausedKeywordMemory), "first users");
  assert.equal(buildGrowthMemoryPromptContext(pausedKeywordMemory).includes("giveaway"), false);
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

  const paused = applyGrowthMemoryToQueueItems(result, {
    active: true,
    scoreBoostRules: [{ pattern: "first users", reason: "paused after conflicting evidence", weight: 8, status: "paused" }],
  });
  assert.equal(paused.opportunities[0].score, 64);
});

test("mergeGrowthMemoryState accumulates samples, revalidates old rules, and merges similar rules", () => {
  const previous = {
    active: true,
    sampleCount: 2,
    positiveCount: 2,
    learningRunCount: 1,
    learnedSampleKeys: ["sample:old"],
    scoreBoostRules: [{
      pattern: "first users",
      reason: "worked before",
      weight: 6,
      status: "active",
      confidence: 75,
      positiveEvidence: 2,
      negativeEvidence: 0,
    }],
    scorePenaltyRules: [{ pattern: "generic news", reason: "no replies", weight: 4, status: "active", confidence: 67, negativeEvidence: 1 }],
  };
  const incoming = {
    generatedAt: "2026-07-16T12:00:00.000Z",
    summary: "Concrete first-user pain still performs well.",
    effectiveKeywords: ["first-user pain"],
    scoreBoostRules: [{
      pattern: "first-user",
      reason: "new positive sample",
      weight: 8,
      confidence: 70,
      positiveEvidence: 1,
      negativeEvidence: 0,
    }],
  };
  const payload = {
    sampleSummary: { total: 1, positive: 1, noReply: 0 },
    samples: [{ sampleKey: "sample:new", text: "A concrete first users problem", feedback: "got_reply", tags: ["first users"] }],
  };

  const merged = mergeGrowthMemoryState(previous, incoming, payload, new Date("2026-07-16T12:00:00.000Z"));

  assert.equal(merged.active, false);
  assert.equal(merged.sampleCount, 3);
  assert.equal(merged.positiveCount, 3);
  assert.equal(merged.learningRunCount, 2);
  assert.deepEqual(merged.learnedSampleKeys, ["sample:new", "sample:old"]);
  assert.equal(merged.scoreBoostRules.length, 1);
  assert.equal(merged.scorePenaltyRules.length, 1);
  assert.equal(merged.scoreBoostRules[0].positiveEvidence, 3);
  assert.equal(merged.lastMergeStats.merged, 1);
  assert.equal(merged.lastMergeStats.strengthened, 1);
});

test("mergeGrowthMemoryState keeps at most ten active rules", () => {
  const incomingRules = Array.from({ length: 12 }, (_, index) => ({
    pattern: `pattern ${index}`,
    reason: `evidence ${index}`,
    weight: 6,
    confidence: 90 - index,
    positiveEvidence: 1,
    negativeEvidence: 0,
  }));
  const merged = mergeGrowthMemoryState({}, { scoreBoostRules: incomingRules }, { sampleSummary: { total: 1, positive: 1 }, samples: [{ sampleKey: "sample:1", text: "unrelated", feedback: "got_reply" }] });
  const activeCount = [...merged.scoreBoostRules, ...merged.scorePenaltyRules].filter((rule) => rule.status === "active").length;

  assert.equal(activeCount, 10);
  assert.equal(merged.scoreBoostRules.filter((rule) => rule.status === "watch").length, 2);
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
  assert.ok(schema.properties.scoreBoostRules.items.required.includes("confidence"));
  assert.ok(schema.properties.scoreBoostRules.items.required.includes("positiveEvidence"));
});
