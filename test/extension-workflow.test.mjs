import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const backgroundPath = new URL("../extension/ray-growth-os-x-helper/background.js", import.meta.url);
const appBridgePath = new URL("../extension/ray-growth-os-x-helper/app-bridge.js", import.meta.url);
const popupHtmlPath = new URL("../extension/ray-growth-os-x-helper/popup.html", import.meta.url);
const popupJsPath = new URL("../extension/ray-growth-os-x-helper/popup.js", import.meta.url);

async function loadBackgroundHarness(initialStorage = {}, options = {}) {
  const source = await readFile(backgroundPath, "utf8");
  const storage = structuredClone(initialStorage);
  let listener = null;

  const chrome = {
    runtime: {
      lastError: null,
      onMessage: {
        addListener(nextListener) {
          listener = nextListener;
        },
      },
    },
    storage: {
      local: {
        get(keys, callback) {
          const selected = {};
          for (const key of Array.isArray(keys) ? keys : Object.keys(keys || {})) selected[key] = storage[key];
          callback(selected);
        },
        set(value, callback) {
          Object.assign(storage, structuredClone(value));
          callback?.();
        },
        remove(keys, callback) {
          for (const key of Array.isArray(keys) ? keys : [keys]) delete storage[key];
          callback?.();
        },
      },
    },
    tabs: {
      query(query, callback) {
        callback(typeof options.queryTabs === "function" ? options.queryTabs(query) : []);
      },
      create(_options, callback) {
        callback({ id: 1 });
      },
      remove(_tabId, callback) {
        callback?.();
      },
      sendMessage(tabId, message, callback) {
        callback?.(typeof options.sendToTab === "function" ? options.sendToTab(tabId, message) : { ok: true });
      },
      onUpdated: { addListener() {}, removeListener() {} },
    },
    scripting: {
      executeScript(_options, callback) {
        callback?.();
      },
    },
  };

  vm.runInNewContext(source, { chrome, URL, Date, Promise, setTimeout, clearTimeout, console });
  assert.equal(typeof listener, "function");

  const send = (message, sender = {}) => new Promise((resolve) => listener(message, sender, resolve));
  return { send, storage };
}

async function loadAppBridgeHarness({ profileUrl = "", fetchError = new Error("database still starting") } = {}) {
  const source = await readFile(appBridgePath, "utf8");
  const messages = [];
  let clickListener = null;
  const anchor = {
    href: "https://x.com/example/status/1234567890",
    dataset: { rayUsedDraft: "Reply prepared before autosave" },
    closest() {
      return this;
    },
  };
  const localValues = {
    "ray-growth-os:x-profile-config:v1": JSON.stringify({ profileUrl }),
  };
  const window = {
    location: { origin: "http://127.0.0.1:3001" },
    localStorage: {
      getItem(key) {
        return localValues[key] || null;
      },
    },
    dispatchEvent() {},
  };
  const document = {
    addEventListener(type, listener) {
      if (type === "click") clickListener = listener;
    },
  };
  const chrome = {
    runtime: {
      lastError: null,
      sendMessage(message, callback) {
        messages.push(structuredClone(message));
        callback?.({ ok: true });
      },
      onMessage: { addListener() {} },
    },
  };
  const fetch = async () => {
    throw fetchError;
  };

  vm.runInNewContext(source, { window, document, chrome, fetch, URL, Date, Promise, Error, CustomEvent: class {}, console });
  assert.equal(typeof clickListener, "function");
  clickListener({ target: anchor });
  await new Promise((resolve) => setTimeout(resolve, 0));
  return { messages };
}

test("opening a source from the App automatically tracks the item and syncs the X username", async () => {
  const { send, storage } = await loadBackgroundHarness();
  const item = {
    itemId: "signal-1",
    sourceUrl: "https://x.com/example/status/1234567890",
    usedDraft: "First draft",
  };

  const first = await send({
    type: "RAY_APP_SOURCE_OPENED",
    item,
    url: item.sourceUrl,
    selfUsername: "@Ray_Codeproxy",
  });

  assert.equal(first.ok, true);
  assert.equal(storage.rayQueue.length, 1);
  assert.equal(storage.rayQueue[0].itemId, "signal-1");
  assert.equal(storage.raySelfUsername, "ray_codeproxy");

  await send({
    type: "RAY_APP_SOURCE_OPENED",
    item: { ...item, usedDraft: "Updated draft" },
    url: item.sourceUrl,
    selfUsername: "ray_codeproxy",
  });

  assert.equal(storage.rayQueue.length, 1);
  assert.equal(storage.rayQueue[0].usedDraft, "Updated draft");

  const scan = await send({
    type: "RAY_X_SCAN_RESULT",
    scan: {
      trigger: "reply-click",
      url: item.sourceUrl,
      current: { username: "example", url: item.sourceUrl, text: "Source post", metrics: {} },
      articles: [
        { username: "example", url: item.sourceUrl, text: "Source post", metrics: {} },
        { username: "ray_codeproxy", url: "https://x.com/ray_codeproxy/status/9876543210", text: "Updated draft", metrics: {} },
      ],
    },
  }, { tab: { id: 9 } });

  assert.equal(scan.ok, true);
  assert.equal(scan.captured, 1);
  assert.equal(storage.rayQueue[0].replyUrl, "https://x.com/ray_codeproxy/status/9876543210");
  assert.equal(storage.rayUpdates["signal-1"].replyUrl, "https://x.com/ray_codeproxy/status/9876543210");
});

test("opening the popup discovers the username from an already open App tab", async () => {
  const { send, storage } = await loadBackgroundHarness({}, {
    queryTabs(query) {
      return Array.isArray(query.url) && query.url.some((url) => url.includes("127.0.0.1"))
        ? [{ id: 31, url: "http://127.0.0.1:3001" }]
        : [];
    },
    sendToTab(tabId, message) {
      assert.equal(tabId, 31);
      assert.equal(message.type, "RAY_READ_SELF_USERNAME");
      return { ok: true, selfUsername: "@Ray_Codeproxy" };
    },
  });

  const state = await send({ type: "POPUP_GET_STATE" });

  assert.equal(state.ok, true);
  assert.equal(state.selfUsername, "ray_codeproxy");
  assert.equal(storage.raySelfUsername, "ray_codeproxy");
});

test("opening the popup falls back to the logged-in X profile username", async () => {
  const { send, storage } = await loadBackgroundHarness({}, {
    queryTabs(query) {
      return Array.isArray(query.url) && query.url.some((url) => url === "https://x.com/*")
        ? [{ id: 42, url: "https://x.com/home" }]
        : [];
    },
    sendToTab(tabId, message) {
      assert.equal(tabId, 42);
      assert.equal(message.type, "RAY_READ_SELF_USERNAME");
      return { ok: true, selfUsername: "Ray_Codeproxy" };
    },
  });

  const state = await send({ type: "POPUP_GET_STATE" });

  assert.equal(state.selfUsername, "ray_codeproxy");
  assert.equal(storage.raySelfUsername, "ray_codeproxy");
});

test("the App bridge forwards the configured username with the automatically associated item", async () => {
  const source = await readFile(appBridgePath, "utf8");
  assert.match(source, /const \{ queue, selfUsername \} = await readQueue\(\)/);
  assert.match(source, /type: "RAY_APP_SOURCE_OPENED"[\s\S]*selfUsername/);
});

test("the App click tracks a minimal source before SQLite is available", async () => {
  const { messages } = await loadAppBridgeHarness({ profileUrl: "https://x.com/Ray_Codeproxy" });
  const tracked = messages.find((message) => message.type === "RAY_APP_SOURCE_OPENED");

  assert.ok(tracked);
  assert.equal(tracked.url, "https://x.com/example/status/1234567890");
  assert.equal(tracked.item.sourceUrl, tracked.url);
  assert.equal(tracked.item.usedDraft, "Reply prepared before autosave");
  assert.equal(tracked.selfUsername, "ray_codeproxy");
});

test("manual recovery rebuilds a missed App association and captures the reply", async () => {
  const { send, storage } = await loadBackgroundHarness();
  const sourceUrl = "https://x.com/example/status/1234567890";
  const replyUrl = "https://x.com/ray_codeproxy/status/9876543210";

  const result = await send({
    type: "RAY_X_SCAN_RESULT",
    scan: {
      trigger: "manual",
      url: sourceUrl,
      selfUsername: "ray_codeproxy",
      current: { username: "example", url: sourceUrl, text: "Source post", metrics: {} },
      articles: [
        { username: "example", url: sourceUrl, text: "Source post", metrics: {} },
        { username: "ray_codeproxy", url: replyUrl, text: "My public reply", metrics: {} },
      ],
    },
  }, { tab: { id: 12 } });

  assert.equal(result.ok, true);
  assert.equal(result.sourceMatched, true);
  assert.equal(result.captured, 1);
  assert.equal(storage.raySelfUsername, "ray_codeproxy");
  assert.equal(storage.rayQueue.length, 1);
  assert.equal(storage.rayQueue[0].sourceUrl, sourceUrl);
  assert.equal(storage.rayQueue[0].replyUrl, replyUrl);
});

test("the popup no longer exposes manual queue reading as a normal workflow step", async () => {
  const [html, script] = await Promise.all([
    readFile(popupHtmlPath, "utf8"),
    readFile(popupJsPath, "utf8"),
  ]);

  assert.doesNotMatch(html, /id="syncApp"|从 App 读取队列/);
  assert.doesNotMatch(script, /POPUP_SYNC_APP|syncApp/);
  assert.match(html, /无需手动读取队列/);
  assert.match(html, /弹窗无需保持打开/);
  assert.match(html, /自动监听已开启/);
});
