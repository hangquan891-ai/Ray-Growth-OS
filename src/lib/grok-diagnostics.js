(function initGrokDiagnostics(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  root.GrokDiagnostics = api;
})(typeof globalThis !== "undefined" ? globalThis : window, function createGrokDiagnosticsApi() {
  function clean(value) {
    return String(value ?? "").trim();
  }

  function errorEntry(value) {
    if (!value || typeof value !== "object") {
      return value ? { message: clean(value) } : null;
    }

    const source = value;
    const entry = {
      name: clean(source.name) || "Error",
      message: clean(source.message),
    };

    for (const key of ["code", "errno", "syscall", "address", "port"]) {
      if (source[key] !== undefined && source[key] !== null && clean(source[key])) {
        entry[key] = source[key];
      }
    }

    if (typeof source.stack === "string" && source.stack.trim()) {
      entry.stack = source.stack;
    }

    return entry;
  }

  function serializeErrorChain(error, maxDepth = 6) {
    const chain = [];
    const seen = new Set();
    const queue = [error];

    while (queue.length && chain.length < maxDepth) {
      const current = queue.shift();
      if (!current || seen.has(current)) continue;
      if (typeof current === "object") seen.add(current);
      const entry = errorEntry(current);
      if (entry) chain.push(entry);
      if (current && typeof current === "object") {
        if (current.cause) queue.push(current.cause);
        if (Array.isArray(current.errors)) queue.push(...current.errors);
      }
    }

    return chain;
  }

  function technicalErrorText(error) {
    const chain = serializeErrorChain(error);
    if (!chain.length) return clean(error) || "Unknown error";
    return chain
      .map((entry) => {
        const code = clean(entry.code);
        const label = [clean(entry.name), code ? `[${code}]` : ""].filter(Boolean).join(" ");
        return `${label}: ${clean(entry.message) || "Unknown error"}`;
      })
      .join(" <- ");
  }

  function classifyGrokRequestFailure(error, options = {}) {
    const locale = options.locale === "en" ? "en" : "zh-CN";
    const timeoutMs = Math.max(1, Number(options.timeoutMs) || 60000);
    const technicalMessage = technicalErrorText(error);
    const normalized = technicalMessage.toLowerCase();
    const isTimeout = /aborterror|aborted|timeout|timed out|etimedout|und_err_connect_timeout/.test(normalized);
    const isDns = /enotfound|eai_again|getaddrinfo|dns/.test(normalized);
    const isRefused = /econnrefused|connection refused/.test(normalized);
    const isReset = /econnreset|socket hang up|und_err_socket/.test(normalized);
    const isTls = /certificate|cert_|unable_to_verify|self_signed|tls|ssl/.test(normalized);

    if (locale === "en") {
      if (isTimeout) {
        return {
          status: "upstream_timeout",
          outcome: "timeout",
          message: `The proxy query did not finish within ${Math.round(timeoutMs / 1000)} seconds.`,
          suggestion: "Check the proxy service status and network, then retry. This timeout applies only to this request.",
          technicalMessage,
          retryable: true,
          errorChain: serializeErrorChain(error),
        };
      }
      if (isDns) {
        return {
          status: "request_failed",
          outcome: "dns_failed",
          message: "The local service could not resolve the codeproxy.dev domain name.",
          suggestion: "Check DNS, proxy/VPN, and whether codeproxy.dev is reachable from this computer.",
          technicalMessage,
          retryable: true,
          errorChain: serializeErrorChain(error),
        };
      }
      if (isRefused) {
        return {
          status: "request_failed",
          outcome: "connection_refused",
          message: "The connection to codeproxy.dev was refused.",
          suggestion: "Check the proxy service status, firewall, system proxy, and VPN settings.",
          technicalMessage,
          retryable: true,
          errorChain: serializeErrorChain(error),
        };
      }
      if (isReset) {
        return {
          status: "request_failed",
          outcome: "connection_reset",
          message: "The connection to codeproxy.dev was interrupted before a response completed.",
          suggestion: "Retry after checking network stability, the system proxy, and VPN settings.",
          technicalMessage,
          retryable: true,
          errorChain: serializeErrorChain(error),
        };
      }
      if (isTls) {
        return {
          status: "request_failed",
          outcome: "tls_failed",
          message: "The HTTPS certificate or TLS connection to codeproxy.dev could not be verified.",
          suggestion: "Check the system clock, HTTPS interception software, proxy certificates, and network environment.",
          technicalMessage,
          retryable: false,
          errorChain: serializeErrorChain(error),
        };
      }
      return {
        status: "request_failed",
        outcome: "network_failed",
        message: "The local service failed to connect to codeproxy.dev, so no Grok result was returned.",
        suggestion: "Check whether codeproxy.dev is reachable, then review the full log for the underlying network error.",
        technicalMessage,
        retryable: true,
        errorChain: serializeErrorChain(error),
      };
    }

    if (isTimeout) {
      return {
        status: "upstream_timeout",
        outcome: "timeout",
        message: `中转查询在 ${Math.round(timeoutMs / 1000)} 秒内没有完成。`,
        suggestion: "请检查中转服务状态和网络后重试；这个超时只计算本次请求。",
        technicalMessage,
        retryable: true,
        errorChain: serializeErrorChain(error),
      };
    }
    if (isDns) {
      return {
        status: "request_failed",
        outcome: "dns_failed",
        message: "本机服务无法解析 codeproxy.dev 的域名。",
        suggestion: "请检查 DNS、系统代理/VPN，以及当前电脑能否访问 codeproxy.dev。",
        technicalMessage,
        retryable: true,
        errorChain: serializeErrorChain(error),
      };
    }
    if (isRefused) {
      return {
        status: "request_failed",
        outcome: "connection_refused",
        message: "codeproxy.dev 拒绝了本机服务的连接。",
        suggestion: "请检查中转服务状态、防火墙、系统代理和 VPN 设置。",
        technicalMessage,
        retryable: true,
        errorChain: serializeErrorChain(error),
      };
    }
    if (isReset) {
      return {
        status: "request_failed",
        outcome: "connection_reset",
        message: "codeproxy.dev 在返回完成前中断了连接。",
        suggestion: "请检查网络稳定性、系统代理和 VPN 后重试。",
        technicalMessage,
        retryable: true,
        errorChain: serializeErrorChain(error),
      };
    }
    if (isTls) {
      return {
        status: "request_failed",
        outcome: "tls_failed",
        message: "本机无法验证 codeproxy.dev 的 HTTPS 证书或 TLS 连接。",
        suggestion: "请检查系统时间、HTTPS 拦截软件、代理证书和当前网络环境。",
        technicalMessage,
        retryable: false,
        errorChain: serializeErrorChain(error),
      };
    }
    return {
      status: "request_failed",
      outcome: "network_failed",
      message: "本机服务连接 codeproxy.dev 失败，因此没有拿到 Grok 结果。",
      suggestion: "请先确认当前电脑能访问 codeproxy.dev，再从完整日志查看底层网络异常。",
      technicalMessage,
      retryable: true,
      errorChain: serializeErrorChain(error),
    };
  }

  return {
    classifyGrokRequestFailure,
    serializeErrorChain,
    technicalErrorText,
  };
});
