import {
  AI_RESPONSE_CONFIG_STORAGE_KEY,
  GROK_PROXY_CONFIG_STORAGE_KEY,
  X_PROFILE_CONFIG_STORAGE_KEY,
  normalizeAiResponseConfig,
  normalizeGrokProxyConfig,
  normalizeXProfileConfig,
} from "@/lib/codeproxy-grok";

export type LocalStateScope = "settings" | "workbench";

export type SharedSettings = {
  version: 1;
  grok: { apiKey: string; model: string; endpoint: string };
  ai: { apiKey: string; model: string; endpoint: string };
  xProfile: { profileUrl: string };
};

type LocalStateResponse<T> = {
  ok: boolean;
  exists: boolean;
  value: T | null;
  updatedAt: string | null;
  message?: string;
};

export class LocalStateConflictError extends Error {
  currentUpdatedAt: string | null;

  constructor(message: string, currentUpdatedAt: string | null) {
    super(message);
    this.name = "LocalStateConflictError";
    this.currentUpdatedAt = currentUpdatedAt;
  }
}

async function parseResponse<T extends { ok: boolean; message?: string }>(response: Response) {
  const body = (await response.json().catch(() => null)) as (T & { message?: string }) | null;
  if (!response.ok || !body?.ok) {
    throw new Error(body?.message || `Local storage request failed (${response.status}).`);
  }
  return body;
}

export async function readLocalState<T>(scope: LocalStateScope) {
  const response = await fetch(`/api/local-state/${scope}`, { cache: "no-store" });
  return parseResponse<LocalStateResponse<T>>(response);
}

export async function writeLocalState(
  scope: LocalStateScope,
  value: object,
  options?: { expectedUpdatedAt: string | null }
) {
  const response = await fetch(`/api/local-state/${scope}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ value, ...(options ? { expectedUpdatedAt: options.expectedUpdatedAt } : {}) }),
  });
  const body = (await response.json().catch(() => null)) as {
    ok: boolean;
    changed?: boolean;
    updatedAt?: string;
    currentUpdatedAt?: string | null;
    code?: string;
    message?: string;
  } | null;
  if (response.status === 409 && body?.code === "STATE_CONFLICT") {
    throw new LocalStateConflictError(body.message || "Local state changed in another page.", body.currentUpdatedAt ?? null);
  }
  if (!response.ok || !body?.ok || !body.updatedAt) {
    throw new Error(body?.message || `Local storage request failed (${response.status}).`);
  }
  return { ok: true, changed: Boolean(body.changed), updatedAt: body.updatedAt };
}

function readJson(key: string) {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as unknown) : {};
  } catch {
    return {};
  }
}

export function normalizeSharedSettings(value: unknown): SharedSettings {
  const source = value && typeof value === "object" ? (value as Partial<SharedSettings>) : {};
  return {
    version: 1,
    grok: normalizeGrokProxyConfig(source.grok ?? {}) as SharedSettings["grok"],
    ai: normalizeAiResponseConfig(source.ai ?? {}) as SharedSettings["ai"],
    xProfile: normalizeXProfileConfig(source.xProfile ?? {}) as SharedSettings["xProfile"],
  };
}

export function readLegacySettings(): SharedSettings {
  return normalizeSharedSettings({
    grok: readJson(GROK_PROXY_CONFIG_STORAGE_KEY),
    ai: readJson(AI_RESPONSE_CONFIG_STORAGE_KEY),
    xProfile: readJson(X_PROFILE_CONFIG_STORAGE_KEY),
  });
}

export function mirrorSharedSettings(settings: SharedSettings) {
  try {
    window.localStorage.setItem(GROK_PROXY_CONFIG_STORAGE_KEY, JSON.stringify(settings.grok));
    window.localStorage.setItem(AI_RESPONSE_CONFIG_STORAGE_KEY, JSON.stringify(settings.ai));
    window.localStorage.setItem(X_PROFILE_CONFIG_STORAGE_KEY, JSON.stringify(settings.xProfile));
  } catch {
    // The SQLite copy remains authoritative if browser storage is unavailable.
  }
}

export async function loadSharedSettings() {
  const response = await readLocalState<SharedSettings>("settings");
  const settings = response.exists ? normalizeSharedSettings(response.value) : readLegacySettings();

  if (!response.exists) {
    // Deliberately migrate settings only. Legacy workbench data is never read here.
    await writeLocalState("settings", settings);
  }

  mirrorSharedSettings(settings);
  return settings;
}

export async function saveSharedSettings(value: unknown) {
  const settings = normalizeSharedSettings(value);
  await writeLocalState("settings", settings);
  mirrorSharedSettings(settings);
  return settings;
}
