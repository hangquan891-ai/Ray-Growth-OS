import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);

const {
  buildFeedbackLearningPack,
  createSignalCsvTemplate,
  createSignalImportPreview,
  formatSignalsAsLeadInput,
  mergeSignals,
  parseSignalsFromText,
  parseStructuredSignalsFromText,
  signalDedupKey,
} = require("../src/lib/signals.js");

test("parseSignalsFromText converts pipe-delimited pasted rows into structured signals", () => {
  const signals = parseSignalsFromText(
    `
X | AI indie founder | https://x.com/founder/status/1 | built with AI Coding but has 0 traffic
Reddit | SaaS builder | https://reddit.com/r/SaaS/comments/1 | looking for first users
`,
    { source: "grok", now: "2026-07-06T00:00:00.000Z" }
  );

  assert.equal(signals.length, 2);
  assert.match(signals[0].id, /^url_[a-z0-9]+$/);
  assert.deepEqual({ ...signals[0], id: "stable-url-id" }, {
    id: "stable-url-id",
    source: "grok",
    platform: "X",
    author: "AI indie founder",
    url: "https://x.com/founder/status/1",
    text: "built with AI Coding but has 0 traffic",
    importedAt: "2026-07-06T00:00:00.000Z",
    status: "new",
    tags: [],
  });
});

test("mergeSignals dedupes by normalized URL first", () => {
  const existing = parseSignalsFromText("X | maker | https://x.com/a/status/1 | old note", {
    source: "manual",
    now: "2026-07-06T00:00:00.000Z",
  });
  const incoming = parseSignalsFromText(
    `
X | maker again | https://x.com/a/status/1?utm_source=test | duplicate note
X | new maker | https://x.com/b/status/2 | new note
`,
    { source: "grok", now: "2026-07-06T01:00:00.000Z" }
  );

  const result = mergeSignals(existing, incoming);

  assert.equal(result.signals.length, 2);
  assert.equal(result.imported.length, 1);
  assert.equal(result.duplicates.length, 1);
  assert.equal(result.imported[0].author, "new maker");
  assert.equal(signalDedupKey(result.duplicates[0]), "url:https://x.com/a/status/1");
});

test("createSignalImportPreview reports parsed, importable, and duplicate counts", () => {
  const existing = parseSignalsFromText("X | maker | https://x.com/a/status/1 | old note", {
    source: "manual",
    now: "2026-07-06T00:00:00.000Z",
  });

  const preview = createSignalImportPreview(
    `
X | maker again | https://x.com/a/status/1 | duplicate note
X | new maker | https://x.com/b/status/2 | new note
`,
    existing,
    { source: "grok", now: "2026-07-06T01:00:00.000Z" }
  );

  assert.equal(preview.parsedCount, 2);
  assert.equal(preview.importableCount, 1);
  assert.equal(preview.duplicateCount, 1);
  assert.equal(preview.importable[0].url, "https://x.com/b/status/2");
});

test("formatSignalsAsLeadInput keeps compatibility with the existing scoring workflow", () => {
  const signals = parseSignalsFromText("X | maker | https://x.com/a/status/1 | asks how to get first users", {
    source: "manual",
    now: "2026-07-06T00:00:00.000Z",
  });

  assert.equal(formatSignalsAsLeadInput(signals), "X | maker | https://x.com/a/status/1 | asks how to get first users");
});

test("parseSignalsFromText maps CSV headers regardless of column order", () => {
  const signals = parseSignalsFromText(
    `url,author,platform,text,usedDraft,usedDraftAt
"https://x.com/c/status/3","CSV maker","X","asks, with comma, for first users","final reply copy","2026-07-07T10:00:00.000Z"`,
    { source: "csv", now: "2026-07-06T02:00:00.000Z" }
  );

  assert.equal(signals.length, 1);
  assert.equal(signals[0].source, "csv");
  assert.equal(signals[0].platform, "X");
  assert.equal(signals[0].author, "CSV maker");
  assert.equal(signals[0].url, "https://x.com/c/status/3");
  assert.equal(signals[0].text, "asks, with comma, for first users");
  assert.equal(signals[0].usedDraft, "final reply copy");
  assert.equal(signals[0].usedDraftAt, "2026-07-07T10:00:00.000Z");
});
test("createSignalCsvTemplate exports a parseable CSV template", () => {
  const template = createSignalCsvTemplate();
  const signals = parseSignalsFromText(template, { source: "csv", now: "2026-07-06T03:00:00.000Z" });

  assert.ok(template.startsWith("platform,author,url,text,tags\n"));
  assert.equal(signals.length, 1);
  assert.equal(signals[0].platform, "X");
  assert.equal(signals[0].author, "AI indie founder");
  assert.equal(signals[0].text, "Built with AI Coding but has 0 traffic");
  assert.deepEqual(signals[0].tags, ["AI Coding", "first users"]);
});
test("parseStructuredSignalsFromText reads Grok JSON signals with metadata", () => {
  const raw = JSON.stringify({
    accountRadar: {
      accountType: "competitor",
      competitorPosition: "Cursor alternative audience",
      ourPosition: "AI Coding growth workflow",
      audienceOverlap: "indie builders trying to get first users",
      opportunityGap: "they still ask how to turn build logs into distribution",
      recommendedAngles: ["ask what they tried", "share a 20-user loop"],
      nextStep: "import high-intent replies first",
      keywords: ["first users", "AI Coding"],
      riskNotes: "verify URL before replying",
    },
    signals: [
      {
        platform: "X",
        author: "AI founder",
        url: "https://x.com/founder/status/9?utm_source=test",
        text: "asks how to find first users after building with AI Coding",
        reason: "clear target user and urgent distribution pain",
        tags: ["AI Coding", "first users"],
        confidence: 0.91,
        actualReply: "final Grok reply",
        actualReplyAt: "2026-07-07T10:15:00.000Z",
      },
    ],
  });
  const result = parseStructuredSignalsFromText(raw, { source: "grok", now: "2026-07-07T00:00:00.000Z" });

  assert.equal(result.ok, true);
  assert.equal(result.signals.length, 1);
  assert.equal(result.signals[0].source, "grok");
  assert.equal(result.signals[0].url, "https://x.com/founder/status/9");
  assert.equal(result.signals[0].reason, "clear target user and urgent distribution pain");
  assert.equal(result.signals[0].confidence, 91);
  assert.deepEqual(result.signals[0].tags, ["AI Coding", "first users"]);
  assert.equal(result.signals[0].usedDraft, "final Grok reply");
  assert.equal(result.signals[0].usedDraftAt, "2026-07-07T10:15:00.000Z");
  assert.equal(result.accountRadar.accountType, "competitor");
  assert.equal(result.accountRadar.opportunityGap, "they still ask how to turn build logs into distribution");
  assert.deepEqual(result.accountRadar.keywords, ["first users", "AI Coding"]);
});
test("parseStructuredSignalsFromText reports invalid JSON without throwing", () => {
  const result = parseStructuredSignalsFromText("X | maker | https://x.com/a/status/1 | plain text", { source: "grok" });

  assert.equal(result.ok, false);
  assert.deepEqual(result.signals, []);
  assert.match(result.error, /JSON/i);
});
test("mergeSignals preserves execution status metadata", () => {
  const existing = [
    {
      platform: "X",
      author: "maker",
      url: "https://x.com/a/status/1",
      text: "asks for first users",
      source: "grok",
      status: "replied",
      processedAt: "2026-07-07T08:00:00.000Z",
      processedAction: "replied",
      feedback: "got_reply",
      feedbackAt: "2026-07-07T09:00:00.000Z",
      usedDraft: "actual reply that got a response",
      usedDraftAt: "2026-07-07T09:10:00.000Z",
    },
  ];

  const result = mergeSignals(existing, []);

  assert.equal(result.signals[0].status, "replied");
  assert.equal(result.signals[0].processedAt, "2026-07-07T08:00:00.000Z");
  assert.equal(result.signals[0].processedAction, "replied");
  assert.equal(result.signals[0].feedback, "got_reply");
  assert.equal(result.signals[0].feedbackAt, "2026-07-07T09:00:00.000Z");
  assert.equal(result.signals[0].usedDraft, "actual reply that got a response");
  assert.equal(result.signals[0].usedDraftAt, "2026-07-07T09:10:00.000Z");
});
test("buildFeedbackLearningPack exports AI review samples with feedback and actual replies", () => {
  const pack = buildFeedbackLearningPack(
    [
      {
        platform: "X",
        author: "maker one",
        url: "https://x.com/a/status/1",
        text: "asks how to find first users",
        source: "grok",
        status: "replied",
        processedAt: "2026-07-07T08:00:00.000Z",
        processedAction: "replied",
        feedback: "got_reply",
        feedbackAt: "2026-07-07T09:00:00.000Z",
        usedDraft: "share a concrete 20-user search loop",
        usedDraftAt: "2026-07-07T08:10:00.000Z",
        tags: ["first users"],
        reason: "urgent distribution pain",
        confidence: 91,
      },
      {
        platform: "X",
        author: "maker two",
        url: "https://x.com/b/status/2",
        text: "general launch update",
        source: "manual",
        status: "replied",
        processedAt: "2026-07-07T08:30:00.000Z",
        feedback: "no_reply",
      },
      {
        platform: "X",
        author: "maker three",
        url: "https://x.com/c/status/3",
        text: "unprocessed candidate",
        source: "manual",
        status: "new",
      },
    ],
    { mode: "growth", now: "2026-07-07T12:00:00.000Z" }
  );

  assert.match(pack, /Growth workbench/);
  const jsonText = pack.match(/```json\n([\s\S]*?)\n```/)?.[1];
  assert.ok(jsonText);
  const payload = JSON.parse(jsonText);

  assert.equal(payload.context.mode, "growth");
  assert.equal(payload.context.totalFeedbackSignals, 2);
  assert.equal(payload.context.sampleCount, 2);
  assert.equal(payload.context.positiveCount, 1);
  assert.equal(payload.context.noReplyCount, 1);
  assert.equal(payload.context.withActualReplyCount, 1);
  assert.equal(payload.samples[0].feedback, "got_reply");
  assert.equal(payload.samples[0].actualReply, "share a concrete 20-user search loop");
  assert.deepEqual(payload.samples[0].tags, ["first users"]);
});
