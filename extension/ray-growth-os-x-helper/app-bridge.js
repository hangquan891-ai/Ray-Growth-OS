(() => {
  if (window.__RAY_GROWTH_OS_APP_BRIDGE__) return;
  window.__RAY_GROWTH_OS_APP_BRIDGE__ = true;

  const X_PROFILE_CONFIG_STORAGE_KEY = "ray-growth-os:x-profile-config:v1";
  const QUEUE_PAGE_STORAGE_KEY = "ray-growth-os:queue-page:v1";

  function clean(value) {
    return String(value || "").trim();
  }

  function normalizeUsername(value) {
    return clean(value).replace(/^@+/, "").toLowerCase();
  }

  function usernameFromProfileUrl(value) {
    const raw = clean(value);
    if (!raw) return "";
    try {
      const input = /^https?:\/\//i.test(raw) ? raw : `https://x.com/${raw.replace(/^@+/, "")}`;
      const url = new URL(input);
      const host = url.hostname.toLowerCase().replace(/^www\./, "");
      if (host !== "x.com" && host !== "twitter.com") return "";
      const [username] = url.pathname.split("/").filter(Boolean);
      return normalizeUsername(username);
    } catch {
      return normalizeUsername(raw);
    }
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

  function isXStatusUrl(value) {
    return Boolean(statusKeyFromUrl(normalizeUrl(value)));
  }

  function readJson(key, fallback) {
    try {
      const raw = window.localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  }

  async function readLocalStateRecord(scope) {
    const response = await fetch(`${window.location.origin}/api/local-state/${scope}`, { cache: "no-store" });
    const body = await response.json().catch(() => null);
    if (!response.ok || !body?.ok) throw new Error(body?.message || "Local database request failed.");
    return {
      exists: Boolean(body.exists),
      updatedAt: typeof body.updatedAt === "string" ? body.updatedAt : null,
      value: body.exists && body.value && typeof body.value === "object" ? body.value : {},
    };
  }

  async function readLocalState(scope) {
    return (await readLocalStateRecord(scope)).value;
  }

  async function writeLocalState(scope, value, expectedUpdatedAt) {
    const response = await fetch(`${window.location.origin}/api/local-state/${scope}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value, expectedUpdatedAt }),
    });
    const body = await response.json().catch(() => null);
    if (!response.ok || !body?.ok) {
      const error = new Error(body?.message || "Local database request failed.");
      error.code = body?.code || "LOCAL_STATE_WRITE_FAILED";
      throw error;
    }
    return body;
  }

  function signalKey(signal) {
    return clean(signal.id) || normalizeUrl(signal.url) || `${clean(signal.platform)}:${clean(signal.author)}:${clean(signal.text).slice(0, 80)}`;
  }

  function filterQueueByCurrentPage(queue, pageState) {
    const page = pageState && typeof pageState === "object" ? pageState : {};
    const itemKeys = new Set(Array.isArray(page.itemKeys) ? page.itemKeys.map(clean).filter(Boolean) : []);
    const urls = Array.isArray(page.urls) ? page.urls.map(clean).filter(Boolean) : [];
    if (!itemKeys.size && !urls.length) return queue;
    return queue.filter((item) => itemKeys.has(item.itemId) || urls.some((url) => sameStatusUrl(item.sourceUrl || item.url, url)));
  }

  async function readQueue() {
    const [state, settings] = await Promise.all([readLocalState("workbench"), readLocalState("settings")]);
    const xProfile = settings.xProfile || readJson(X_PROFILE_CONFIG_STORAGE_KEY, {});
    const queuePage = readJson(QUEUE_PAGE_STORAGE_KEY, {});
    const queue = [];
    const signals = state.signals || {};

    for (const mode of ["growth", "outbound"]) {
      const list = Array.isArray(signals[mode]) ? signals[mode] : [];
      for (const signal of list) {
        queue.push({
          itemId: signalKey(signal),
          mode,
          sourceUrl: signal.url || "",
          url: signal.url || "",
          replyUrl: signal.replyUrl || "",
          replyUrlAt: signal.replyUrlAt || "",
          author: signal.author || "",
          text: signal.text || "",
          status: signal.processedAction && signal.processedAction !== "new" ? signal.processedAction : signal.status || "new",
          feedback: signal.feedback || "none",
          usedDraft: signal.usedDraft || "",
        });
      }
    }

    const visibleQueue = filterQueueByCurrentPage(queue, queuePage);

    return {
      ok: true,
      queue: visibleQueue,
      page: queuePage,
      totalQueueCount: queue.length,
      selfUsername: usernameFromProfileUrl(xProfile.profileUrl || xProfile.url || ""),
      mode: state.mode || "growth",
    };
  }

  function matchUpdate(signal, update) {
    if (!signal || !update) return false;
    if (clean(update.itemId) && clean(update.itemId) === signalKey(signal)) return true;
    const signalUrl = signal.url || "";
    const signalReplyUrl = signal.replyUrl || "";
    const updateSourceUrl = update.sourceUrl || "";
    const updateReplyUrl = update.replyUrl || "";
    return Boolean(
      (signalUrl && updateSourceUrl && sameStatusUrl(signalUrl, updateSourceUrl)) ||
      (signalReplyUrl && updateReplyUrl && sameStatusUrl(signalReplyUrl, updateReplyUrl)) ||
      (signalUrl && updateReplyUrl && sameStatusUrl(signalUrl, updateReplyUrl))
    );
  }

  async function applyUpdates(updates) {
    const normalizedUpdates = Array.isArray(updates) ? updates : [];
    if (!normalizedUpdates.length) return { ok: true, appliedCount: 0, message: "没有需要回写的新反馈。" };

    for (let attempt = 1; attempt <= 5; attempt += 1) {
      const record = await readLocalStateRecord("workbench");
      const state = record.value;
      if (!record.exists || !state || typeof state !== "object") {
        return { ok: false, message: "没有找到 Ray Growth OS 本地工作台数据。" };
      }

      state.signals = state.signals || {};
      let appliedCount = 0;

      for (const mode of ["growth", "outbound"]) {
        const list = Array.isArray(state.signals[mode]) ? state.signals[mode] : [];
        state.signals[mode] = list.map((signal) => {
          const update = normalizedUpdates.find((candidate) => matchUpdate(signal, candidate));
          if (!update) return signal;

          const next = { ...signal };
          if (update.replyUrl) {
            next.replyUrl = update.replyUrl;
            next.replyUrlAt = update.replyUrlAt || next.replyUrlAt || new Date().toISOString();
          }
          if (update.feedback && update.feedback !== "none") {
            next.feedback = update.feedback;
            next.feedbackAt = update.feedbackAt || new Date().toISOString();
            next.feedbackReason = update.feedbackReason || update.reason || "浏览器插件从 X 页面同步。";
          }
          if ((!next.processedAction || next.processedAction === "new") && update.replyUrl) {
            next.status = "replied";
            next.processedAction = "replied";
            next.processedAt = update.replyUrlAt || update.feedbackAt || new Date().toISOString();
          }
          appliedCount += 1;
          return next;
        });
      }

      try {
        await writeLocalState("workbench", state, record.updatedAt);
        window.dispatchEvent(new CustomEvent("ray-growth-os:extension-sync", { detail: { appliedCount } }));
        return { ok: true, appliedCount, message: `已回写 ${appliedCount} 条反馈到 App。` };
      } catch (error) {
        if (error?.code !== "STATE_CONFLICT" || attempt === 5) throw error;
      }
    }

    return { ok: false, message: "工作台更新过于频繁，插件已停止写入以避免覆盖数据。" };
  }

  async function notifySourceOpen(url, hints = {}) {
    const normalizedUrl = normalizeUrl(url);
    if (!isXStatusUrl(normalizedUrl)) return;
    const { queue, selfUsername } = await readQueue();
    const item = queue.find((candidate) => sameStatusUrl(candidate.sourceUrl || candidate.url, normalizedUrl));
    if (!item) return;
    const usedDraft = clean(hints.usedDraft) || clean(item.usedDraft);
    try {
      chrome.runtime.sendMessage({
        type: "RAY_APP_SOURCE_OPENED",
        item: { ...item, usedDraft, sourceUrl: item.sourceUrl || item.url, url: item.url || item.sourceUrl },
        url: normalizedUrl,
        selfUsername,
      });
    } catch {
      // Extension was reloaded while the app page stayed open.
    }
  }

  document.addEventListener(
    "click",
    (event) => {
      const anchor = event.target?.closest?.('a[href*="/status/"]');
      if (anchor?.href) {
        void notifySourceOpen(anchor.href, { usedDraft: anchor.dataset?.rayUsedDraft || "" }).catch(() => {});
      }
    },
    true
  );

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "RAY_APPLY_FEEDBACK_UPDATES") {
      applyUpdates(message.updates)
        .then(sendResponse)
        .catch((error) => sendResponse({ ok: false, appliedCount: 0, message: error?.message || "无法写入本地工作台。" }));
      return true;
    }
    return false;
  });
})();
