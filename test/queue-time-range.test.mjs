import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { matchesQueueTimeRange, preferredVisibleQueueTimeRange } = require("../src/lib/queue-time-range.js");

function localDate(dayOffset, hour = 10) {
  const value = new Date(2026, 6, 16, hour, 0, 0, 0);
  value.setDate(value.getDate() + dayOffset);
  return value.toISOString();
}

const now = new Date(2026, 6, 16, 12, 0, 0, 0);

test("queue time range keeps Today when today has imported items", () => {
  assert.equal(preferredVisibleQueueTimeRange([localDate(0), localDate(-1)], now), "today");
});

test("queue time range falls back to the last 7 days after crossing midnight", () => {
  const yesterday = localDate(-1);
  assert.equal(matchesQueueTimeRange(yesterday, "today", now), false);
  assert.equal(matchesQueueTimeRange(yesterday, "yesterday", now), true);
  assert.equal(matchesQueueTimeRange(yesterday, "7d", now), true);
  assert.equal(preferredVisibleQueueTimeRange([yesterday], now), "7d");
});

test("queue time range uses 30 days and then All for older or undated items", () => {
  assert.equal(preferredVisibleQueueTimeRange([localDate(-10)], now), "30d");
  assert.equal(preferredVisibleQueueTimeRange([localDate(-40)], now), "all");
  assert.equal(preferredVisibleQueueTimeRange([undefined], now), "all");
  assert.equal(matchesQueueTimeRange(undefined, "all", now), true);
  assert.equal(matchesQueueTimeRange(undefined, "30d", now), false);
});
