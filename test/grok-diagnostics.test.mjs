import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { classifyGrokRequestFailure, serializeErrorChain, technicalErrorText } = require("../src/lib/grok-diagnostics.js");

test("Grok diagnostics preserve the nested cause behind fetch failed", () => {
  const cause = Object.assign(new Error("getaddrinfo ENOTFOUND codeproxy.dev"), { code: "ENOTFOUND", syscall: "getaddrinfo" });
  const error = new TypeError("fetch failed", { cause });
  const result = classifyGrokRequestFailure(error, { locale: "zh-CN", timeoutMs: 60000 });

  assert.equal(result.status, "request_failed");
  assert.equal(result.outcome, "dns_failed");
  assert.match(result.message, /无法解析 codeproxy\.dev/);
  assert.match(result.technicalMessage, /fetch failed/);
  assert.match(result.technicalMessage, /ENOTFOUND/);
  assert.equal(result.errorChain.length, 2);
  assert.equal(result.errorChain[1].code, "ENOTFOUND");
});

test("Grok diagnostics explain request timeouts using the per-request timeout", () => {
  const error = Object.assign(new Error("This operation was aborted"), { name: "AbortError" });
  const result = classifyGrokRequestFailure(error, { locale: "zh-CN", timeoutMs: 60000 });

  assert.equal(result.status, "upstream_timeout");
  assert.equal(result.outcome, "timeout");
  assert.match(result.message, /60 秒/);
  assert.equal(result.retryable, true);
});

test("Grok diagnostics serialize and format low-level network error details", () => {
  const error = Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:443"), {
    code: "ECONNREFUSED",
    address: "127.0.0.1",
    port: 443,
  });

  assert.equal(serializeErrorChain(error)[0].port, 443);
  assert.match(technicalErrorText(error), /ECONNREFUSED/);
});

test("Grok diagnostics include errors nested inside an AggregateError", () => {
  const nested = Object.assign(new Error("connect ETIMEDOUT 1.2.3.4:443"), { code: "ETIMEDOUT" });
  const aggregate = new AggregateError([nested], "all connection attempts failed");
  const error = new TypeError("fetch failed", { cause: aggregate });

  assert.match(technicalErrorText(error), /ETIMEDOUT/);
  assert.equal(classifyGrokRequestFailure(error, { locale: "zh-CN" }).outcome, "timeout");
});
