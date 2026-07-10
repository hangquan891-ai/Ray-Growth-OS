# Ray Growth OS

Ray Growth OS 是一个面向独立开发者和创作者的 AI 增长工作台。当前优先目标不是做一个泛泛的导航站，而是先做一个 Ray 自己每天能用的 X 增长系统：把公开讨论、痛点和高意向问题转成可执行的回复、引用、选题和主动获客动作。

这份 README 也是项目交接文档。以后重新打开窗口时，先让 Codex 读取本文件，就能知道我们最终要做什么、已经做到哪一步、下一步该接着做什么。

## 最终目标

做成一个“创作者增长操作系统”：

1. 每天输入或抓取 X / Reddit / GitHub / Google 上的候选讨论。
2. 系统根据账号定位、目标读者、内容支柱和痛点自动生成搜索式。
3. 对每条讨论或线索进行评分，判断是否值得回复、引用、收藏观察或跳过。
4. 自动产出回复草稿、引用推文角度、长帖选题和主动获客私信草稿。
5. 后续接入账号、数据库和真实数据源，形成可持续的内容增长闭环。

长期形态可以变成一个对外产品，但当前阶段先服务 Ray 自己，用它来提升 X 内容质量、互动效率和粉丝增长。

## 当前产品定位

当前项目统一为一个“增长机会工作台”：围绕账号或产品定位发现值得处理的公开讨论，统一评分和排序，并同时生成直接回复、引用转发、内容选题和私下跟进草稿。原“受众增长 / 主动获客”的历史本地数据会合并进同一条机会流。

## 阶段路线图

### Phase 0：方向确认

状态：已完成。

我们已经明确不先做重运营的 agent / GitHub 收录目录，也不先做 AI 中转站导航站。当前选择是围绕 Ray 热帖方法论做一个能自用、能展示、能迭代的增长工作台。

### Phase 1：本地 MVP 页面

状态：已完成。

已完成内容：

- Next.js + Tailwind CSS 项目搭建。
- shadcn/ui 风格的本地 UI 组件基础，包括 Button、Card、Badge、Tabs、Input、Textarea、Label。
- 暗黑高级科技感主界面。
- 单一增长机会工作台，覆盖公开互动、内容延展和潜在客户跟进。
- 本地输入候选帖子或线索。
- 自动生成搜索式。
- 本地评分、排序、标签判断。
- 自动生成草稿。
- 复制搜索计划、复制草稿、导出 CSV。
- 中文界面作为主要使用语言。

### Phase 1.5：视觉和体验精修

状态：进行中，已完成大部分。

已完成内容：

- 深色背景、环境光、弱网格、玻璃拟态卡片。
- Hero 区域、步骤卡片、Signal Map、Copilot 卡片的暗黑科技风升级。
- 按钮 hover、active、上浮、发光反馈。
- 移动端和桌面端的基础响应式布局。
- Copilot 卡片已从白底修复为暗色半透明风格。

剩余建议：

- 继续把下方 InputPanel、Pipeline、SearchRadar、Queue 卡片统一成暗色玻璃风，避免出现白色模块割裂。
- 检查所有中文文案是否有乱码或表达不自然的地方。
- 做一次桌面和移动端截图验收。

### Phase 2：数据结构和持久化

状态：未开始。

目标：让它从“刷新即丢失的本地页面”变成真正可长期使用的工作台。

建议任务：

- 引入本地存储或数据库，保存账号定位、内容支柱、候选信号和历史草稿。
- 给每条信号加状态：未处理、已回复、已引用、已收藏、已跳过。
- 增加简单的筛选和搜索。
- 增加每日工作台视图：今天最该处理的 5 条信号。

### Phase 3：真实数据源

状态：未开始，已完成可行性审查。

目标：减少手动复制粘贴，让系统能半自动获得候选讨论。

可行性结论：能做，但要分层推进，不能押注某一个平台 API。Google Custom Search JSON API 不适合作为主线；Reddit 商业用途有审批和许可风险；X API 技术可行但有 token、额度和按量计费成本；GitHub Search API 是最适合优先接入的真实数据源。

建议任务：

- 先支持手动导入 CSV / 文本，并统一成 Signal 数据结构。
- 优先接入 xAI API 的 X Search 工具，作为第一个真实 X 数据源。
- GitHub Search API 保留为备用低风险数据源；X API Recent Search 暂不优先，除非 xAI X Search 结果不够稳定。
- Reddit 放到后置验证，个人自用可以尝试，产品化前必须重新确认许可。
- 每个来源都统一成同一种 Signal 数据结构。

详细审查见：`docs/phase-3-data-source-feasibility.md`。

补充：优先做官方 xAI API 的 X Search Connector。GitHub Search API 对公开资源检索不按请求收费，但先作为备用数据源；X 蓝 V/Grok 网页权益不等于免费程序化 API，正式接入走 `XAI_API_KEY` 或后续中转接口。

### Phase 4：AI 生成能力

状态：未开始。

目标：把当前规则生成草稿升级为真正的 AI Copilot。

建议任务：

- 接入 OpenAI API 或其他模型接口。
- 用账号定位、历史风格和信号上下文生成更像 Ray 的回复。
- 增加草稿版本：稳健版、犀利版、故事版、教程版。
- 增加“改写成中文 / 英文 / 中英混合”的能力。

### Phase 5：发布和增长闭环

状态：未开始。

目标：把工具本身变成可展示、可传播、可转化的内容资产。

建议任务：

- 做一个公开演示页面。
- 增加案例数据，让别人不用登录也能看懂价值。
- 写一条 X 长帖介绍构建过程和使用方法。
- 如果反馈好，再做登录、项目空间、付费或等待列表。

## 当前推荐下一步

下一步建议切到 P0：本地持久化和统一数据结构。

原因：页面现在已经够用，真正阻塞日常使用的是刷新会丢数据、导入信号没有结构化、没有处理状态和历史记录。

先完成本地持久化和 Signal Inbox，再做 LLM 评分器。视觉统一降到 P7，等核心功能闭环跑通后再处理。



## 待完成：LLM 评分器

状态：未开始，已确认为核心能力升级。

当前评分是本地关键词规则：命中目标读者、内容支柱、痛点词、链接等就加分。这个适合 MVP 粗筛，但不够理解上下文。

LLM 评分器的目标是让模型根据 Ray 的账号定位和候选帖子内容，判断这条讨论是否真的值得互动。建议使用“规则预筛 + LLM 精排”：先用本地规则从导入结果里筛出前 10-20 条，再用 LLM 做精细评分，降低成本和延迟。

建议评分维度：

- 目标用户匹配度：25 分。是否是独立开发者、AI Coding 用户、出海 SaaS 创始人等目标人群。
- 痛点强度：25 分。是否有明确问题，如 0 流量、第一批用户、验证需求、替代方案、SEO 太慢。
- 可回复价值：20 分。Ray 是否能自然给出经验、框架、观点，而不是硬蹭。
- 内容延展潜力：20 分。是否适合引用、长帖、教程或沉淀成内容资产。
- 互动时机和风险：10 分。是否新鲜、真实、低风险，是否像垃圾内容或容易引战。

建议结构化输出：

```json
{
  "score": 88,
  "label": "立即互动",
  "targetFit": 23,
  "painIntensity": 24,
  "replyValue": 18,
  "contentPotential": 17,
  "timingRisk": 6,
  "recommendedAction": "回复",
  "reason": "对方是 AI Coding 独立开发者，明确提到产品上线后 0 流量和第一批用户问题，与你的账号定位高度匹配。",
  "suggestedAngle": "先共情 0 流量，再给一个从 20 个同类用户问题里找第一批用户的具体方法。"
}
```

实现建议：

- 后端新增 `POST /api/score`，不要在前端暴露 API key。
- `.env.local` 配置 `OPENAI_API_KEY` 和 `OPENAI_SCORE_MODEL`。
- 默认模型可配置，例如 `OPENAI_SCORE_MODEL=gpt-5.5`，后续可换成更便宜的 mini/nano 或中转模型。
- 前端新增“AI 重新评分”按钮，只对当前队列前 10-20 条执行。
- LLM 返回后覆盖分数、理由、标签和推荐动作；失败时保留本地规则评分。

## 当前功能优先级

当前策略已经从“继续优化页面视觉”调整为“优先实现核心功能闭环”。在 P0-P4 完成前，不再优先做 UI 精修、复杂登录、服务端数据库或第三方 API 自动接入。

新的执行顺序：

1. P0 本地持久化和统一数据结构。
2. P1 Signal Inbox 导入箱。
3. P2 LLM 评分器。
4. P3 执行状态和每日队列。
5. P4 LLM 草稿生成器。
6. P5 反馈记录和复盘。
7. P6 真实数据源连接器。
8. P7 视觉统一和公开展示。

数据库结论：前期不做服务端数据库，不做账号登录，先用浏览器 `localStorage` 保存数据；如果数据量变大再升级 IndexedDB；等需要多设备同步或对外开放时再迁移服务端数据库。

详细路线见：`docs/function-priority-roadmap.md`。
## 2026-07-06 P0 进展

已完成 P0 的第一层基础：浏览器本地自动保存。

- 新增 `src/lib/workbench-state.js`：统一管理工作台快照版本、恢复、归一化和序列化。
- 新增 `test/workbench-state.test.mjs`：覆盖坏 JSON 兜底、残缺快照合并默认值、版本化保存。
- 首页已接入 `localStorage`，自动保存当前模式、两套表单内容、Grok 关键词和 Grok 粘贴结果。
- 刷新页面或重开本地页面后，会恢复上一次的账号定位、候选信号文本和 Grok 导入区内容。

P0/P1 交界已继续推进：当前已新增结构化 `Signal[]` 工具层、Grok 导入预览、URL/文本去重，并把结构化 signals 写入本地快照。剩余是 CSV 文件导入、更完整的 JSON 备份/恢复，以及后续执行状态存储。
## 2026-07-06 P1 进展

已完成 Signal Inbox 的第一层：结构化导入和去重。

- 新增 `src/lib/signals.js`：把 `X | 作者 | 链接 | 摘要`、简单 CSV 行解析为统一 `Signal` 数据结构。
- 新增 `test/signals.test.mjs`：覆盖 Signal 解析、URL 去重、导入预览统计、兼容现有评分输入格式。
- Grok 结果区新增 Signal Inbox 预览：显示解析数、可导入数、重复数，并预览前 3 条可导入 Signal。
- Grok 导入现在会按 URL 优先去重，没有 URL 时按平台、作者和文本去重。
- 本地快照新增 `signals` 字段，刷新后结构化导入数据不会丢。

P1 已补齐：CSV/手动导入入口和 JSON 备份/恢复已完成。下一步建议进入 P2 LLM 评分器。
2026-07-06 追加：P1 剩余项已完成。

- Signal Inbox 新增手动 / CSV 导入面板，支持粘贴 `X | 作者 | 链接 | 摘要`，也支持带表头 CSV，例如 `platform,author,url,text` 或乱序表头。
- CSV 表头解析已支持字段乱序和带逗号的 quoted cell。
- 新增 JSON 备份 / 恢复面板，可以把当前本地工作台导出为 `ray-growth-os-backup-YYYY-MM-DD.json`，也可以从 JSON 文件恢复。
- 备份恢复会校验 JSON，坏文件不会静默覆盖为默认数据。
## 本地 Grok Bridge

当前已加入一个本地自用的 Grok Bridge，用来在没有 xAI API key 的情况下先验证 X 线索雷达流程。

重要更新：x.ai / Grok 会拦截 Playwright 这类自动化浏览器，Cloudflare 可能直接显示 blocked。因此当前默认流程已经改成“普通浏览器打开 + 自动复制 Prompt”，不再默认启动自动化浏览器。

工作方式：

1. 页面里的“本地 Grok 雷达”会根据账号定位、目标读者、内容支柱和关键词生成 Grok Prompt。
2. 点击“复制并打开 Grok”会把 Prompt 复制到剪贴板，并用你当前的普通浏览器打开 `https://grok.com/`。
3. 在 Grok 页面粘贴 Prompt 并搜索。
4. 等 Grok 返回结果后，把结果复制回页面“Grok 结果”输入框，点击“导入结果”。
5. 导入后的信号会进入现有评分、排序和草稿生成流程。

安全边界：

- 不在页面收集 X token、cookie 或密码。
- 不读取你日常 Chrome / Edge 主 profile 的登录态。
- 不绕过验证码、风控或平台限制。
- 不再默认使用 Playwright 自动登录或自动提交 Grok 搜索。

相关文件：

- `src/app/api/grok/route.ts`：本地 Grok Bridge API。
- `src/lib/grok-bridge.ts`：Playwright persistent profile 自动化。
- `src/lib/grok-utils.ts`：Grok Prompt 生成和结果解析。
## 运行命令

开发环境：

```bash
npm run dev
```

当前开发端口固定为：

```text
http://localhost:3001
```

类型检查：

```bash
npm run typecheck
```

测试：

```bash
npm test
```

生产构建：

```bash
npm run build
```

## 重要文件

- `src/app/page.tsx`：主页面和所有工作台 UI。
- `src/app/globals.css`：全局暗黑主题、动效、玻璃拟态、环境光样式。
- `src/lib/outbound.js`：搜索式生成、评分、排序和草稿生成逻辑。
- `src/components/ui/*`：本地 shadcn/ui 风格组件。
- `test/outbound.test.mjs`：核心工作流测试。
- `package.json`：启动、构建、测试、类型检查脚本。

## 给下一次 Codex 的提示

如果要继续开发，建议先读：

1. `README.md`
2. `src/app/page.tsx`
3. `src/app/globals.css`
4. `src/lib/outbound.js`

请优先保持：

- 不破坏现有功能和按钮逻辑。
- 中文作为默认界面语言。
- 暗黑高级科技感视觉方向。
- 每次改完至少运行 `npm run typecheck`，涉及逻辑时运行 `npm test`，涉及页面发布时运行 `npm run build`。
## 2026-07-07 P2 进展：LLM 语义评分器

已完成 P2 第一版：规则评分仍然作为兜底，新增 AI 语义评分覆盖层。

- 新增 `src/lib/llm-scoring.js`：统一处理评分请求 payload、结构化输出 schema、OpenAI 响应解析、AI 分数归一化、结果覆盖和稳定 itemId。
- 新增 `src/app/api/score/route.ts`：服务端调用 OpenAI Responses API，不在前端暴露 API Key。
- 新增右侧「LLM 评分器」面板：点击「AI 重新评分」后，只对当前队列前 20 条信号做语义评分。
- AI 返回后会覆盖当前队列的分数、标签、理由和推荐动作，并写入 `localStorage` / JSON 备份里的 `aiScores` 字段。
- 如果没有配置 `OPENAI_API_KEY` 或接口失败，页面会提示错误，并保留本地规则评分。

本地启用方式：

```bash
cp .env.local.example .env.local
```

然后在 `.env.local` 填入：

```text
OPENAI_API_KEY=你的 OpenAI API Key
OPENAI_SCORE_MODEL=gpt-5.5
```

修改 `.env.local` 后需要重启 `npm run dev`，因为 Next.js 服务端环境变量只在服务启动时读取。

P2 后续建议：

1. 增加 AI 评分详情展开：展示 targetFit、painIntensity、replyValue、contentPotential、timingRisk 五个维度。
2. 增加“清除 AI 分数 / 回到规则评分”按钮。
3. 记录每次评分时间和模型，方便复盘成本与质量。
4. P3 再做执行状态：已回复、已引用、收藏、跳过。
## 2026-07-07 Grok 中转查询

已在「本地 Grok 雷达」里新增第二种获取信号的方式：codeproxy.dev 中转查询。

- 保留原来的「打开 Grok / 复制并打开 Grok」手动流程。
- 新增独立 `/settings` 设置页，用来配置 `codeproxy` / Grok 密钥和模型，默认模型为 `grok-4.3-fast`。
- 主工作台保留「中转查询」按钮：服务端调用 `https://codeproxy.dev/v1/messages`，查询期间会显示「Grok 查询中，请稍等」Loading 卡片。
- 查询完成后会先展示结果确认卡片，显示解析数、可导入数和重复数；用户点击「导入结果」后，复用现有 Signal 解析、去重、评分和草稿流程。
- 密钥只保存在当前浏览器 `localStorage` 的 `ray-growth-os:grok-proxy-config:v1`，不会进入 JSON 备份。

当前接入格式参考 NewAPI 的 Messages 接口：`Authorization: Bearer <token>`、`anthropic-version: 2023-06-01`、请求体包含 `model`、`messages`、`max_tokens`。
2026-07-07 追加：Grok 中转查询已升级为结构化结果优先。
- 服务端会把原 Grok 搜索 Prompt 包装成“只返回 JSON”的结构化请求。
- 期望返回 `signals[]`，字段包括 `platform`、`author`、`url`、`text`、`reason`、`tags`、`confidence`。
- `/api/grok` 会优先解析 JSON signals；解析成功时前端展示结构化确认卡片。
- 如果 Grok 返回普通文本或坏 JSON，会自动回退到原来的文本解析，不中断导入流程。
- 本地 `Signal` 结构现在会保留可选的 `reason` 和 `confidence`，并继续兼容原来的文本/CSV 导入。
## 2026-07-07 P3.1 进展：Signal 执行状态

已完成第一层执行闭环：Ray Growth OS 仍然不自动发帖、不自动回复，而是作为线索雷达和回复 Copilot，帮助用户自己执行。
- 队列卡片新增「打开原帖」和「复制触达/复制回复」操作。
- 每条 Signal 可以标记状态：待处理、已回复/已触达、已引用、已收藏、跳过。
- 状态会写入当前模式的 `signals`，并随 `localStorage` 和 JSON 备份保存。
- 状态更新会记录 `processedAt` 和 `processedAction`，后续可用于每日处理量和反馈复盘。
- 原来的文本/CSV/Grok 导入仍然兼容，导入去重时会保留执行状态元数据。

下一步建议：P3.2 每日 Top 5 队列，只展示仍待处理、分数最高的 5 条，让每天打开页面就知道先处理什么。
## 2026-07-07 P3.2 进展：每日 Top 5 队列

已完成每日优先处理队列。
- 主工作台新增「今日队列」卡片，位于完整队列上方。
- 自动筛选当前模式下仍为 `new` / 待处理的 Signal，并取分数最高的前 5 条。
- 今日队列复用同一套执行控件：打开原帖、复制草稿、标记已回复/已引用/已收藏/跳过。
- 一旦标记为已处理或跳过，该条会自动从今日队列消失，但仍保留在完整队列和本地状态里。

下一步建议：P3.3 做处理统计和复盘，例如今日已处理数量、跳过数量、收藏数量，以及后续反馈字段。
## 2026-07-07 P3.3 进展：处理统计和复盘

已完成轻量执行复盘面板。
- 主工作台新增「执行复盘 / 今天处理进度」卡片。
- 展示今日已处理数、仍待处理数、收藏观察数、跳过数和当前队列完成率。
- 最近处理记录会按 `processedAt` 倒序展示最近 5 条，并保留状态、处理时间、作者、摘要和原帖入口。
- 统计完全基于本地 `signals` 的 `status`、`processedAt`、`processedAction`，不依赖账号、数据库或 GPT 配置。

下一步建议：P3.4 增加反馈字段，例如有回复、无回复、被关注、被转发，用来反哺后续评分器。
## 2026-07-07 P3.4 进展：互动反馈字段

已完成执行闭环的反馈记录层。
- 队列卡片在 Signal 标记为已处理后，会显示「反馈结果」按钮：有回复、无回复、被关注、被转发、清除。
- 反馈会写入当前模式的 `signals`，字段为 `feedback` 和 `feedbackAt`，并随 `localStorage` 与 JSON 备份保留。
- 复盘面板新增「正反馈」和「无回复」统计，并在最近处理记录中显示反馈 Badge。
- CSV / 结构化 Grok / JSON 备份恢复都会保留反馈字段，已有测试覆盖。

下一步建议：P3.5 做复盘输入和筛选，例如按「有回复 / 无回复 / 被关注」过滤队列，再把这些反馈作为后续 AI 评分器的训练信号。
## 2026-07-07 P3.5 进展：反馈筛选复盘

已完成反馈结果的本地复盘视图。
- 主工作台新增「反馈复盘」卡片，位于执行复盘和今日队列之间。
- 支持按「全部反馈 / 有回复 / 无回复 / 被关注 / 被转发」筛选已记录反馈的 Signal。
- 每条记录展示反馈 Badge、执行状态、反馈时间、平台、作者、摘要和原帖入口。
- 新增「复制复盘摘要」按钮，可以把当前筛选结果整理成文本，方便后续喂给 AI 总结话题、回复角度和转化信号。
- 该功能完全基于本地 `signals.feedback` / `signals.feedbackAt`，不新增数据库、不依赖登录、不调用 GPT。

下一步建议：P3.6 做回复/引用草稿的版本记录与人工改写字段，让系统不只知道「有没有反馈」，还知道「哪种话术带来了反馈」。
## 2026-07-07 P3.6 进展：实际采用话术记录

已完成执行闭环里的“话术版本”记录层。
- Signal 数据结构新增 `usedDraft` / `usedDraftAt`，用于保存用户实际采用或改写后的回复内容。
- 队列卡片在 Signal 标记为已处理后，会显示“实际采用话术”输入区，可一键使用生成草稿、保存改写版本或清除记录。
- 真实话术会写入当前模式的 `signals`，并随 `localStorage`、JSON 备份、CSV/结构化导入兼容保留。
- 反馈复盘面板会展示每条 Signal 的实际话术，复制复盘摘要时也会带上这段内容，方便后续喂给 AI 分析“什么话术带来正反馈”。

下一步建议：P3.7 做“复盘数据导出 / 喂给 LLM 总结”的入口，把反馈、状态、实际话术整理成可直接提交给 AI 的学习样本；之后再进入 P4 LLM 草稿生成器。
## 2026-07-07 P3.7 进展：AI 复盘样本包

已完成把反馈闭环整理成可喂给 AI 的结构化样本包。
- `src/lib/signals.js` 新增 `buildFeedbackLearningPack`，会把有反馈的 Signal 整理为 Prompt + JSON 数据包。
- 样本包包含 `originalSignal`、执行状态、反馈结果、实际采用话术、标签、来源、理由和置信度。
- 反馈复盘面板新增「复制 AI 样本包」按钮，当前筛选条件下的样本可以一键复制给 GPT / Grok 做复盘。
- 面板新增当前样本数、带真实话术数、正反馈/无回复数，方便判断样本是否足够进入复盘。
- 已补测试，确保样本包会保留反馈、实际话术和统计字段。

下一步建议：进入 P4 LLM 草稿生成器。先不自动发帖，只让系统基于 Signal、账号定位和历史正反馈话术生成更像 Ray 的回复/引用草稿。
## 2026-07-07 P4 进展：LLM 草稿生成器

已完成 P4 第一版：AI 只生成草稿，不自动发布、不自动回复。
- 新增 `src/lib/llm-drafts.js`：负责构建草稿生成 payload、OpenAI structured output schema、返回归一化、草稿覆盖逻辑。
- 新增 `src/app/api/drafts/route.ts`：服务端调用 OpenAI Responses API，读取 `OPENAI_API_KEY`，前端不暴露密钥。
- 工作台新增「LLM 草稿生成器」面板：基于当前队列、账号定位和历史正反馈实际话术，生成前 10 条信号的 AI 草稿。
- 新增本地 `aiDrafts` 覆盖层：AI 草稿会保存到 `localStorage` / JSON 备份，并覆盖队列展示、复制草稿和 CSV 导出；未配置 API key 时保留本地规则草稿。
- Growth 模式会生成 `replyDraft`、`quoteDraft`、`postIdea`；Outbound 模式会生成 `draft`。
- 已补 `test/llm-drafts.test.mjs` 和 workbench-state 测试，确保草稿生成、覆盖、备份恢复都稳定。

本地启用方式：继续使用 `.env.local` 里的 `OPENAI_API_KEY`；可选增加 `OPENAI_DRAFT_MODEL`，未配置时会回退到 `OPENAI_SCORE_MODEL`，再回退到 `gpt-5.5`。

下一步建议：P4.1 做单条 Signal 的「重新生成 / 复制 AI 解释 / 清除 AI 草稿」细粒度控制，避免每次都批量覆盖。
