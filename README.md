# Ray Growth OS

[中文文档](README.zh-CN.md) | **English**

An open-source, local-first AI growth workbench for turning public X discussions into a repeatable workflow: discover, review, prioritize, draft, execute, and learn.

中文界面默认可用；切换器提供 English UI and makes AI-generated positioning, scoring rationale, drafts, and learning output follow the selected language.

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

Prerequisites: a current Node.js LTS release and npm.

```bash
npm install
npm run dev
```

Open [http://localhost:3001](http://localhost:3001).

The default example is intentionally generic. Replace it with your own product or account positioning before searching.

### Optional AI configuration

Open **Settings** in the app to configure:

- a Grok/codeproxy key and model for automatic public-discussion discovery and competitor insights;
- an AI Responses-compatible key and model for positioning suggestions, semantic scoring, drafts, and learning;
- an optional public X profile URL used to create an editable positioning draft.

For this local MVP, these settings are stored in the current browser's `localStorage`; they are not included in a workbench JSON backup. Do not use this storage model unchanged for a multi-user deployment. Move keys to a server-side secret manager before hosting the app for others.

`.env.local.example` documents optional server-side fallback variables for the AI routes. Browser settings remain the simplest local-development path.

## Commands

```bash
npm run dev        # start Next.js on port 3001
npm run typecheck  # TypeScript checks
npm test           # unit tests
npm run build      # production build
```

## Internationalization

- Default locale: Simplified Chinese (`zh-CN`)
- Additional locale: English (`en`)
- The selected locale is persisted in `ray-growth-os:locale:v1`.
- The navigation, positioning flow, discovery choices, settings, and generated-model language are localized. Existing user-entered content and imported source posts are intentionally left unchanged.

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
