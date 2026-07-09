# Grok Bridge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a local-only Grok Bridge that opens Grok with a dedicated persistent browser profile, generates/searches prompts, and imports returned text into the existing Ray Growth OS scoring workflow.

**Architecture:** The frontend owns prompt configuration and import UI. A Next.js Node route calls a local Playwright helper that opens Grok in a visible persistent browser profile under `.local/grok-profile`. The helper never reads user Chrome cookies, never accepts X cookies/tokens, and falls back to manual paste when automated result extraction is unreliable.

**Tech Stack:** Next.js App Router, React, Tailwind CSS, `playwright-core`, local Edge/Chrome channel, existing `runGrowthWorkflow` / `runOutboundWorkflow`.

---

### Task 1: Add Local Automation Dependency

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`

- [ ] Install `playwright-core` so the project can automate an already installed local browser without downloading browser binaries.

Run: `npm install playwright-core`
Expected: package installed and lockfile updated.

### Task 2: Add Grok Bridge Server Helper

**Files:**
- Create: `src/lib/grok-bridge.ts`

- [ ] Implement `openGrokBridge(prompt?: string)`.

Behavior:
- Uses `playwright-core` lazy import.
- Launches persistent context at `.local/grok-profile`.
- Opens `https://grok.com/`.
- If prompt is provided, tries to fill a textarea/contenteditable input and press Enter.
- Returns structured status: `ok`, `loginRequired`, `manualRequired`, `error`.
- Does not read external browser profiles or cookies.

### Task 3: Add Grok Bridge API Route

**Files:**
- Create: `src/app/api/grok/route.ts`

- [ ] Implement `POST /api/grok` with actions:
  - `{ action: "open" }` opens Grok login/profile.
  - `{ action: "search", prompt: string }` opens Grok and submits prompt when possible.

Expected response JSON:

```json
{
  "ok": true,
  "status": "opened",
  "message": "Grok 已打开。首次使用请在浏览器里登录。"
}
```

### Task 4: Add Frontend Grok Bridge Panel

**Files:**
- Modify: `src/app/page.tsx`

- [ ] Add local state for trigger keywords and Grok result text.
- [ ] Generate a Chinese Grok search prompt from current account/product profile.
- [ ] Add buttons:
  - `打开 Grok 登录`
  - `自动打开搜索`
  - `复制 Prompt`
  - `导入结果`
- [ ] Import result by appending parsed text to current `leadInput`, keeping existing scoring logic unchanged.

### Task 5: Document Usage and Verify

**Files:**
- Modify: `README.md`
- Modify: `docs/phase-3-data-source-feasibility.md`

- [ ] Document Grok Bridge as local-only MVP path.
- [ ] Run `npm run typecheck`.
- [ ] Run `npm test`.
- [ ] Run `npm run build`.