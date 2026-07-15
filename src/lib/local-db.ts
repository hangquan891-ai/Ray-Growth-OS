import "server-only";

import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

export type LocalStateScope = "settings" | "workbench";

export type AiDiagnosticInput = {
  action: string;
  durationMs: number;
  httpStatus?: number | null;
  model: string;
  outcome: string;
  requestBody?: string;
  responseBody?: string;
  responseShape?: unknown;
  errorMessage?: string;
};

export type AiDiagnosticRecord = Omit<AiDiagnosticInput, "requestBody" | "responseBody"> & {
  id: number;
  createdAt: string;
  requestBody: string;
  responseBody: string;
};

type LocalStateRow = {
  value_json: string;
  updated_at: string;
};

export type LocalStateWriteResult = {
  changed: boolean;
  updatedAt: string;
};

export class LocalStateConflictError extends Error {
  currentUpdatedAt: string | null;

  constructor(currentUpdatedAt: string | null) {
    super("Local state changed after it was read.");
    this.name = "LocalStateConflictError";
    this.currentUpdatedAt = currentUpdatedAt;
  }
}

type DatabaseHolder = {
  database?: DatabaseSync;
};

const globalDatabase = globalThis as typeof globalThis & {
  __rayGrowthOsDatabase?: DatabaseHolder;
};

function defaultDataDirectory() {
  if (process.platform === "win32") {
    return join(process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local"), "RayGrowthOS");
  }

  if (process.platform === "darwin") {
    return join(homedir(), "Library", "Application Support", "RayGrowthOS");
  }

  return join(process.env.XDG_DATA_HOME || join(homedir(), ".local", "share"), "ray-growth-os");
}

export function localDatabasePath() {
  const configuredDirectory = process.env.RAY_GROWTH_OS_DATA_DIR?.trim();
  const dataDirectory = configuredDirectory ? resolve(configuredDirectory) : defaultDataDirectory();
  return join(dataDirectory, "ray-growth-os.db");
}

function ensureSchema(database: DatabaseSync) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS app_state (
      scope TEXT PRIMARY KEY CHECK (scope IN ('settings', 'workbench')),
      value_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS app_state_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      scope TEXT NOT NULL CHECK (scope IN ('settings', 'workbench')),
      value_json TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      archived_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS app_state_history_scope_id
      ON app_state_history(scope, id DESC);
    CREATE TABLE IF NOT EXISTS ai_diagnostics (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      action TEXT NOT NULL,
      created_at TEXT NOT NULL,
      duration_ms INTEGER NOT NULL,
      http_status INTEGER,
      model TEXT NOT NULL,
      outcome TEXT NOT NULL,
      request_body_text TEXT NOT NULL DEFAULT '',
      response_body_text TEXT NOT NULL DEFAULT '',
      response_shape_json TEXT NOT NULL,
      error_message TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS ai_diagnostics_action_created_at
      ON ai_diagnostics(action, created_at DESC)
  `);

  const diagnosticColumns = new Set(
    database.prepare("PRAGMA table_info(ai_diagnostics)").all().map((row) => String((row as Record<string, unknown>).name || ""))
  );
  if (!diagnosticColumns.has("request_body_text")) {
    database.exec("ALTER TABLE ai_diagnostics ADD COLUMN request_body_text TEXT NOT NULL DEFAULT ''");
  }
  if (!diagnosticColumns.has("response_body_text")) {
    database.exec("ALTER TABLE ai_diagnostics ADD COLUMN response_body_text TEXT NOT NULL DEFAULT ''");
  }
}

function openDatabase() {
  const databasePath = localDatabasePath();
  mkdirSync(dirname(databasePath), { recursive: true });

  const database = new DatabaseSync(databasePath);
  database.exec("PRAGMA journal_mode = WAL");
  database.exec("PRAGMA busy_timeout = 5000");
  ensureSchema(database);
  return database;
}

function getDatabase() {
  const holder = globalDatabase.__rayGrowthOsDatabase ?? {};
  if (!holder.database) holder.database = openDatabase();
  ensureSchema(holder.database);
  globalDatabase.__rayGrowthOsDatabase = holder;
  return holder.database;
}

export function getLocalState(scope: LocalStateScope) {
  const row = getDatabase()
    .prepare("SELECT value_json, updated_at FROM app_state WHERE scope = ?")
    .get(scope) as LocalStateRow | undefined;

  if (!row) return null;

  try {
    return {
      value: JSON.parse(row.value_json) as unknown,
      updatedAt: row.updated_at,
    };
  } catch {
    getDatabase().prepare("DELETE FROM app_state WHERE scope = ?").run(scope);
    return null;
  }
}

export function setLocalState(
  scope: LocalStateScope,
  value: unknown,
  expectedUpdatedAt?: string | null
): LocalStateWriteResult {
  const database = getDatabase();
  const valueJson = JSON.stringify(value);
  database.exec("BEGIN IMMEDIATE");
  try {
    const current = database
      .prepare("SELECT value_json, updated_at FROM app_state WHERE scope = ?")
      .get(scope) as LocalStateRow | undefined;
    const currentUpdatedAt = current?.updated_at ?? null;

    // Identical writes are safe no-ops even if the caller read an older revision.
    if (current?.value_json === valueJson) {
      database.exec("COMMIT");
      return { changed: false, updatedAt: current.updated_at };
    }

    if (expectedUpdatedAt !== undefined && currentUpdatedAt !== expectedUpdatedAt) {
      throw new LocalStateConflictError(currentUpdatedAt);
    }

    let updatedAt = new Date().toISOString();
    if (updatedAt === currentUpdatedAt) {
      updatedAt = new Date(Date.parse(updatedAt) + 1).toISOString();
    }

    if (current) {
      database.prepare(`
        INSERT INTO app_state_history (scope, value_json, updated_at, archived_at)
        VALUES (?, ?, ?, ?)
      `).run(scope, current.value_json, current.updated_at, updatedAt);
    }

    database.prepare(`
        INSERT INTO app_state (scope, value_json, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(scope) DO UPDATE SET
          value_json = excluded.value_json,
          updated_at = excluded.updated_at
      `)
      .run(scope, valueJson, updatedAt);

    database.prepare(`
      DELETE FROM app_state_history
      WHERE scope = ? AND id NOT IN (
        SELECT id FROM app_state_history WHERE scope = ? ORDER BY id DESC LIMIT 100
      )
    `).run(scope, scope);

    database.exec("COMMIT");
    return { changed: true, updatedAt };
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

export function clearLocalState(scope: LocalStateScope) {
  const database = getDatabase();
  database.exec("BEGIN IMMEDIATE");
  try {
    const current = database
      .prepare("SELECT value_json, updated_at FROM app_state WHERE scope = ?")
      .get(scope) as LocalStateRow | undefined;
    if (!current) {
      database.exec("COMMIT");
      return false;
    }
    database.prepare(`
      INSERT INTO app_state_history (scope, value_json, updated_at, archived_at)
      VALUES (?, ?, ?, ?)
    `).run(scope, current.value_json, current.updated_at, new Date().toISOString());
    database.prepare("DELETE FROM app_state WHERE scope = ?").run(scope);
    database.exec("COMMIT");
    return true;
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

function safeDiagnosticText(value: unknown, maxLength = 500) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

export function recordAiDiagnostic(input: AiDiagnosticInput) {
  const createdAt = new Date().toISOString();
  const result = getDatabase()
    .prepare(`
      INSERT INTO ai_diagnostics (
        action, created_at, duration_ms, http_status, model, outcome,
        request_body_text, response_body_text, response_shape_json, error_message
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .run(
      safeDiagnosticText(input.action, 80),
      createdAt,
      Math.max(0, Math.round(Number(input.durationMs) || 0)),
      Number.isFinite(input.httpStatus) ? Number(input.httpStatus) : null,
      safeDiagnosticText(input.model, 120),
      safeDiagnosticText(input.outcome, 80),
      String(input.requestBody ?? ""),
      String(input.responseBody ?? ""),
      JSON.stringify(input.responseShape ?? {}),
      safeDiagnosticText(input.errorMessage)
    );

  getDatabase().prepare(`
    DELETE FROM ai_diagnostics
    WHERE id NOT IN (SELECT id FROM ai_diagnostics ORDER BY id DESC LIMIT 100)
  `).run();

  return { id: Number(result.lastInsertRowid), createdAt };
}

export function listAiDiagnostics(action?: string, limit = 20): AiDiagnosticRecord[] {
  const safeLimit = Math.max(1, Math.min(100, Math.round(Number(limit) || 20)));
  const rows = action
    ? getDatabase()
        .prepare(`
          SELECT id, action, created_at, duration_ms, http_status, model, outcome,
                 request_body_text, response_body_text, response_shape_json, error_message
          FROM ai_diagnostics WHERE action = ? ORDER BY id DESC LIMIT ?
        `)
        .all(safeDiagnosticText(action, 80), safeLimit)
    : getDatabase()
        .prepare(`
          SELECT id, action, created_at, duration_ms, http_status, model, outcome,
                 request_body_text, response_body_text, response_shape_json, error_message
          FROM ai_diagnostics ORDER BY id DESC LIMIT ?
        `)
        .all(safeLimit);

  return rows.map((row) => {
    const value = row as Record<string, unknown>;
    let responseShape: unknown = {};
    try {
      responseShape = JSON.parse(String(value.response_shape_json || "{}"));
    } catch {}
    return {
      id: Number(value.id),
      action: String(value.action || ""),
      createdAt: String(value.created_at || ""),
      durationMs: Number(value.duration_ms || 0),
      httpStatus: value.http_status === null ? null : Number(value.http_status),
      model: String(value.model || ""),
      outcome: String(value.outcome || ""),
      requestBody: String(value.request_body_text || ""),
      responseBody: String(value.response_body_text || ""),
      responseShape,
      errorMessage: String(value.error_message || ""),
    };
  });
}

export function getAiDiagnostic(id: number, action?: string): AiDiagnosticRecord | null {
  const safeId = Math.max(0, Math.round(Number(id) || 0));
  if (!safeId) return null;
  return listAiDiagnostics(action, 100).find((diagnostic) => diagnostic.id === safeId) ?? null;
}
