(() => {
  if (window.__RAY_GROWTH_OS_X_BRIDGE__) return;
  window.__RAY_GROWTH_OS_X_BRIDGE__ = true;

  let lastHref = location.href;
  let scanTimer = 0;

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
      const url = new URL(raw, location.origin);
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

  function statusFromUrl(value) {
    try {
      const url = new URL(value, location.origin);
      const host = url.hostname.toLowerCase().replace(/^www\./, "");
      if (host !== "x.com" && host !== "twitter.com") return null;
      const parts = url.pathname.split("/").filter(Boolean);
      const statusIndex = parts.findIndex((part) => part === "status" || part === "statuses");
      if (statusIndex <= 0) return null;
      const username = normalizeUsername(parts[0]);
      const statusId = parts[statusIndex + 1] || "";
      if (!/^\d+$/.test(statusId)) return null;
      return { username, statusId, url: `https://x.com/${username}/status/${statusId}` };
    } catch {
      return null;
    }
  }

  function parseNumber(value) {
    const text = clean(value).replace(/,/g, "");
    const match = text.match(/([0-9]+(?:\.[0-9]+)?)\s*([kKmM]|\u4e07)?/);
    if (!match) return 0;
    const base = Number(match[1]);
    if (!Number.isFinite(base)) return 0;
    const suffix = match[2] || "";
    if (/k/i.test(suffix)) return Math.round(base * 1000);
    if (/m/i.test(suffix)) return Math.round(base * 1000000);
    if (suffix === "\u4e07") return Math.round(base * 10000);
    return Math.round(base);
  }

  function readMetrics(article) {
    const metrics = { replies: 0, reposts: 0, quotes: 0, likes: 0 };
    for (const element of article.querySelectorAll("[aria-label]")) {
      const label = clean(element.getAttribute("aria-label"));
      if (!label) continue;
      const value = parseNumber(label);
      const lower = label.toLowerCase();
      if (/reply|replies|回复|回覆/.test(lower)) metrics.replies = Math.max(metrics.replies, value);
      if (/repost|retweet|转发|轉發|转帖|轉帖/.test(lower)) metrics.reposts = Math.max(metrics.reposts, value);
      if (/quote|引用/.test(lower)) metrics.quotes = Math.max(metrics.quotes, value);
      if (/like|likes|喜欢|喜歡|点赞|點讚/.test(lower)) metrics.likes = Math.max(metrics.likes, value);
    }
    return metrics;
  }

  function articleStatus(article) {
    const links = [...article.querySelectorAll('a[href*="/status/"]')]
      .map((anchor) => statusFromUrl(anchor.href))
      .filter(Boolean);
    if (!links.length) return null;
    const unique = [];
    const seen = new Set();
    for (const link of links) {
      if (seen.has(link.statusId)) continue;
      seen.add(link.statusId);
      unique.push(link);
    }
    return unique[unique.length - 1] || unique[0];
  }

  function readArticles() {
    return [...document.querySelectorAll("article")]
      .map((article) => {
        const status = articleStatus(article);
        if (!status) return null;
        return {
          ...status,
          url: normalizeUrl(status.url),
          text: clean(article.innerText).slice(0, 1800),
          metrics: readMetrics(article),
        };
      })
      .filter(Boolean);
  }

  function scanPage(trigger = "auto") {
    const currentStatus = statusFromUrl(location.href);
    const articles = readArticles();
    const current = currentStatus
      ? articles.find((article) => article.statusId === currentStatus.statusId) || { ...currentStatus, url: normalizeUrl(currentStatus.url), text: "", metrics: {} }
      : null;
    return { ok: true, trigger, url: normalizeUrl(location.href), current, articles };
  }

  function sendAutoScan(trigger = "auto") {
    try {
      chrome.runtime.sendMessage({ type: "RAY_X_SCAN_RESULT", scan: scanPage(trigger) });
    } catch {
      // Extension was reloaded while X was open.
    }
  }

  function scheduleScan(delay = 1200, trigger = "auto") {
    clearTimeout(scanTimer);
    scanTimer = setTimeout(() => sendAutoScan(trigger), delay);
  }

  function likelySubmitButton(target) {
    const button = target?.closest?.('button, [role="button"], div[data-testid]');
    if (!button) return false;
    const label = [
      button.getAttribute("aria-label"),
      button.getAttribute("data-testid"),
      button.textContent,
    ]
      .map(clean)
      .join(" ")
      .toLowerCase();
    if (!label) return false;
    return /tweetbutton|tweetbuttoninline|reply|post|发布|發佈|回复|回覆/.test(label);
  }

  document.addEventListener(
    "click",
    (event) => {
      if (!likelySubmitButton(event.target)) return;
      scheduleScan(1200, "reply-click");
      setTimeout(() => sendAutoScan("reply-click"), 3500);
      setTimeout(() => sendAutoScan("reply-click"), 7000);
      setTimeout(() => sendAutoScan("reply-click"), 12000);
    },
    true
  );

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "RAY_SCAN_X_NOW") {
      sendResponse(scanPage("manual"));
      return true;
    }
    return false;
  });

  scheduleScan(900, "auto");
  setTimeout(() => sendAutoScan("auto"), 3500);

  const observer = new MutationObserver(() => scheduleScan(1600, "auto"));
  observer.observe(document.documentElement, { childList: true, subtree: true });

  setInterval(() => {
    if (location.href !== lastHref) {
      lastHref = location.href;
      scheduleScan(900, "auto");
      setTimeout(() => sendAutoScan("auto"), 3200);
    }
  }, 1000);
})();
