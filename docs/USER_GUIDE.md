# Ray Growth OS User Guide

[中文使用指南](USER_GUIDE.zh-CN.md) | [English README](../README.md)

This guide is for your first run of Ray Growth OS. Follow the **First run in five minutes** path once to see how the workbench turns public X discussions into an engagement queue, practical drafts, and feedback for the next round.

## Understand it in one sentence

Ray Growth OS is not an auto-posting or auto-DM tool.

It gives you a human-controlled workflow for public discussions: **define a goal → discover discussions → prioritize → prepare a draft → engage yourself → record the outcome → improve the next round.**

Think of it as a workbench for finding people, deciding how to engage, and learning from outcomes on public X discussions.

## First run in five minutes

You do not need to configure an API key for the first run. Start with the manual path, decide whether the workflow fits, then add automatic discovery or AI later.

### 1. Open the workbench

After starting the project locally, open `http://localhost:3001`.

The main navigation is:

| Page | What you do here | When to use it |
| --- | --- | --- |
| Overview | See the current queue and a suggested next action | When you want to know what to do now. |
| Find people | Define positioning, generate a search prompt, and import discussions | At the start of every discovery round. |
| Engagement queue | Prioritize, review drafts, open source posts, and record outcomes | During day-to-day execution. |
| Competitor insights | Find discussions around a competitor, KOL, or community account | When you need a different discovery angle. Optional. |
| Settings | Configure Grok and AI keys, models, request URLs, and a public X profile | When you want optional automated features. |

### 2. Define your positioning

Open **Find people** and complete the form on the left. Keep it concise, but specific.

Start with these five fields:

| Field | Question to answer | Example |
| --- | --- | --- |
| Account / product name | Who are you or what are you building? | `API Observe` |
| Growth goal | What do you want this interaction to achieve? | `Find early SaaS technical leads and validate observability pain` |
| Positioning | What value do you provide? | `Help small teams find API failures and slow requests` |
| Target audience | Who are you trying to reach? | `Technical leads and backend developers at newly launched SaaS products` |
| Topics / pain points | What problems will they discuss? | `API errors, alert noise, slow incident investigation, observability cost` |

The **Engagement goal / next step** and **Product / identity context** fields guide AI drafts. Use them to state:

- what a useful interaction should accomplish, for example, “share one diagnostic idea and invite a relevant follow-up”; and
- when product or identity context is relevant, plus any promises the draft must not make.

Do not write advertising copy. Concrete user situations and real pain points produce better discovery and better drafts.

### 3. Discover public discussions with Grok

The right side generates a Grok prompt from your positioning. Choose one path.

#### Path A: manual search (recommended for the first run)

1. Click **Copy prompt and open Grok**.
2. Run the search in Grok.
3. Copy the results back. One result per line in this format works best:

```text
X | author or account | post URL | concise summary + why it matters
```

4. Review the preview in Ray Growth OS, then click **Import results**.

You do not need to provide browser cookies or X credentials to the workbench.

#### Path B: automatic query (after configuration)

1. Open **Settings** and save a Grok/codeproxy key, model, and Messages-compatible request URL. The default is `https://codeproxy.dev/v1/messages`.
2. Return to **Find people** and click **Run automatic query**.
3. The workbench sends the current prompt through the proxy and parses reviewable structured signals.
4. Review the results before importing them.

Automatic discovery removes copy-paste. It does not replace your review of relevance, links, or whether a discussion is appropriate to engage with.

### 4. Decide what to do in the engagement queue

After import, open **Engagement queue**. Each item includes a source, score, recommended action, reason, and drafts.

Use this routine:

1. Start with recent, high-scoring items where the pain point is concrete.
2. Open the source post and verify the author and context are actually relevant.
3. Use a draft as a starting point and edit it with your own real experience.
4. Reply, quote, or follow up on X yourself.
5. Return to the queue and mark the processing status.

Draft types:

| Draft | Intended use |
| --- | --- |
| Direct reply | A reply under the source post. |
| Quote post | Your public point of view built from the discussion. |
| Content idea | Input for a later original post, thread, or article. |
| Private follow-up | Only for cases with clear need and a respectful reason to continue. |

The app never sends content automatically. Review every draft and remove unverified claims, promises, links, or generic sales language before posting.

### 5. Record observed outcomes

Once you process an item, mark it as replied, quoted, saved, deferred, or skipped. Add outcome feedback later when appropriate:

- got a reply;
- followed;
- reshared;
- no reply.

This is what turns the next round into a learning loop instead of another generic search.

### 6. Generate growth learning

After you have some processed items with feedback, use **Generate growth learning** in the engagement queue.

It summarizes:

- keywords and pain points worth prioritizing;
- signal patterns that repeatedly lead to no response;
- reply styles to reuse or avoid; and
- one specific next experiment.

Read the result first, then choose whether to **Apply growth learning**. It is a reversible prioritization hint: you can pause or clear it without changing the original data.

When new outcomes arrive, choose **Grow into the next round**. The app learns only feedback it has not processed before and revalidates related existing rules. Similar rules are merged; supported rules are strengthened; conflicting rules are downgraded or paused. The free edition activates at most 10 rules and never sends the complete learning history in every prompt, keeping context usage bounded over time.

## Optional capabilities

### AI scoring and drafts

After saving an AI Responses-compatible key, model, and request URL in **Settings**, you can use the features below. The default request URL is `https://codeproxy.dev/v1/responses`.

- AI positioning suggestions;
- AI semantic scoring;
- AI draft generation; and
- AI growth learning.

AI drafts follow each source post's language item by item. New discovery results store a concise source-language excerpt and a short language marker such as `en`; the interface language is used only when neither provides a reliable language. Reimporting the same URL can enrich an older record without overwriting its saved execution status or feedback.

Without an AI key, the workbench still has local ranking rules and starter drafts. You can validate the workflow first.

### Competitor insights

Use **Competitor insights** when you do not know what to search for, or want to discover people around an established account:

1. Enter a public X account URL for a competitor, industry KOL, community, or target user.
2. Click **Analyze account and generate signals**.
3. Review audience overlap, opportunity gaps, and suggested angles.
4. Import only external audience members, commenters, and related discussions. The target account itself should not become an engagement signal.

The flow uses only public information. It does not read DMs, dashboards, or non-public content.

### X Helper Chrome extension

The optional extension reduces manual feedback tracking after you reply on X.

Install it:

1. Keep the workbench open at `http://localhost:3001` or `http://127.0.0.1:3001`.
2. In Chrome, open `chrome://extensions/` and enable **Developer mode**.
3. Click **Load unpacked** and select `extension/ray-growth-os-x-helper`.
4. Save your public X profile in App Settings, or save your X handle once in the extension popup. The popup does not need to stay open.
5. Enter X through **Copy reply and open source post** in the workbench. The extension reads and associates that item automatically; no manual queue sync is needed.
6. Publish the reply yourself. Once it appears in the source conversation, the extension saves its URL and writes the replied status back automatically.
7. If capture was missed, stay on the source conversation and click **Recover reply on current page and write back**.
8. Only after a reply URL is recorded should you use **Inspect recorded reply links** to check later public feedback.

Note: **Inspect recorded reply links** cannot recover a reply URL that was never captured. Use the current-page recovery action first. After updating the project, reload the unpacked extension at `chrome://extensions/` and refresh existing App/X tabs.

The extension does not post for you, read DMs, bypass login, or call the paid X API. See the [extension README](../extension/ray-growth-os-x-helper/README.md) for implementation notes.

## Which configuration do you need?

| Goal | Key required? | Smallest setup |
| --- | --- | --- |
| Validate the workflow | No | Copy the prompt to Grok manually, then paste results back. |
| Query Grok automatically | Grok/codeproxy key | Configure Grok in Settings. |
| Use AI scoring, drafts, or positioning suggestions | AI model key | Configure the AI model in Settings. |
| Bring public X feedback back automatically | No API key, but Chrome extension required | Install X Helper. |

API settings and workbench state are stored in the computer's local SQLite database and shared by browsers using this local app. API keys are excluded from workbench JSON backups. The first upgrade migrates settings only; legacy workbench records are intentionally left behind so testing starts empty. Use server-side secret management before deploying for a team.

## Common questions

### Can I use it without an X account?

You can use importing, prioritization, drafts, and learning. The core discovery scenario analyzes public X discussions, while actual interaction and extension feedback require X.

### Why are my search results irrelevant?

Improve the positioning before adding many keywords. Better audience, specific pain points, and a clear value contribution produce better results. Then use the expanded prompt to add a few targeted terms if needed.

### Why are there no importable items?

The result may be duplicate, too vague, or filtered because it belongs to your own account or product. Try a more concrete pain point, or choose a closer public account in Competitor insights.

### Can I send AI drafts as-is?

No. Treat them as a first draft. Add your own real judgment and experience, and remove anything inaccurate, overpromising, or unrelated to the source post.

### Where does my data go?

Workbench state stays in the local SQLite database on this computer. When you use automatic Grok queries or AI, the request content is sent to your configured codeproxy/model provider. Never include DMs, credentials, or non-public customer data in a prompt.

### How do I back up or move data?

Use JSON backup and restore at the bottom of **Find people**. The backup includes workbench data and drafts, but not API keys or the saved X profile URL.

## Suggested operating rhythm

1. Update positioning, audience, and pain-point terms each week.
2. Import a small, high-quality batch instead of optimizing for volume.
3. Process a few highly relevant items each day and write real, useful replies.
4. Review outcomes each week, then generate and audit growth learning.
5. Use observed winning and losing patterns to adjust the next discovery round.

The point is not to generate more copy. A complete loop teaches you **who is worth engaging, what is useful to say, and where to look next.**
