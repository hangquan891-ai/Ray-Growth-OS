const APP_URLS = [
  "http://localhost:3000/*",
  "http://localhost:3001/*",
  "http://127.0.0.1:3000/*",
  "http://127.0.0.1:3001/*",
];

const X_URLS = [
  "https://x.com/*",
  "https://twitter.com/*",
];

const REPLY_SCAN_BATCH_SIZE = 20;
const REPLY_SCAN_PAGE_SIZE = 50;

function clean(value) {
  return String(value || "").trim();
}

function normalizeUsername(value) {
  return clean(value).replace(/^@+/, "").toLowerCase();
}

function normalizeUrl(value) {
  const raw = clean(value);
  if (!raw) return "";
  try {
    const url = new URL(raw);
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_|ref$|s$|t$|mx$)/i.test(key)) url.searchParams.delete(key);
    }
    const query = url.searchParams.toString();
    return `${url.origin.toLowerCase()}${url.pathname.replace(/\/$/, "")}${query ? `?${query}` : ""}`;
  } catch {
    return raw;
  }
}

function statusKeyFromUrl(value) {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    if (host !== "x.com" && host !== "twitter.com") return "";
    const parts = url.pathname.split("/").filter(Boolean);
    const statusIndex = parts.findIndex((part) => part === "status" || part === "statuses");
    if (statusIndex <= 0) return "";
    const username = normalizeUsername(parts[0]);
    const statusId = parts[statusIndex + 1] || "";
    return /^\d+$/.test(statusId) ? `${username}/${statusId}` : "";
  } catch {
    return "";
  }
}

function sameStatusUrl(left, right) {
  const leftKey = statusKeyFromUrl(left);
  const rightKey = statusKeyFromUrl(right);
  if (leftKey && rightKey) return leftKey === rightKey;
  return Boolean(normalizeUrl(left) && normalizeUrl(left) === normalizeUrl(right));
}

function normalizeText(value) {
  return clean(value).replace(/\s+/g, " ").toLowerCase();
}

function storageGet(keys) {
  return new Promise((resolve) => chrome.storage.local.get(keys, resolve));
}

function storageSet(value) {
  return new Promise((resolve) => chrome.storage.local.set(value, resolve));
}

function storageRemove(keys) {
  return new Promise((resolve) => chrome.storage.local.remove(keys, resolve));
}

function queryTabs(query) {
  return new Promise((resolve) => chrome.tabs.query(query, resolve));
}

function createTab(options) {
  return new Promise((resolve, reject) => {
    chrome.tabs.create(options, (tab) => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message));
      else resolve(tab);
    });
  });
}

function removeTab(tabId) {
  return new Promise((resolve) => {
    if (!tabId) return resolve(false);
    chrome.tabs.remove(tabId, () => resolve(true));
  });
}

function waitForTabComplete(tabId, timeoutMs = 12000) {
  return new Promise((resolve) => {
    let done = false;
    const cleanup = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(listener);
      resolve(true);
    };
    const listener = (updatedTabId, changeInfo) => {
      if (updatedTabId === tabId && changeInfo.status === "complete") cleanup();
    };
    const timer = setTimeout(cleanup, timeoutMs);
    chrome.tabs.onUpdated.addListener(listener);
  });
}

function sendToTab(tabId, message) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, message, (response) => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message));
      else resolve(response);
    });
  });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isMissingReceiverError(error) {
  return /receiving end does not exist|could not establish connection/i.test(error?.message || "");
}

function friendlyError(error) {
  const message = error instanceof Error ? error.message : String(error || "");
  if (isMissingReceiverError({ message })) {
    return "插件暂时没连上页面脚本。我已尝试自动注入；如果仍失败，请刷新 App 或 X 页面后再试。";
  }
  return message || "操作失败。";
}

function executeScript(tabId, file) {
  return new Promise((resolve, reject) => {
    chrome.scripting.executeScript({ target: { tabId }, files: [file] }, () => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message));
      else resolve(true);
    });
  });
}

async function sendToTabWithInjection(tab, message, file) {
  try {
    return await sendToTab(tab.id, message);
  } catch (error) {
    if (!isMissingReceiverError(error)) throw error;
    await executeScript(tab.id, file);
    await delay(150);
    return await sendToTab(tab.id, message);
  }
}

function isValidXUsername(username) {
  return /^[a-z0-9_]{1,15}$/.test(normalizeUsername(username));
}

async function findAppTab() {
  const tabs = await queryTabs({ url: APP_URLS });
  return tabs.find((tab) => tab.id) || null;
}

async function discoverSelfUsernameFromOpenPages() {
  const sources = [
    { urls: APP_URLS, message: { type: "RAY_READ_SELF_USERNAME" }, bridge: "app-bridge.js" },
    { urls: X_URLS, message: { type: "RAY_READ_SELF_USERNAME" }, bridge: "x-bridge.js" },
  ];

  for (const source of sources) {
    const tabs = await queryTabs({ url: source.urls });
    for (const tab of tabs) {
      if (!tab?.id) continue;
      try {
        const response = await sendToTabWithInjection(tab, source.message, source.bridge);
        const username = normalizeUsername(response?.selfUsername);
        if (!isValidXUsername(username)) continue;
        await storageSet({ raySelfUsername: username });
        return username;
      } catch {
        // Try the next open App/X tab. Manual input remains the final fallback.
      }
    }
  }

  return "";
}

function signalKey(item) {
  return clean(item.itemId) || normalizeUrl(item.url || item.sourceUrl) || `${clean(item.mode)}:${clean(item.author)}:${normalizeText(item.text).slice(0, 80)}`;
}

function findQueueItemBySource(queue, url) {
  return queue.find((item) => sameStatusUrl(item.sourceUrl || item.url, url)) || null;
}

function findQueueItemByKey(queue, itemId) {
  return queue.find((item) => signalKey(item) === itemId) || null;
}

function classifyMetrics(metrics = {}) {
  const replies = Number(metrics.replies || 0);
  const reposts = Number(metrics.reposts || 0);
  const quotes = Number(metrics.quotes || 0);
  if (replies > 0) return { feedback: "got_reply", reason: `你的回复下面检测到 ${replies} 条公开回复。` };
  if (reposts + quotes > 0) return { feedback: "reshared", reason: `你的回复被引用/转发 ${reposts + quotes} 次。` };
  return { feedback: "no_reply", reason: "这条回复暂时没有检测到后续公开回复。" };
}

function chooseOwnReply(articles, item) {
  const sourceUrl = item.sourceUrl || item.url;
  const usedDraft = normalizeText(item.usedDraft || "");
  const candidates = articles.filter((article) => normalizeUrl(article.url) && !sameStatusUrl(article.url, sourceUrl));
  if (usedDraft.length >= 16) {
    const snippet = usedDraft.slice(0, Math.min(56, usedDraft.length));
    const matched = candidates.find((article) => normalizeText(article.text).includes(snippet));
    if (matched) return matched;
  }
  return candidates[candidates.length - 1] || null;
}

function buildUpdate(item, article, source, options = {}) {
  const classified = classifyMetrics(article.metrics);
  const now = new Date().toISOString();
  const captureOnly = Boolean(options.captureOnly);
  return {
    itemId: signalKey(item),
    mode: item.mode,
    sourceUrl: item.sourceUrl || item.url,
    replyUrl: article.url,
    replyUrlAt: item.replyUrlAt || now,
    feedback: captureOnly ? "none" : classified.feedback,
    feedbackAt: captureOnly ? "" : now,
    feedbackReason: captureOnly ? "已保存公开回复链接，等待后续巡检反馈。" : classified.reason,
    metrics: article.metrics || {},
    source,
  };
}

async function saveUpdate(update) {
  const stored = await storageGet(["rayUpdates", "rayQueue"]);
  const updates = stored.rayUpdates || {};
  updates[update.itemId] = { ...(updates[update.itemId] || {}), ...update };
  const queue = Array.isArray(stored.rayQueue) ? stored.rayQueue : [];
  const nextQueue = queue.map((item) => {
    if (signalKey(item) !== update.itemId && !sameStatusUrl(item.sourceUrl || item.url, update.sourceUrl)) return item;
    const next = {
      ...item,
      replyUrl: update.replyUrl || item.replyUrl || "",
      replyUrlAt: update.replyUrlAt || item.replyUrlAt || "",
    };
    if (update.replyUrl) {
      next.status = "replied";
      next.processedAction = "replied";
      next.processedAt = update.replyUrlAt || item.processedAt || new Date().toISOString();
    }
    if (update.feedback && update.feedback !== "none") {
      next.feedback = update.feedback;
      next.feedbackAt = update.feedbackAt || item.feedbackAt || new Date().toISOString();
    }
    return next;
  });
  await storageSet({ rayUpdates: updates, rayQueue: nextQueue });
  return update;
}

async function rememberSourceFromApp(item, url, selfUsername = "") {
  const sourceUrl = normalizeUrl(url || item?.sourceUrl || item?.url);
  if (!sourceUrl || !statusKeyFromUrl(sourceUrl)) {
    return { ok: false, message: "这个链接不是有效的 X 原帖链接。" };
  }

  const preparedItem = {
    ...(item || {}),
    itemId: signalKey(item || { url: sourceUrl }),
    sourceUrl,
    url: sourceUrl,
  };
  const stored = await storageGet(["rayQueue"]);
  const queue = Array.isArray(stored.rayQueue) ? stored.rayQueue : [];
  const itemId = signalKey(preparedItem);
  const exists = queue.some((candidate) => signalKey(candidate) === itemId || sameStatusUrl(candidate.sourceUrl || candidate.url, sourceUrl));
  const nextQueue = exists
    ? queue.map((candidate) => (signalKey(candidate) === itemId || sameStatusUrl(candidate.sourceUrl || candidate.url, sourceUrl) ? { ...candidate, ...preparedItem } : candidate))
    : [preparedItem, ...queue];

  const syncedUsername = normalizeUsername(selfUsername);
  const nextStorage = {
    rayQueue: nextQueue,
    rayRecentSource: { itemId, sourceUrl, savedAt: new Date().toISOString() },
  };
  if (isValidXUsername(syncedUsername)) nextStorage.raySelfUsername = syncedUsername;
  await storageSet(nextStorage);

  return { ok: true, message: "已记住这条原帖。你在 X 点回复发布后，插件会自动扫描并回写。" };
}

function shouldCaptureFreshReply(scan) {
  return ["reply-click", "manual", "auto"].includes(clean(scan?.trigger));
}

async function processScan(scan, tabId) {
  const stored = await storageGet(["rayQueue", "rayPendingByTab", "raySelfUsername", "rayRecentSource"]);
  let queue = Array.isArray(stored.rayQueue) ? stored.rayQueue : [];
  const detectedUsername = normalizeUsername(scan?.selfUsername);
  const selfUsername = normalizeUsername(stored.raySelfUsername) || (isValidXUsername(detectedUsername) ? detectedUsername : "");
  const pendingByTab = stored.rayPendingByTab || {};
  const currentUrl = normalizeUrl(scan?.current?.url || scan?.url);

  if (!selfUsername) return { ok: false, message: "请先保存你的 X 用户名，例如 Ray_Codeproxy，不是展示名。" };
  if (!normalizeUsername(stored.raySelfUsername) && selfUsername) {
    await storageSet({ raySelfUsername: selfUsername });
  }

  let sourceMatch = findQueueItemBySource(queue, currentUrl);
  const recentSource = stored.rayRecentSource || null;
  if (!sourceMatch && recentSource?.sourceUrl && sameStatusUrl(recentSource.sourceUrl, currentUrl)) {
    sourceMatch = findQueueItemByKey(queue, recentSource.itemId) || findQueueItemBySource(queue, recentSource.sourceUrl);
  }

  // Manual recovery is an explicit user action on the source conversation.
  // If the App click message was missed, rebuild a minimal association from
  // the current status URL so reply capture can still write back by sourceUrl.
  if (!sourceMatch && clean(scan?.trigger) === "manual" && statusKeyFromUrl(currentUrl)) {
    const recoveredItem = {
      itemId: currentUrl,
      mode: "growth",
      sourceUrl: currentUrl,
      url: currentUrl,
      status: "new",
      feedback: "none",
      usedDraft: "",
      recoveredAt: new Date().toISOString(),
    };
    queue = [recoveredItem, ...queue.filter((item) => !sameStatusUrl(item.sourceUrl || item.url, currentUrl))];
    sourceMatch = recoveredItem;
    await storageSet({
      rayQueue: queue,
      rayRecentSource: { itemId: recoveredItem.itemId, sourceUrl: currentUrl, savedAt: recoveredItem.recoveredAt },
    });
  }

  if (!queue.length) return { ok: false, message: "当前原帖还没有和 App 队列关联。请从 App 点击“复制回复并打开原帖”进入 X。" };

  if (sourceMatch && tabId) {
    pendingByTab[String(tabId)] = {
      itemId: signalKey(sourceMatch),
      sourceUrl: sourceMatch.sourceUrl || sourceMatch.url,
      savedAt: new Date().toISOString(),
    };
    await storageSet({ rayPendingByTab: pendingByTab });
  }

  const articles = Array.isArray(scan?.articles) ? scan.articles : [];
  const ownArticles = articles.filter((article) => normalizeUsername(article.username) === selfUsername && normalizeUrl(article.url));
  const updates = [];

  const pending = tabId ? pendingByTab[String(tabId)] : null;
  const pendingItem = pending ? findQueueItemByKey(queue, pending.itemId) : null;
  if (pendingItem && !normalizeUrl(pendingItem.replyUrl) && shouldCaptureFreshReply(scan)) {
    const ownReply = chooseOwnReply(ownArticles, pendingItem);
    if (ownReply) updates.push(await saveUpdate(buildUpdate(pendingItem, ownReply, "x-reply-after-post", { captureOnly: true })));
  }

  for (const item of queue) {
    const replyUrl = normalizeUrl(item.replyUrl);
    if (!replyUrl) continue;
    const article = ownArticles.find((candidate) => sameStatusUrl(candidate.url, replyUrl)) || (sameStatusUrl(currentUrl, replyUrl) ? scan.current : null);
    if (article) updates.push(await saveUpdate(buildUpdate(item, article, "x-saved-reply-scan")));
  }

  const autoApply = updates.length ? await tryAutoApplyUpdatesToApp() : null;
  const appliedCount = autoApply?.ok ? Number(autoApply.appliedCount || updates.length) : 0;
  const message = appliedCount > 0
    ? `已识别并自动回写 ${appliedCount} 条反馈到 App。`
    : updates.length
      ? `已识别 ${updates.length} 条回复/反馈，但 App 页面暂时没连上，已先暂存。`
      : sourceMatch
        ? `已关联当前原帖，但还没有识别到 @${selfUsername} 的公开回复。回复发布并显示在当前对话页后，可点“找回当前页回复并回写”。`
        : "当前 X 页面没有匹配到队列条目。";

  return {
    ok: true,
    sourceMatched: Boolean(sourceMatch),
    captured: updates.length,
    appliedCount,
    message,
  };
}

async function scanCurrentXTab() {
  const [tab] = await queryTabs({ active: true, currentWindow: true });
  if (!tab?.id || !/^https:\/\/(x|twitter)\.com\//i.test(tab.url || "")) throw new Error("请先切到 X 页面再扫描。");
  const scan = await sendToTabWithInjection(tab, { type: "RAY_SCAN_X_NOW" }, "x-bridge.js");
  if (!scan?.ok) throw new Error(scan?.message || "扫描当前 X 页面失败。请等待页面加载完再试。");
  return processScan(scan, tab.id);
}

async function setReplyScanProgress(progress) {
  await storageSet({ rayReplyScanProgress: { updatedAt: new Date().toISOString(), ...progress } });
}

async function refreshSavedReplies() {
  const stored = await storageGet(["rayQueue", "rayReplyScanProgress"]);
  if (stored.rayReplyScanProgress?.active) {
    return { ok: false, message: "巡检正在进行中，请看下方进度。" };
  }

  const queue = Array.isArray(stored.rayQueue) ? stored.rayQueue : [];
  const targets = [];
  let repliedWithoutReplyUrl = 0;
  const seen = new Set();
  for (const item of queue) {
    const replyUrl = normalizeUrl(item.replyUrl);
    const status = clean(item.status || item.processedAction);
    if (!replyUrl) {
      if (status === "replied" || status === "quoted") repliedWithoutReplyUrl += 1;
      continue;
    }
    const key = statusKeyFromUrl(replyUrl) || replyUrl;
    if (seen.has(key)) continue;
    seen.add(key);
    targets.push({ ...item, replyUrl });
  }

  if (!targets.length) {
    const statusHint = repliedWithoutReplyUrl ? "检测到 " + repliedWithoutReplyUrl + " 条已标记已回复，但没有保存回复链接；巡检无法知道哪条是你的回复。" : "";
    return { ok: false, message: statusHint + "当前页还没有可巡检的回复链接。先从 App 打开原帖，到 X 发一条回复，插件会自动记录你的回复链接。" };
  }

  const pageTargets = targets.slice(0, REPLY_SCAN_PAGE_SIZE);
  let scannedCount = 0;
  let appliedCount = 0;

  await setReplyScanProgress({
    active: true,
    total: pageTargets.length,
    scanned: 0,
    applied: 0,
    batchSize: REPLY_SCAN_BATCH_SIZE,
    pageSize: REPLY_SCAN_PAGE_SIZE,
    targetTotal: targets.length,
    message: `准备巡检当前页 ${pageTargets.length} 条已保存回复链接。`,
  });

  try {
    for (let index = 0; index < pageTargets.length; index += 1) {
      const item = pageTargets[index];
      await setReplyScanProgress({
        active: true,
        total: pageTargets.length,
        scanned: scannedCount,
        applied: appliedCount,
        batchSize: REPLY_SCAN_BATCH_SIZE,
        pageSize: REPLY_SCAN_PAGE_SIZE,
        targetTotal: targets.length,
        current: index + 1,
        message: `正在巡检当前页第 ${index + 1}/${pageTargets.length} 条：${clean(item.author) || clean(item.name) || "已保存回复"}`,
      });

      let tab = null;
      try {
        tab = await createTab({ url: item.replyUrl, active: false });
        await waitForTabComplete(tab.id);
        await delay(1800);
        const scan = await sendToTabWithInjection(tab, { type: "RAY_SCAN_X_NOW" }, "x-bridge.js");
        if (scan?.ok) {
          const result = await processScan(scan, tab.id);
          scannedCount += 1;
          appliedCount += Number(result.appliedCount || 0);
        }
      } finally {
        if (tab?.id) await removeTab(tab.id);
      }

      await setReplyScanProgress({
        active: true,
        total: pageTargets.length,
        scanned: scannedCount,
        applied: appliedCount,
        batchSize: REPLY_SCAN_BATCH_SIZE,
        pageSize: REPLY_SCAN_PAGE_SIZE,
        targetTotal: targets.length,
        current: index + 1,
        message: `已完成 ${scannedCount}/${pageTargets.length} 条，已回写 ${appliedCount} 条。`,
      });

      if ((index + 1) % REPLY_SCAN_BATCH_SIZE === 0 && index + 1 < pageTargets.length) {
        await delay(1200);
      }
    }

    const overflowLabel = targets.length > REPLY_SCAN_PAGE_SIZE ? ` 当前页可巡检项超过 ${REPLY_SCAN_PAGE_SIZE} 条，本次已按上限处理前 ${REPLY_SCAN_PAGE_SIZE} 条。` : "";
    const message = `当前页回复链接巡检完成：已检查 ${scannedCount} 条，自动回写 ${appliedCount} 条反馈。${overflowLabel}`;

    await setReplyScanProgress({
      active: false,
      total: pageTargets.length,
      scanned: scannedCount,
      applied: appliedCount,
      batchSize: REPLY_SCAN_BATCH_SIZE,
      pageSize: REPLY_SCAN_PAGE_SIZE,
      targetTotal: targets.length,
      message,
    });

    return { ok: true, scannedCount, appliedCount, message };
  } catch (error) {
    const message = friendlyError(error);
    await setReplyScanProgress({
      active: false,
      error: true,
      total: pageTargets.length,
      scanned: scannedCount,
      applied: appliedCount,
      batchSize: REPLY_SCAN_BATCH_SIZE,
      pageSize: REPLY_SCAN_PAGE_SIZE,
      targetTotal: targets.length,
      message,
    });
    throw error;
  }
}
async function applyUpdatesToApp(options = {}) {
  const tab = await findAppTab();
  if (!tab?.id) throw new Error("App 页面没有打开，反馈已先暂存。打开 Ray Growth OS 后可以手动回写。");
  const stored = await storageGet(["rayUpdates"]);
  const updates = Object.values(stored.rayUpdates || {});
  if (!updates.length) return { ok: true, appliedCount: 0, message: "没有可回写的反馈。" };
  const response = await sendToTabWithInjection(tab, { type: "RAY_APPLY_FEEDBACK_UPDATES", updates }, "app-bridge.js");
  if (!response?.ok) throw new Error(response?.message || "回写 App 失败。请刷新 App 页面后重试。");
  if (Number(response.appliedCount || 0) === 0) {
    throw new Error("App 没有匹配到待回写的队列条目，反馈仍保留在插件中。请确认该条目仍在 App 队列中，再从 App 打开一次原帖后重试。");
  }
  await storageRemove("rayUpdates");
  return {
    ...response,
    message: options.silent ? `已自动回写 ${response.appliedCount || updates.length} 条反馈到 App。` : response.message || `已回写 ${response.appliedCount || updates.length} 条反馈到 App。`,
  };
}

async function tryAutoApplyUpdatesToApp() {
  try {
    return await applyUpdatesToApp({ silent: true });
  } catch (error) {
    return { ok: false, appliedCount: 0, message: friendlyError(error) };
  }
}

async function getState() {
  const stored = await storageGet(["rayQueue", "rayUpdates", "rayPendingByTab", "raySelfUsername", "rayReplyScanProgress"]);
  const storedUsername = normalizeUsername(stored.raySelfUsername);
  const selfUsername = isValidXUsername(storedUsername) ? storedUsername : await discoverSelfUsernameFromOpenPages();
  return {
    ok: true,
    queueCount: Array.isArray(stored.rayQueue) ? stored.rayQueue.length : 0,
    updateCount: Object.keys(stored.rayUpdates || {}).length,
    pendingCount: Object.keys(stored.rayPendingByTab || {}).length,
    selfUsername,
    replyScanProgress: stored.rayReplyScanProgress || null,
  };
}

async function injectBridgeIntoOpenTabs(urls, file) {
  const tabs = await queryTabs({ url: urls });
  await Promise.all(tabs.filter((tab) => tab?.id).map(async (tab) => {
    try {
      await executeScript(tab.id, file);
    } catch {
      // A tab can disappear or navigate while the extension is installing.
    }
  }));
}

async function injectBridgesIntoExistingPages() {
  await Promise.all([
    injectBridgeIntoOpenTabs(APP_URLS, "app-bridge.js"),
    injectBridgeIntoOpenTabs(["https://x.com/*", "https://twitter.com/*"], "x-bridge.js"),
  ]);
}

chrome.runtime.onInstalled?.addListener(() => {
  void injectBridgesIntoExistingPages();
});

chrome.runtime.onStartup?.addListener(() => {
  void injectBridgesIntoExistingPages();
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    try {
      if (message?.type === "POPUP_GET_STATE") return await getState();
      if (message?.type === "POPUP_SET_SELF_USERNAME") {
        const username = normalizeUsername(message.username);
        if (!isValidXUsername(username)) {
          return { ok: false, message: "这里要填 X 用户名，不是展示名。例如 Ray_Codeproxy，不要填 Ray | AI Coding 出海日记。" };
        }
        await storageSet({ raySelfUsername: username });
        return { ...(await getState()), message: `已保存 X 用户名：@${username}` };
      }
      if (message?.type === "POPUP_SCAN_X") return await scanCurrentXTab();
      if (message?.type === "POPUP_REFRESH_REPLIES") return await refreshSavedReplies();
      if (message?.type === "POPUP_APPLY_APP") return await applyUpdatesToApp();
      if (message?.type === "RAY_APP_SOURCE_OPENED") return await rememberSourceFromApp(message.item, message.url, message.selfUsername);
      if (message?.type === "RAY_X_SCAN_RESULT") return await processScan(message.scan, sender.tab?.id || 0);
      return { ok: false, message: "未知操作。" };
    } catch (error) {
      return { ok: false, message: friendlyError(error) };
    }
  })().then(sendResponse);
  return true;
});
