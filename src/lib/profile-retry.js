(function initProfileRetry(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  root.ProfileRetry = api;
})(typeof globalThis !== "undefined" ? globalThis : window, function createProfileRetryApi() {
  const PROFILE_MAX_RETRIES = 5;
  const RETRYABLE_STATUSES = new Set(["timeout", "request_failed", "empty_output", "invalid_output"]);

  function isRetryableHttpStatus(value) {
    const status = Number(value);
    return status === 408 || status === 425 || status === 429 || status >= 500;
  }

  function isRetryableProfileFailure(input) {
    const source = input && typeof input === "object" ? input : {};
    if (typeof source.retryable === "boolean") return source.retryable;
    if (RETRYABLE_STATUSES.has(String(source.status || ""))) return true;
    return isRetryableHttpStatus(source.httpStatus);
  }

  function profileRetryDelayMs(retryNumber) {
    const normalizedRetry = Math.max(1, Number(retryNumber) || 1);
    return Math.min(750 * 2 ** (normalizedRetry - 1), 4000);
  }

  return {
    PROFILE_MAX_RETRIES,
    isRetryableHttpStatus,
    isRetryableProfileFailure,
    profileRetryDelayMs,
  };
});
