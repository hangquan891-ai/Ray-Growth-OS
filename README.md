# Ray Growth OS

[中文文档](README.zh-CN.md) | **English**

An open-source, local-first AI growth workbench for turning public X discussions into a repeatable workflow: discover, review, prioritize, draft, execute, and learn.

中文界面默认可用；切换器提供 English UI and makes AI-generated positioning, scoring rationale, drafts, and learning output follow the selected language.

> First time here? See the step-by-step [user guide](docs/USER_GUIDE.md). A [Chinese guide](docs/USER_GUIDE.zh-CN.md) is also available.

> Status: local MVP. It is designed for individual builders and small teams validating a workflow, not as a hosted CRM or an autonomous outreach bot.

## What it does

```text
Positioning
  → public-discussion discovery (manual Grok or proxy query)
  → import and deduplicate signals
  → local + AI prioritization
  → reply / quote / post idea / optional follow-up drafts
  → execution and outcome tracking
  → reusable growth learning for the next batch
```

- Define the product or account, target audience, topics, and engagement policy.
- Generate a public X discovery prompt from that positioning.
- Use one of two discovery paths:
  - Manual: copy the prompt to Grok, then paste results back.
  - Automatic: query through a user-configured Grok/codeproxy connection and review structured results before import.
- Use **Competitor insights** to inspect a public competitor, KOL, community, or target-user account and find relevant external discussion around its audience.
- Rank the queue with local heuristics and optionally an AI model.
- Generate source-specific reply, quote-post, content-idea, and optional follow-up drafts.
- Record execution and feedback, then convert observed outcomes into reversible ranking and writing rules.

## Data sources and boundaries

Ray Growth OS does **not** bundle a proprietary lead database or silently crawl private accounts.

| Input | How it enters the workbench | Notes |
| --- | --- | --- |
| Public X discussions | Manual paste from Grok or proxy query | Review before importing; URLs are never fabricated by the structured prompt. |
| Public X account context | Competitor-insight flow | Reads only publicly available profile/page material; it does not read DMs or private analytics. |
| CSV or pasted rows | Signal import | Useful for data from another compliant source. |
| Execution outcomes | Manually marked or extension-synced feedback | Used only to adjust the next batch locally. |

Discovery quality depends on the positioning, the configured model, and public-source availability. Treat all AI suggestions as drafts; verify relevance, claims, links, and platform-policy compliance before posting.

## Quick start

Prerequisites: Node.js 22.5 or newer and npm. The app uses Node's built-in SQLite support, so no separate database service is required.

```bash
npm install
npm run dev
```

Open [http://localhost:3001](http://localhost:3001).

The workbench starts empty. Add your own product or account positioning before searching.

### Optional AI configuration

Open **Settings** in the app to configure:

- a Grok/codeproxy key and model for automatic public-discussion discovery and competitor insights;
- an AI Responses-compatible key and model for positioning suggestions, semantic scoring, drafts, and learning;
- an optional public X profile URL used to create an editable positioning draft.

Settings and new workbench data are stored in a local SQLite database, so browsers on the same computer and port share one copy. On the first upgrade, the app migrates only the existing Grok, AI, and X profile settings from the current browser. It deliberately does not migrate legacy positioning, queues, scores, drafts, feedback, or growth memory, giving existing users a clean workbench for retesting.

The database is stored at `%LOCALAPPDATA%\RayGrowthOS\ray-growth-os.db` on Windows, `~/Library/Application Support/RayGrowthOS/ray-growth-os.db` on macOS, and `$XDG_DATA_HOME/ray-growth-os/ray-growth-os.db` (or `~/.local/share/ray-growth-os/`) on Linux. Set `RAY_GROWTH_OS_DATA_DIR` to override the directory.

This remains a local single-user security model: API keys are stored locally and are excluded from workbench JSON backups, but they are not protected by a hosted secret manager. Move keys to server-side secret management before deploying the app for multiple users.

`.env.local.example` documents optional server-side fallback variables for the AI routes. The in-app Settings page remains the simplest local-development path.

## Commands

```bash
npm run dev        # start Next.js on port 3001
npm start          # run a completed production build on port 3001
npm run typecheck  # TypeScript checks
npm test           # unit tests
npm run build      # production build
```

## Internationalization

- Default locale: Simplified Chinese (`zh-CN`)
- Additional locale: English (`en`)
- The selected locale is persisted in `ray-growth-os:locale:v1`.
- The navigation, positioning flow, discovery choices, settings, and generated-model language are localized. Existing user-entered content and imported source posts are intentionally left unchanged.

## Optional Chrome extension: X Helper

The bundled **Ray Growth OS X Helper** closes the feedback loop after a human has replied on X. It is optional: the workbench works without it, and you can always record outcomes manually.

### What it does

1. Reads the local engagement queue from an open workbench tab.
2. Associates an X source post with the reply you send yourself.
3. Saves the public URL of that reply when it is visible on the X page.
4. Checks public interaction outcomes and writes the result back to the local workbench.

It does **not** publish replies, read DMs, bypass login, or call the paid X API.

### Install locally (developer mode)

1. Start the workbench and keep it open at `http://localhost:3001` or `http://127.0.0.1:3001`.
2. In Chrome, open `chrome://extensions/` and enable **Developer mode**.
3. Select **Load unpacked**.
4. Choose [`extension/ray-growth-os-x-helper`](extension/ray-growth-os-x-helper).
5. Pin **Ray Growth OS X Helper** if you want quick access to its popup.

### Use it

1. Open the extension popup and save your X handle (the part after `@`), or configure your public X profile in the app.
2. Click **Read queue from App** in the popup.
3. Open a source post from the workbench and reply on X yourself.
4. Once the reply is visible in the source conversation, the extension writes it back automatically. If capture is missed, use **Recover reply on current page and write back**.
5. Use **Inspect recorded reply links** only after the reply URL has been saved, to check later public feedback.

The inspection action cannot recover a reply URL that was never captured. After extension code changes, reload the unpacked extension at `chrome://extensions/` and refresh existing App/X tabs.
5. Keep the workbench tab open and use **Write pending feedback to App** if an update was stored while the app was unavailable.

The extension relies on public X page DOM and may need maintenance after X UI changes. For its Chinese, implementation-focused notes, see [the extension README](extension/ray-growth-os-x-helper/README.md).

## Prompt design

The built-in prompts are deliberately operational rather than promotional:

- use only supplied or public context;
- do not invent intent, metrics, URLs, private data, offers, or outcomes;
- keep structured output schema-only;
- distinguish observed feedback from a hypothesis;
- use the selected interface language for narrative output;
- treat identity/product context as a disclosure rule, not permission to write sales copy.

## Project structure

```text
src/app/page.tsx                 Main workbench UI
src/app/settings/page.tsx        Local connection and profile settings
src/app/api/*                    Grok and AI proxy routes
src/lib/grok-utils.ts            Discovery-prompt builder and parser
src/lib/llm-*.js                 Structured scoring, draft, profile, and learning prompts
src/lib/signals.js               Signal normalization, import, feedback-review pack
src/lib/workbench-state.ts       Local state, migration, backup, and restore
test/*.test.mjs                  Unit tests
extension/ray-growth-os-x-helper Optional X feedback helper
```

## Contributing

1. Create a focused branch.
2. Keep generated or sample data out of commits.
3. Run `npm run typecheck`, `npm test`, and `npm run build` before opening a pull request.
4. For changes to a prompt, add or update a unit test that protects its safety boundary or output contract.

Useful contribution areas include more compliant data connectors, server-side key management, team workspaces, outcome attribution, additional locales, and accessibility improvements.

## Security and responsible use

- Never paste private messages, credentials, or non-public customer data into a prompt.
- Follow X and every data provider's terms, rate limits, and consent requirements.
- Review every generated message before sending it. This project should assist human outreach, not automate spam.
- Backups may contain workbench data and drafts. Store exported JSON files carefully.

## License

A license has not been selected in this repository yet. Choose and add one (for example MIT or Apache-2.0) before publishing or accepting external contributions.
