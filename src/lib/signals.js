(function initSignals(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  root.Signals = api;
})(typeof globalThis !== "undefined" ? globalThis : window, function createSignalsApi() {
  const DEFAULT_SOURCE = "manual";
  const DEFAULT_STATUS = "new";
  const HEADER_ALIASES = {
    platform: ["platform", "channel", "site", "平台", "渠道"],
    author: ["author", "name", "user", "account", "作者", "用户", "账号", "名称"],
    url: ["url", "link", "href", "链接", "地址"],
    text: ["text", "note", "summary", "content", "摘要", "内容", "备注"],
    source: ["source", "来源"],
    tags: ["tags", "tag", "标签"],
    feedback: ["feedback", "feedback_status", "反馈", "反馈结果"],
    feedbackAt: ["feedbackAt", "feedback_at", "反馈时间"],
    replyUrl: ["replyUrl", "reply_url", "responseUrl", "myReplyUrl", "我的回复链接", "回复链接"],
    replyUrlAt: ["replyUrlAt", "reply_url_at", "responseUrlAt", "myReplyUrlAt", "回复链接时间"],
    usedDraft: ["usedDraft", "used_draft", "actualText", "actualReply", "finalReply", "实际话术", "采用话术", "最终回复"],
    usedDraftAt: ["usedDraftAt", "used_draft_at", "actualTextAt", "actualReplyAt", "finalReplyAt", "话术时间", "采用话术时间"],
  };

  function clean(value) {
    return String(value ?? "").trim();
  }

  function isPlainObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }

  function trimBullet(value) {
    return value.replace(/^[-*•\d.)\s]+/, "").trim();
  }

  function normalizeUrl(value) {
    const raw = clean(value).replace(/[),.;，。；、]+$/, "");
    if (!raw) return "";

    try {
      const url = new URL(raw);
      url.hash = "";
      for (const key of [...url.searchParams.keys()]) {
        if (/^(utm_|ref$|fbclid$|gclid$)/i.test(key)) {
          url.searchParams.delete(key);
        }
      }
      const query = url.searchParams.toString();
      return `${url.origin.toLowerCase()}${url.pathname.replace(/\/$/, "")}${query ? `?${query}` : ""}`;
    } catch {
      return raw;
    }
  }

  function normalizeText(value) {
    return clean(value).replace(/\s+/g, " ").toLowerCase();
  }

  function normalizeHeader(value) {
    return normalizeText(value).replace(/[\s_-]+/g, "");
  }

  function hashValue(value) {
    let hash = 2166136261;
    const text = String(value);
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
  }

  function signalDedupKey(signal) {
    const url = normalizeUrl(signal?.url);
    if (url) return `url:${url}`;

    return [
      "text",
      normalizeText(signal?.platform),
      normalizeText(signal?.author),
      hashValue(normalizeText(signal?.text)),
    ].join(":");
  }

  function splitTags(value) {
    if (Array.isArray(value)) return value.map(clean).filter(Boolean);
    return clean(value)
      .split(/[;,，、]/)
      .map(clean)
      .filter(Boolean);
  }

  function normalizeConfidence(value) {
    if (value === null || value === undefined || value === "") return null;
    const number = Number(value);
    if (!Number.isFinite(number)) return null;
    const scaled = number > 0 && number <= 1 ? number * 100 : number;
    return Math.max(0, Math.min(100, Math.round(scaled)));
  }

  function createSignal(input, options = {}) {
    const platform = clean(input?.platform) || "X";
    const author = clean(input?.author ?? input?.name) || "Unnamed signal";
    const url = normalizeUrl(input?.url ?? input?.link);
    const text = clean(input?.text ?? input?.note ?? input?.summary ?? input?.content);
    const source = clean(input?.source ?? options.source) || DEFAULT_SOURCE;
    const importedAt = clean(input?.importedAt ?? options.now) || new Date().toISOString();
    const status = clean(input?.status) || DEFAULT_STATUS;
    const tags = splitTags(input?.tags);
    const reason = clean(input?.reason ?? input?.why ?? input?.rationale);
    const confidence = normalizeConfidence(input?.confidence ?? input?.score);
    const processedAt = clean(input?.processedAt);
    const processedAction = clean(input?.processedAction);
    const feedback = clean(input?.feedback);
    const feedbackAt = clean(input?.feedbackAt);
    const replyUrl = normalizeUrl(input?.replyUrl ?? input?.responseUrl ?? input?.myReplyUrl);
    const replyUrlAt = clean(input?.replyUrlAt ?? input?.responseUrlAt ?? input?.myReplyUrlAt);
    const usedDraft = clean(input?.usedDraft ?? input?.actualText ?? input?.actualReply ?? input?.finalReply);
    const usedDraftAt = clean(input?.usedDraftAt ?? input?.actualTextAt ?? input?.actualReplyAt ?? input?.finalReplyAt);
    const dedupKey = signalDedupKey({ platform, author, url, text });
    const signal = {
      id: `${dedupKey.startsWith("url:") ? "url" : "txt"}_${hashValue(dedupKey)}`,
      source,
      platform,
      author,
      url,
      text,
      importedAt,
      status,
      tags,
    };

    if (reason) signal.reason = reason;
    if (confidence !== null) signal.confidence = confidence;
    if (processedAt) signal.processedAt = processedAt;
    if (processedAction) signal.processedAction = processedAction;
    if (feedback) signal.feedback = feedback;
    if (feedbackAt) signal.feedbackAt = feedbackAt;
    if (replyUrl) signal.replyUrl = replyUrl;
    if (replyUrlAt) signal.replyUrlAt = replyUrlAt;
    if (usedDraft) signal.usedDraft = usedDraft;
    if (usedDraftAt) signal.usedDraftAt = usedDraftAt;

    return signal;
  }

  function splitCsvLine(line) {
    const cells = [];
    let current = "";
    let inQuotes = false;

    for (let index = 0; index < line.length; index += 1) {
      const char = line[index];
      const next = line[index + 1];
      if (char === '"' && next === '"' && inQuotes) {
        current += '"';
        index += 1;
        continue;
      }
      if (char === '"') {
        inQuotes = !inQuotes;
        continue;
      }
      if (char === "," && !inQuotes) {
        cells.push(clean(current));
        current = "";
        continue;
      }
      current += char;
    }

    cells.push(clean(current));
    return cells;
  }

  function headerFieldFor(value) {
    const normalized = normalizeHeader(value);
    for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
      if (aliases.some((alias) => normalizeHeader(alias) === normalized)) {
        return field;
      }
    }
    return "";
  }

  function isHeaderRow(parts) {
    return parts.map(headerFieldFor).filter(Boolean).length >= 2;
  }

  function valueFromHeader(parts, headerFields, field) {
    const index = headerFields.indexOf(field);
    return index >= 0 ? parts[index] : "";
  }

  function rowToSignal(parts, options) {
    if (parts.length < 2 || isHeaderRow(parts)) return null;

    const [platform = "X", author = "Unnamed signal", url = "", ...textParts] = parts;
    const text = textParts.join(parts.length > 4 ? " | " : "").trim();
    if (!clean(text) && !normalizeUrl(url)) return null;

    return createSignal(
      {
        platform,
        author,
        url,
        text: text || clean(url),
      },
      options
    );
  }

  function rowToSignalFromHeader(parts, headerFields, options) {
    const url = valueFromHeader(parts, headerFields, "url");
    const text = valueFromHeader(parts, headerFields, "text");
    if (!clean(text) && !normalizeUrl(url)) return null;

    return createSignal(
      {
        platform: valueFromHeader(parts, headerFields, "platform") || "X",
        author: valueFromHeader(parts, headerFields, "author") || "Unnamed signal",
        url,
        text: text || clean(url),
        source: valueFromHeader(parts, headerFields, "source") || options.source,
        tags: splitTags(valueFromHeader(parts, headerFields, "tags")),
        feedback: valueFromHeader(parts, headerFields, "feedback"),
        feedbackAt: valueFromHeader(parts, headerFields, "feedbackAt"),
        replyUrl: valueFromHeader(parts, headerFields, "replyUrl"),
        replyUrlAt: valueFromHeader(parts, headerFields, "replyUrlAt"),
        usedDraft: valueFromHeader(parts, headerFields, "usedDraft"),
        usedDraftAt: valueFromHeader(parts, headerFields, "usedDraftAt"),
      },
      options
    );
  }

  function parseSignalsFromText(text, options = {}) {
    const rows = clean(text)
      .split(/\r?\n/)
      .map((line) => trimBullet(line))
      .filter(Boolean);
    const signals = [];
    let csvHeaderFields = null;

    for (const row of rows) {
      const isPipeRow = row.includes("|");
      const parts = isPipeRow ? row.split("|").map(clean) : splitCsvLine(row);

      if (!isPipeRow && isHeaderRow(parts)) {
        csvHeaderFields = parts.map(headerFieldFor);
        continue;
      }

      const signal = !isPipeRow && csvHeaderFields ? rowToSignalFromHeader(parts, csvHeaderFields, options) : rowToSignal(parts, options);
      if (signal) signals.push(signal);
    }

    return signals;
  }

  function tryParseJson(value) {
    try {
      return { ok: true, value: JSON.parse(value), error: "" };
    } catch (error) {
      return { ok: false, value: null, error: error instanceof Error ? error.message : "Invalid JSON" };
    }
  }

  function uniqueCandidates(candidates) {
    const seen = new Set();
    return candidates.filter((candidate) => {
      const value = clean(candidate);
      if (!value || seen.has(value)) return false;
      seen.add(value);
      return true;
    });
  }

  function jsonCandidatesFromText(text) {
    const raw = clean(text);
    const candidates = [raw];
    const fenceMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenceMatch) candidates.push(fenceMatch[1]);

    const arrayStart = raw.indexOf("[");
    const arrayEnd = raw.lastIndexOf("]");
    if (arrayStart >= 0 && arrayEnd > arrayStart) candidates.push(raw.slice(arrayStart, arrayEnd + 1));

    const objectStart = raw.indexOf("{");
    const objectEnd = raw.lastIndexOf("}");
    if (objectStart >= 0 && objectEnd > objectStart) candidates.push(raw.slice(objectStart, objectEnd + 1));

    return uniqueCandidates(candidates);
  }

  function parseJsonValueFromText(text) {
    for (const candidate of jsonCandidatesFromText(text)) {
      const parsed = tryParseJson(candidate);
      if (parsed.ok) return parsed;
    }

    return { ok: false, value: null, error: "No valid JSON object or array found" };
  }

  function structuredSignalRows(value) {
    if (Array.isArray(value)) return value;
    if (!isPlainObject(value)) return [];

    for (const key of ["signals", "results", "items", "data"]) {
      if (Array.isArray(value[key])) return value[key];
    }

    return [];
  }

  function stringList(value) {
    if (Array.isArray(value)) return value.map(clean).filter(Boolean).slice(0, 8);
    const text = clean(value);
    return text ? [text] : [];
  }

  function normalizeAccountRadar(value) {
    if (!isPlainObject(value)) return null;
    const radar = {
      accountType: clean(value.accountType ?? value.type),
      competitorPosition: clean(value.competitorPosition ?? value.targetPosition ?? value.accountPosition),
      ourPosition: clean(value.ourPosition ?? value.myPosition ?? value.userPosition),
      audienceOverlap: clean(value.audienceOverlap ?? value.overlap),
      opportunityGap: clean(value.opportunityGap ?? value.gap),
      recommendedAngles: stringList(value.recommendedAngles ?? value.angles),
      nextStep: clean(value.nextStep ?? value.recommendedNextStep),
      keywords: stringList(value.keywords ?? value.searchKeywords),
      riskNotes: clean(value.riskNotes ?? value.risks),
    };

    const hasText = Object.entries(radar).some(([, item]) => (Array.isArray(item) ? item.length > 0 : Boolean(item)));
    return hasText ? radar : null;
  }

  function parseStructuredSignalsFromText(text, options = {}) {
    const parsed = parseJsonValueFromText(text);
    if (!parsed.ok) {
      return { ok: false, signals: [], error: parsed.error };
    }

    const accountRadar = normalizeAccountRadar(isPlainObject(parsed.value) ? parsed.value.accountRadar : null);
    const rows = structuredSignalRows(parsed.value);
    const signals = [];
    for (const row of rows) {
      if (!isPlainObject(row)) continue;
      const signal = createSignal(
        {
          platform: row.platform ?? row.channel ?? row.sourcePlatform ?? "X",
          author: row.author ?? row.name ?? row.account ?? row.user,
          url: row.url ?? row.link ?? row.href,
          text: row.text ?? row.summary ?? row.note ?? row.content,
          reason: row.reason ?? row.why ?? row.rationale,
          tags: row.tags,
          confidence: row.confidence ?? row.score,
          feedback: row.feedback ?? row.feedbackStatus,
          feedbackAt: row.feedbackAt ?? row.feedback_at,
          replyUrl: row.replyUrl ?? row.reply_url ?? row.responseUrl ?? row.myReplyUrl,
          replyUrlAt: row.replyUrlAt ?? row.reply_url_at ?? row.responseUrlAt ?? row.myReplyUrlAt,
          usedDraft: row.usedDraft ?? row.actualText ?? row.actualReply ?? row.finalReply,
          usedDraftAt: row.usedDraftAt ?? row.actualTextAt ?? row.actualReplyAt ?? row.finalReplyAt,
        },
        options
      );
      if (signal.text || signal.url) signals.push(signal);
    }

    return {
      ok: signals.length > 0,
      signals,
      error: signals.length > 0 ? "" : "JSON parsed, but no importable signals were found",
      raw: parsed.value,
      accountRadar,
    };
  }
  function mergeSignals(existingSignals, incomingSignals) {
    const signals = [];
    const imported = [];
    const duplicates = [];
    const seen = new Set();

    for (const signal of existingSignals ?? []) {
      const normalized = createSignal(signal);
      const key = signalDedupKey(normalized);
      if (!seen.has(key)) {
        seen.add(key);
        signals.push(normalized);
      }
    }

    for (const signal of incomingSignals ?? []) {
      const normalized = createSignal(signal);
      const key = signalDedupKey(normalized);
      if (seen.has(key)) {
        duplicates.push(normalized);
        continue;
      }
      seen.add(key);
      signals.push(normalized);
      imported.push(normalized);
    }

    return { signals, imported, duplicates };
  }

  function csvEscape(value) {
    const text = String(value ?? "");
    return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  }

  function createSignalCsvTemplate() {
    const header = ["platform", "author", "url", "text", "tags"];
    const sample = [
      "X",
      "AI indie founder",
      "https://x.com/founder/status/1",
      "Built with AI Coding but has 0 traffic",
      "AI Coding;first users",
    ];

    return [header.join(","), sample.map(csvEscape).join(",")].join("\n");
  }
  function createSignalImportPreview(rawText, existingSignals = [], options = {}) {
    const candidates = parseSignalsFromText(rawText, options);
    const result = mergeSignals(existingSignals, candidates);

    return {
      parsedCount: candidates.length,
      importableCount: result.imported.length,
      duplicateCount: result.duplicates.length,
      candidates,
      importable: result.imported,
      duplicates: result.duplicates,
    };
  }

  function formatSignalsAsLeadInput(signals) {
    return (signals ?? [])
      .map((signal) => {
        const normalized = createSignal(signal);
        return `${normalized.platform} | ${normalized.author} | ${normalized.url} | ${normalized.text}`;
      })
      .join("\n");
  }

  function normalizePackFeedback(value) {
    const status = clean(value);
    return ["got_reply", "no_reply", "followed", "reshared"].includes(status) ? status : "none";
  }

  function normalizePackExecutionStatus(value) {
    const status = clean(value);
    return ["new", "replied", "quoted", "saved", "skipped"].includes(status) ? status : DEFAULT_STATUS;
  }

  function buildFeedbackLearningPack(signals, options = {}) {
    const mode = clean(options.mode) || "growth";
    const generatedAt = clean(options.now) || new Date().toISOString();
    const limit = Math.max(1, Math.min(100, Number(options.limit) || 50));
    const feedbackSignals = (signals ?? [])
      .map((signal) => createSignal(signal))
      .filter((signal) => normalizePackFeedback(signal.feedback) !== "none")
      .sort((left, right) => new Date(right.feedbackAt || right.processedAt || 0).getTime() - new Date(left.feedbackAt || left.processedAt || 0).getTime());
    const selectedSignals = feedbackSignals.slice(0, limit);
    const positiveFeedback = new Set(["got_reply", "followed", "reshared"]);
    const samples = selectedSignals.map((signal, index) => {
      const feedback = normalizePackFeedback(signal.feedback);
      return {
        index: index + 1,
        id: signal.id,
        platform: signal.platform,
        author: signal.author,
        url: signal.url,
        originalSignal: signal.text,
        executionStatus: normalizePackExecutionStatus(signal.status),
        executionAction: clean(signal.processedAction),
        processedAt: clean(signal.processedAt),
        feedback,
        feedbackAt: clean(signal.feedbackAt),
        actualReply: clean(signal.usedDraft),
        actualReplySavedAt: clean(signal.usedDraftAt),
        tags: Array.isArray(signal.tags) ? signal.tags : [],
        source: signal.source,
        reason: clean(signal.reason),
        confidence: signal.confidence ?? null,
      };
    });
    const context = {
      mode,
      generatedAt,
      totalFeedbackSignals: feedbackSignals.length,
      sampleCount: samples.length,
      positiveCount: samples.filter((sample) => positiveFeedback.has(sample.feedback)).length,
      noReplyCount: samples.filter((sample) => sample.feedback === "no_reply").length,
      withActualReplyCount: samples.filter((sample) => sample.actualReply).length,
    };
    const payload = {
      title: "Ray Growth OS feedback learning pack",
      context,
      instructions: [
        "Identify which signal types are worth prioritizing next.",
        "Compare positive feedback samples against no-reply samples and explain the likely difference.",
        "Extract reply patterns from actualReply that should be reused, avoided, or tested again.",
        "Suggest concrete scoring-rule adjustments for the next batch of signals.",
        "Return the answer in Chinese with: winning patterns, losing patterns, reusable reply templates, scoring changes, and next 5 actions.",
      ],
      samples,
    };

    return [
      "请作为 Ray Growth OS 的增长复盘分析师，基于下面的执行样本分析哪些线索和话术真正有效。",
      "重点看 originalSignal、executionStatus、feedback、actualReply、reason、confidence 之间的关系。",
      "不要泛泛总结，请给出可以直接改进下一轮线索筛选和回复生成的规则。",
      "",
      "```json",
      JSON.stringify(payload, null, 2),
      "```",
    ].join("\n");
  }
  return {
    buildFeedbackLearningPack,
    createSignal,
    createSignalCsvTemplate,
    createSignalImportPreview,
    formatSignalsAsLeadInput,
    mergeSignals,
    parseSignalsFromText,
    parseStructuredSignalsFromText,
    signalDedupKey,
  };
});