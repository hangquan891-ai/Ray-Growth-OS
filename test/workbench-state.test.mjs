import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);

const {
  CURRENT_VERSION,
  DEFAULT_GROK_BRIDGE_STATE,
  DEFAULT_GROWTH_MEMORY_STATE,
  normalizeWorkbenchState,
  parseStoredWorkbenchState,
  createWorkbenchBackup,
  parseWorkbenchBackup,
  serializeWorkbenchState,
} = require("../src/lib/workbench-state.js");

const fallbackForms = {
  outbound: {
    productName: "LaunchRadar",
    description: "Outbound helper",
    targetCustomer: "indie makers",
    competitors: "Apollo",
    painPoints: "first users",
    leadInput: "X | maker | https://x.com/a/status/1 | needs users",
  },
  growth: {
    productName: "Ray",
    description: "AI Coding creator",
    targetCustomer: "indie developers",
    competitors: "followers",
    painPoints: "AI Coding, growth",
    leadInput: "X | founder | https://x.com/b/status/1 | building with AI",
  },
};

test("parseStoredWorkbenchState falls back when local JSON is empty or invalid", () => {
  assert.equal(parseStoredWorkbenchState("", { mode: "growth", forms: fallbackForms }).mode, "growth");
  assert.equal(parseStoredWorkbenchState("{bad json", { mode: "growth", forms: fallbackForms }).forms.growth.productName, "Ray");
});

test("normalizeWorkbenchState merges partial stored forms with defaults", () => {
  const stored = {
    version: CURRENT_VERSION,
    mode: "outbound",
    forms: {
      growth: {
        productName: "Custom Ray",
        leadInput: "X | user | https://x.com/u/status/1 | custom import",
      },
    },
    grokBridge: {
      keywords: "AI tools, first users",
      xProfileUrl: "https://x.com/ray_codeproxy",
    },
  };

  const normalized = normalizeWorkbenchState(stored, { mode: "growth", forms: fallbackForms });

  assert.equal(normalized.mode, "outbound");
  assert.equal(normalized.forms.growth.productName, "Custom Ray");
  assert.equal(normalized.forms.growth.description, "AI Coding creator");
  assert.equal(normalized.forms.growth.leadInput, "X | user | https://x.com/u/status/1 | custom import");
  assert.equal(normalized.forms.outbound.productName, "LaunchRadar");
  assert.equal(normalized.grokBridge.keywords, "AI tools, first users");
  assert.equal(normalized.grokBridge.grokResult, DEFAULT_GROK_BRIDGE_STATE.grokResult);
  assert.equal(normalized.grokBridge.accountResult, DEFAULT_GROK_BRIDGE_STATE.accountResult);
  assert.equal(normalized.grokBridge.xProfileUrl, "https://x.com/ray_codeproxy");
});

test("serializeWorkbenchState writes a versioned restorable snapshot", () => {
  const serialized = serializeWorkbenchState({
    mode: "growth",
    forms: fallbackForms,
    grokBridge: {
      keywords: "Cursor alternative",
      grokResult: "X | builder | https://x.com/c/status/1 | asks for Cursor alternatives",
      accountResult: "X | competitor follower | https://x.com/f/status/1 | asks about first users",
      xProfileUrl: "@cursor",
    },
  });

  const parsed = JSON.parse(serialized);

  assert.equal(parsed.version, CURRENT_VERSION);
  assert.equal(parsed.mode, "growth");
  assert.equal(parsed.forms.outbound.productName, "LaunchRadar");
  assert.equal(parsed.grokBridge.keywords, "Cursor alternative");
  assert.equal(parsed.grokBridge.accountResult, "X | competitor follower | https://x.com/f/status/1 | asks about first users");
  assert.equal(parsed.grokBridge.xProfileUrl, "@cursor");
});

test("normalizeWorkbenchState keeps structured signals by mode", () => {
  const stored = {
    version: CURRENT_VERSION,
    mode: "growth",
    forms: fallbackForms,
    signals: {
      growth: [
        {
          id: "url_abc",
          source: "grok",
          platform: "X",
          author: "AI founder",
          url: "https://x.com/a/status/1",
          text: "asks for first users",
          importedAt: "2026-07-06T00:00:00.000Z",
          status: "new",
          tags: [],
          reason: "strong buying intent",
          confidence: 88,
          processedAt: "2026-07-07T08:00:00.000Z",
          processedAction: "replied",
          feedback: "followed",
          feedbackAt: "2026-07-07T09:30:00.000Z",
          usedDraft: "final reply copy",
          usedDraftAt: "2026-07-07T09:40:00.000Z",
        },
      ],
    },
  };

  const normalized = normalizeWorkbenchState(stored, { mode: "growth", forms: fallbackForms });

  assert.equal(normalized.signals.growth.length, 1);
  assert.equal(normalized.signals.growth[0].author, "AI founder");
  assert.equal(normalized.signals.growth[0].reason, "strong buying intent");
  assert.equal(normalized.signals.growth[0].confidence, 88);
  assert.equal(normalized.signals.growth[0].processedAt, "2026-07-07T08:00:00.000Z");
  assert.equal(normalized.signals.growth[0].processedAction, "replied");
  assert.equal(normalized.signals.growth[0].feedback, "followed");
  assert.equal(normalized.signals.growth[0].feedbackAt, "2026-07-07T09:30:00.000Z");
  assert.equal(normalized.signals.growth[0].usedDraft, "final reply copy");
  assert.equal(normalized.signals.growth[0].usedDraftAt, "2026-07-07T09:40:00.000Z");
  assert.deepEqual(normalized.signals.outbound, []);
});
test("normalizeWorkbenchState keeps AI score overrides by mode", () => {
  const stored = {
    version: CURRENT_VERSION,
    mode: "growth",
    forms: fallbackForms,
    aiScores: {
      growth: {
        "url:https://x.com/a/status/1": {
          itemId: "url:https://x.com/a/status/1",
          score: 92,
          label: "Engage now",
          targetFit: 88,
          painIntensity: 91,
          replyValue: 85,
          contentPotential: 80,
          timingRisk: 10,
          recommendedAction: "reply then quote",
          reason: "strong target fit",
          suggestedAngle: "explain a concrete loop",
        },
      },
    },
  };

  const normalized = normalizeWorkbenchState(stored, { mode: "growth", forms: fallbackForms });

  assert.equal(normalized.aiScores.growth["url:https://x.com/a/status/1"].score, 92);
  assert.equal(normalized.aiScores.growth["url:https://x.com/a/status/1"].label, "Engage now");
  assert.deepEqual(normalized.aiScores.outbound, {});
});
test("normalizeWorkbenchState keeps AI draft overrides by mode", () => {
  const stored = {
    version: CURRENT_VERSION,
    mode: "growth",
    forms: fallbackForms,
    aiDrafts: {
      growth: {
        "url:https://x.com/a/status/1": {
          itemId: "url:https://x.com/a/status/1",
          replyDraft: "AI reply",
          quoteDraft: "AI quote",
          postIdea: "AI post",
          rationale: "matches historical winners",
          toneNotes: "specific and low-hype",
          model: "gpt-5.5",
          generatedAt: "2026-07-07T10:30:00.000Z",
        },
      },
    },
  };

  const normalized = normalizeWorkbenchState(stored, { mode: "growth", forms: fallbackForms });

  assert.equal(normalized.aiDrafts.growth["url:https://x.com/a/status/1"].replyDraft, "AI reply");
  assert.equal(normalized.aiDrafts.growth["url:https://x.com/a/status/1"].quoteDraft, "AI quote");
  assert.equal(normalized.aiDrafts.growth["url:https://x.com/a/status/1"].model, "gpt-5.5");
  assert.deepEqual(normalized.aiDrafts.outbound, {});
});
test("createWorkbenchBackup and parseWorkbenchBackup round-trip a versioned JSON backup", () => {
  const snapshot = {
    mode: "growth",
    forms: fallbackForms,
    grokBridge: DEFAULT_GROK_BRIDGE_STATE,
    signals: {
      outbound: [],
      growth: [
        {
          id: "url_backup",
          source: "manual",
          platform: "X",
          author: "backup maker",
          url: "https://x.com/backup/status/1",
          text: "backup signal",
          importedAt: "2026-07-06T00:00:00.000Z",
          status: "new",
          tags: [],
        },
      ],
    },
  };

  const backup = createWorkbenchBackup(snapshot, "2026-07-06T02:00:00.000Z");
  const restored = parseWorkbenchBackup(backup.json, { mode: "growth", forms: fallbackForms });

  assert.equal(backup.filename, "ray-growth-os-backup-2026-07-06.json");
  assert.equal(restored.ok, true);
  assert.equal(restored.state.signals.growth[0].author, "backup maker");
});

test("parseWorkbenchBackup rejects invalid JSON instead of restoring defaults silently", () => {
  const restored = parseWorkbenchBackup("{bad json", { mode: "growth", forms: fallbackForms });

  assert.equal(restored.ok, false);
  assert.equal(restored.state, null);
});


test("normalizeWorkbenchState keeps growth memory in local state", () => {
  const stored = {
    version: CURRENT_VERSION,
    mode: "growth",
    forms: fallbackForms,
    growthMemory: {
      active: true,
      generatedAt: "2026-07-08T01:00:00.000Z",
      appliedAt: "2026-07-08T01:10:00.000Z",
      sampleCount: 4,
      positiveCount: 3,
      noReplyCount: 1,
      summary: "First-user pain works best.",
      effectiveKeywords: ["first users", "0 traffic"],
      weakKeywords: ["generic news"],
      accountRadarKeywords: ["Cursor alternative"],
      scoreBoostRules: [{ pattern: "first users", reason: "got replies", weight: 8 }],
      scorePenaltyRules: [{ pattern: "giveaway", reason: "low intent", weight: 6 }],
      replyStyleRules: ["Start with one concrete observation"],
      avoidReplyPatterns: ["Do not pitch immediately"],
      nextExperiment: "Ask one diagnostic question first.",
    },
  };

  const normalized = normalizeWorkbenchState(stored, { mode: "growth", forms: fallbackForms });
  const serialized = JSON.parse(serializeWorkbenchState(normalized));

  assert.equal(normalized.growthMemory.active, true);
  assert.equal(normalized.growthMemory.summary, "First-user pain works best.");
  assert.equal(normalized.growthMemory.scoreBoostRules[0].weight, 8);
  assert.equal(serialized.growthMemory.effectiveKeywords[0], "first users");
  assert.equal(DEFAULT_GROWTH_MEMORY_STATE.active, false);
});