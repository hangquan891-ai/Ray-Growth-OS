const $ = (selector) => document.querySelector(selector);
let progressTimer = 0;

function setStatus(message, tone = "info") {
  const el = $("#status");
  el.textContent = message;
  el.dataset.tone = tone;
}

function send(message) {
  return new Promise((resolve) => chrome.runtime.sendMessage(message, resolve));
}

function renderProgress(progress) {
  const panel = $("#scanProgress");
  const button = $("#refreshReplies");
  if (!progress || (!progress.active && !progress.total)) {
    panel.hidden = true;
    button.disabled = false;
    return false;
  }

  const scanned = Number(progress.scanned || 0);
  const total = Math.max(0, Number(progress.total || 0));
  const percent = total > 0 ? Math.min(100, Math.round((scanned / total) * 100)) : 0;
  panel.hidden = false;
  $("#scanProgressCount").textContent = `${scanned}/${total}`;
  $("#scanProgressBar").style.width = `${percent}%`;
  $("#scanProgressText").textContent = progress.message || (progress.active ? "正在巡检..." : "巡检完成。");
  $("#scanProgressTitle").textContent = progress.active ? "正在批量巡检" : "最近一次巡检";
  button.disabled = Boolean(progress.active);
  return Boolean(progress.active);
}

function scheduleProgressPolling(active) {
  clearInterval(progressTimer);
  progressTimer = 0;
  if (!active) return;
  progressTimer = setInterval(() => {
    void refreshState();
  }, 1000);
}

async function refreshState() {
  const state = await send({ type: "POPUP_GET_STATE" });
  $("#queueCount").textContent = state?.queueCount ?? 0;
  $("#pendingCount").textContent = state?.pendingCount ?? 0;
  $("#updateCount").textContent = state?.updateCount ?? 0;
  if (state?.selfUsername) $("#handle").value = state.selfUsername;
  scheduleProgressPolling(renderProgress(state?.replyScanProgress));
}

async function runAction(label, action) {
  setStatus(`${label}中...`);
  try {
    const result = await action();
    await refreshState();
    setStatus(result?.message || `${label}完成。`, result?.ok === false ? "error" : "success");
  } catch (error) {
    await refreshState();
    setStatus(error instanceof Error ? error.message : `${label}失败。`, "error");
  }
}

$("#saveHandle").addEventListener("click", () => {
  void runAction("保存用户名", () => send({ type: "POPUP_SET_SELF_USERNAME", username: $("#handle").value }));
});

$("#syncApp").addEventListener("click", () => {
  void runAction("读取 App 队列", () => send({ type: "POPUP_SYNC_APP" }));
});

$("#scanX").addEventListener("click", () => {
  void runAction("找回当前页回复并回写", () => send({ type: "POPUP_SCAN_X" }));
});

$("#refreshReplies").addEventListener("click", () => {
  void runAction("巡检已记录的回复链接", () => send({ type: "POPUP_REFRESH_REPLIES" }));
});

$("#applyApp").addEventListener("click", () => {
  void runAction("手动回写暂存反馈", () => send({ type: "POPUP_APPLY_APP" }));
});

void refreshState();
