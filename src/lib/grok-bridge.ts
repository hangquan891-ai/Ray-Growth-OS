import { mkdir } from "node:fs/promises";
import path from "node:path";

import type { BrowserContext, Locator, Page } from "playwright-core";

export type GrokBridgeStatus = "opened" | "submitted" | "manualRequired" | "error";

export type GrokBridgeResult = {
  ok: boolean;
  status: GrokBridgeStatus;
  message: string;
};

let activeContext: BrowserContext | null = null;
let launchPromise: Promise<BrowserContext> | null = null;

export async function openGrokBridge(prompt?: string): Promise<GrokBridgeResult> {
  try {
    const context = await getContext();
    const page = await getOrCreatePage(context);

    await page.bringToFront();
    await page.goto("https://grok.com/", { waitUntil: "domcontentloaded", timeout: 60000 });

    const cleanPrompt = String(prompt ?? "").trim();
    if (!cleanPrompt) {
      return {
        ok: true,
        status: "opened",
        message: "Grok 已打开。首次使用请在弹出的浏览器里手动登录，登录态会保存在 .local/grok-profile。",
      };
    }

    await page.waitForTimeout(1500);
    const composer = await findComposer(page);
    if (!composer) {
      return {
        ok: true,
        status: "manualRequired",
        message: "Grok 已打开，但没有找到可输入的对话框。请确认已登录，然后手动粘贴 Prompt。",
      };
    }

    await composer.click({ timeout: 5000 });
    const filled = await fillComposer(page, composer, cleanPrompt);
    if (!filled) {
      return {
        ok: true,
        status: "manualRequired",
        message: "Grok 已打开，但自动填入 Prompt 失败。请手动粘贴 Prompt。",
      };
    }

    await page.keyboard.press("Enter");
    return {
      ok: true,
      status: "submitted",
      message: "已把 Prompt 提交到 Grok。等结果生成后，把结果复制回页面导入。",
    };
  } catch (error) {
    return {
      ok: false,
      status: "error",
      message: error instanceof Error ? error.message : "Grok Bridge 启动失败。",
    };
  }
}

async function getContext() {
  if (activeContext) return activeContext;
  if (!launchPromise) launchPromise = launchContext();
  activeContext = await launchPromise;
  activeContext.on("close", () => {
    activeContext = null;
    launchPromise = null;
  });
  return activeContext;
}

async function launchContext() {
  const { chromium } = await import("playwright-core");
  const profileDir = path.join(process.cwd(), ".local", "grok-profile");
  await mkdir(profileDir, { recursive: true });

  const errors: string[] = [];
  for (const channel of ["chrome", "msedge"] as const) {
    try {
      return await chromium.launchPersistentContext(profileDir, {
        channel,
        headless: false,
        viewport: null,
        args: ["--start-maximized"],
      });
    } catch (error) {
      errors.push(`${channel}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  throw new Error(`没有找到可用的 Edge/Chrome 浏览器。请先安装 Microsoft Edge 或 Chrome。详情：${errors.join(" | ")}`);
}

async function getOrCreatePage(context: BrowserContext) {
  const existing = context.pages().find((page) => !page.isClosed());
  return existing ?? context.newPage();
}

async function findComposer(page: Page): Promise<Locator | null> {
  const selectors = [
    "textarea",
    "[contenteditable='true']",
    "[role='textbox']",
    "div.ProseMirror",
  ];

  for (const selector of selectors) {
    const locator = page.locator(selector);
    const count = await locator.count().catch(() => 0);
    for (let index = count - 1; index >= 0; index -= 1) {
      const candidate = locator.nth(index);
      if (await candidate.isVisible().catch(() => false)) return candidate;
    }
  }

  return null;
}

async function fillComposer(page: Page, composer: Locator, prompt: string) {
  try {
    await composer.fill(prompt, { timeout: 5000 });
    return true;
  } catch {
    try {
      await page.keyboard.insertText(prompt);
      return true;
    } catch {
      return false;
    }
  }
}