import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);

const {
  AI_RESPONSE_CONFIG_STORAGE_KEY,
  CODEPROXY_BASE_URL,
  DEFAULT_AI_RESPONSE_MODEL,
  DEFAULT_GROK_PROXY_MODEL,
  GROK_PROXY_CONFIG_STORAGE_KEY,
  X_PROFILE_CONFIG_STORAGE_KEY,
  buildCodeProxyMessageRequest,
  buildStructuredGrokSignalPrompt,
  buildXProfilePullPrompt,
  extractXUsername,
  normalizeGrokProxyConfig,
  normalizeAiResponseConfig,
  normalizeXProfileConfig,
  normalizeXProfileUrl,
  extractCodeProxyMessageText,
} = require("../src/lib/codeproxy-grok.js");

test("normalizeGrokProxyConfig migrates old default model", () => {
  const config = normalizeGrokProxyConfig({ apiKey: "sk-test", model: "grok-4" });

  assert.equal(GROK_PROXY_CONFIG_STORAGE_KEY, "ray-growth-os:grok-proxy-config:v1");
  assert.equal(config.apiKey, "sk-test");
  assert.equal(config.model, "grok-4.3-fast");
});
test("normalizeAiResponseConfig stores GPT-5.5 codeproxy settings", () => {
  const config = normalizeAiResponseConfig({ apiKey: "sk-ai", model: "" });

  assert.equal(AI_RESPONSE_CONFIG_STORAGE_KEY, "ray-growth-os:ai-response-config:v1");
  assert.equal(DEFAULT_AI_RESPONSE_MODEL, "gpt-5.5");
  assert.equal(config.apiKey, "sk-ai");
  assert.equal(config.model, "gpt-5.5");
});

test("normalizeXProfileConfig stores a normalized public X homepage", () => {
  const config = normalizeXProfileConfig({ profileUrl: "https://twitter.com/ray_codeproxy/status/123?utm_source=test" });

  assert.equal(X_PROFILE_CONFIG_STORAGE_KEY, "ray-growth-os:x-profile-config:v1");
  assert.equal(config.profileUrl, "https://x.com/ray_codeproxy");
  assert.equal(normalizeXProfileUrl("@ray_codeproxy"), "https://x.com/ray_codeproxy");
});
test("buildCodeProxyMessageRequest creates a NewAPI messages request for codeproxy", () => {
  const request = buildCodeProxyMessageRequest({ prompt: "find X leads", model: "grok-4" });

  assert.equal(request.url, `${CODEPROXY_BASE_URL}/v1/messages`);
  assert.equal(request.headers["Content-Type"], "application/json");
  assert.equal(request.headers["anthropic-version"], "2023-06-01");
  assert.equal(request.body.model, "grok-4");
  assert.equal(request.body.max_tokens, 1800);
  assert.deepEqual(request.body.messages, [{ role: "user", content: "find X leads" }]);
});

test("DEFAULT_GROK_PROXY_MODEL uses grok-4.3-fast", () => {
  assert.equal(DEFAULT_GROK_PROXY_MODEL, "grok-4.3-fast");
});
test("buildCodeProxyMessageRequest falls back to the default grok model", () => {
  const request = buildCodeProxyMessageRequest({ prompt: "find X leads", model: "" });

  assert.equal(request.body.model, DEFAULT_GROK_PROXY_MODEL);
});

test("extractCodeProxyMessageText supports Claude and OpenAI compatible response shapes", () => {
  assert.equal(
    extractCodeProxyMessageText({ content: [{ type: "text", text: "X | maker | https://x.com/a/status/1 | asks for users" }] }),
    "X | maker | https://x.com/a/status/1 | asks for users"
  );
  assert.equal(
    extractCodeProxyMessageText({ choices: [{ message: { content: "X | maker | https://x.com/b/status/2 | asks for traffic" } }] }),
    "X | maker | https://x.com/b/status/2 | asks for traffic"
  );
});
test("buildStructuredGrokSignalPrompt asks for importable JSON only", () => {
  const prompt = buildStructuredGrokSignalPrompt("find X signals");

  assert.match(prompt, /find X signals/);
  assert.match(prompt, /Return only valid JSON/);
  assert.match(prompt, /"signals"/);
  assert.match(prompt, /"accountRadar"/);
  assert.match(prompt, /confidence/);
  assert.match(prompt, /Never fabricate URLs/);
});
test("extractXUsername accepts handles and X profile URLs", () => {
  assert.equal(extractXUsername("@ray_codeproxy/status/123"), "ray_codeproxy");
  assert.equal(extractXUsername("https://twitter.com/ray_codeproxy/status/123"), "ray_codeproxy");
  assert.equal(extractXUsername("https://example.com/ray"), "");
});

test("buildXProfilePullPrompt turns a public X account into an account radar prompt", () => {
  const prompt = buildXProfilePullPrompt({
    profileUrl: "@ray_codeproxy/status/123",
    contextPrompt: "find high-intent X signals",
    profileSnapshot: "账号: @ray_codeproxy\n简介: AI Coding 出海日记",
  });

  assert.match(prompt, /find high-intent X signals/);
  assert.match(prompt, /https:\/\/x\.com\/ray_codeproxy/);
  assert.match(prompt, /账号雷达任务/);
  assert.match(prompt, /账号雷达已读取到的公开 X 数据/);
  assert.match(prompt, /AI Coding 出海日记/);
  assert.match(prompt, /商业对比/);
  assert.match(prompt, /accountRadar/);
  assert.match(prompt, /不要读取私信/);
  assert.match(prompt, /互动队列/);
});


