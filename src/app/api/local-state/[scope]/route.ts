import { LocalStateConflictError, clearLocalState, getLocalState, setLocalState, type LocalStateScope } from "@/lib/local-db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_SCOPES = new Set<LocalStateScope>(["settings", "workbench"]);
const MAX_BYTES: Record<LocalStateScope, number> = {
  settings: 64 * 1024,
  workbench: 8 * 1024 * 1024,
};

type RouteContext = {
  params: Promise<{ scope: string }>;
};

async function readScope(context: RouteContext) {
  const { scope } = await context.params;
  return VALID_SCOPES.has(scope as LocalStateScope) ? (scope as LocalStateScope) : null;
}

function invalidScopeResponse() {
  return Response.json({ ok: false, message: "Unknown local state scope." }, { status: 404 });
}

export async function GET(_request: Request, context: RouteContext) {
  const scope = await readScope(context);
  if (!scope) return invalidScopeResponse();

  const state = getLocalState(scope);
  return Response.json({
    ok: true,
    exists: Boolean(state),
    value: state?.value ?? null,
    updatedAt: state?.updatedAt ?? null,
  });
}

export async function PUT(request: Request, context: RouteContext) {
  const scope = await readScope(context);
  if (!scope) return invalidScopeResponse();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, message: "Request body must be valid JSON." }, { status: 400 });
  }

  const value = body && typeof body === "object" && "value" in body ? (body as { value: unknown }).value : undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return Response.json({ ok: false, message: "Local state must be a JSON object." }, { status: 400 });
  }

  const serialized = JSON.stringify(value);
  if (Buffer.byteLength(serialized, "utf8") > MAX_BYTES[scope]) {
    return Response.json({ ok: false, message: "Local state is larger than the supported limit." }, { status: 413 });
  }

  const hasExpectedRevision = Boolean(body && typeof body === "object" && "expectedUpdatedAt" in body);
  if (scope === "workbench" && !hasExpectedRevision) {
    return Response.json(
      { ok: false, code: "REVISION_REQUIRED", message: "Workbench writes require the revision returned by the latest read." },
      { status: 428 }
    );
  }

  const rawExpectedUpdatedAt = hasExpectedRevision
    ? (body as { expectedUpdatedAt: unknown }).expectedUpdatedAt
    : undefined;
  if (rawExpectedUpdatedAt !== undefined && rawExpectedUpdatedAt !== null && typeof rawExpectedUpdatedAt !== "string") {
    return Response.json({ ok: false, message: "expectedUpdatedAt must be a string or null." }, { status: 400 });
  }

  try {
    const result = setLocalState(scope, value, rawExpectedUpdatedAt as string | null | undefined);
    return Response.json({ ok: true, ...result });
  } catch (error) {
    if (error instanceof LocalStateConflictError) {
      return Response.json(
        {
          ok: false,
          code: "STATE_CONFLICT",
          currentUpdatedAt: error.currentUpdatedAt,
          message: "Workbench data changed in another page. The stale snapshot was not saved.",
        },
        { status: 409 }
      );
    }
    throw error;
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  const scope = await readScope(context);
  if (!scope) return invalidScopeResponse();
  if (scope === "workbench") {
    return Response.json(
      { ok: false, code: "REVISION_REQUIRED", message: "Clear the workbench with a revision-checked replacement instead." },
      { status: 405 }
    );
  }
  return Response.json({ ok: true, deleted: clearLocalState(scope) });
}
