(function initQueueTimeRange(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  root.QueueTimeRange = api;
})(typeof globalThis !== "undefined" ? globalThis : window, function createQueueTimeRangeApi() {
  /** @typedef {"today" | "yesterday" | "7d" | "30d" | "all"} QueueTimeRangeKey */

  /**
   * @param {string | undefined} value
   * @param {QueueTimeRangeKey} range
   * @param {Date} [now]
   */
  function matchesQueueTimeRange(value, range, now = new Date()) {
    if (range === "all") return true;
    if (!value) return false;

    const timestamp = new Date(value).getTime();
    if (Number.isNaN(timestamp)) return false;

    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);
    const start = new Date(todayStart);
    const end = new Date(todayStart);

    if (range === "today") {
      end.setDate(end.getDate() + 1);
    } else if (range === "yesterday") {
      start.setDate(start.getDate() - 1);
    } else if (range === "7d") {
      start.setDate(start.getDate() - 6);
      end.setDate(end.getDate() + 1);
    } else {
      start.setDate(start.getDate() - 29);
      end.setDate(end.getDate() + 1);
    }

    return timestamp >= start.getTime() && timestamp < end.getTime();
  }

  /**
   * Keep Today as the first choice when it has data. If crossing midnight
   * would otherwise make a non-empty queue look empty, choose the smallest
   * useful recent range instead.
   *
   * @param {Array<string | undefined>} importedAtValues
   * @param {Date} [now]
   * @returns {QueueTimeRangeKey}
   */
  function preferredVisibleQueueTimeRange(importedAtValues, now = new Date()) {
    const values = Array.isArray(importedAtValues) ? importedAtValues : [];
    if (values.some((value) => matchesQueueTimeRange(value, "today", now))) return "today";
    if (values.some((value) => matchesQueueTimeRange(value, "7d", now))) return "7d";
    if (values.some((value) => matchesQueueTimeRange(value, "30d", now))) return "30d";
    return "all";
  }

  return {
    matchesQueueTimeRange,
    preferredVisibleQueueTimeRange,
  };
});
