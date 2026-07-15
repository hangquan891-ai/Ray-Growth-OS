import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);

const {
  PROFILE_MAX_RETRIES,
  isRetryableHttpStatus,
  isRetryableProfileFailure,
  profileRetryDelayMs,
} = require("../src/lib/profile-retry.js");

test("profile retry policy retries transient failures only", () => {
  assert.equal(PROFILE_MAX_RETRIES, 5);
  assert.equal(isRetryableProfileFailure({ status: "empty_output" }), true);
  assert.equal(isRetryableProfileFailure({ status: "timeout" }), true);
  assert.equal(isRetryableProfileFailure({ httpStatus: 429 }), true);
  assert.equal(isRetryableProfileFailure({ httpStatus: 503 }), true);
  assert.equal(isRetryableProfileFailure({ httpStatus: 401 }), false);
  assert.equal(isRetryableProfileFailure({ status: "missing_key" }), false);
  assert.equal(isRetryableProfileFailure({ retryable: false, httpStatus: 503 }), false);
});

test("profile retry delay is per attempt and capped", () => {
  assert.equal(isRetryableHttpStatus(408), true);
  assert.equal(profileRetryDelayMs(1), 750);
  assert.equal(profileRetryDelayMs(2), 1500);
  assert.equal(profileRetryDelayMs(5), 4000);
  assert.equal(profileRetryDelayMs(10), 4000);
});
