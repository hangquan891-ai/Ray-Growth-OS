# Phase 3 真实数据源可行性审查

审查日期：2026-07-06

结论：Phase 3 可以做，但要改成“分层数据接入”，不能押注某一个平台的官方 API 一定便宜、稳定、可商用。

最稳妥路线：先做 CSV / 文本导入和统一 Signal 数据结构，再做 GitHub 官方 API。X 和 Reddit 可以做成可选连接器，但不要作为 MVP 的唯一关键路径。

## 总体判断

| 数据源 | 可行性 | 建议优先级 | 主要风险 |
| --- | --- | --- | --- |
| 手动文本 / CSV 导入 | 高 | P0 | 无外部依赖 |
| GitHub Search API | 高 | P1 | 搜索限流、查询长度限制 |
| X API Recent Search | 中 | P2 | 需要开发者账号、token、按量计费、只覆盖近 7 天 |
| Reddit Data API | 中低 | P3 | 需要审批，商业用途需要许可或合同，政策限制较多 |
| Google Custom Search JSON API | 低 | 不建议作为主线 | 对新客户关闭，现有客户 2027-01-01 前迁移 |
| 网页抓取 / 浏览器模拟 | 低 | 不建议 | 不稳定、合规风险高、容易被平台限制 |

## 官方信息摘录和判断

### X API

官方 Search Posts 文档显示，Recent Search 可以搜索最近 7 天的帖子，官方写明 available to all developers；Full-Archive Search 需要 pay-per-use 或 Enterprise。Recent Search 单请求最多 100 条，query 长度 512 字符。

官方 Rate Limits 文档显示，`GET /2/tweets/search/recent` 限制为 app 级 450 次 / 15 分钟、user 级 300 次 / 15 分钟。官方 Usage and Billing 文档显示 X API v2 是 pay-per-usage，按 app 级使用量计费，定价需要在 Developer Console 看，且读取到的 posts 会计入使用量。

判断：技术上能做，适合做“用户自己配置 token + 成本上限 + 缓存去重”的连接器。不适合作为免费 MVP 的唯一数据来源。

官方来源：

- https://docs.x.com/x-api/posts/search/introduction
- https://docs.x.com/x-api/fundamentals/rate-limits
- https://docs.x.com/x-api/fundamentals/post-cap

### GitHub Search API

GitHub 官方 REST Search 文档显示，可以搜索 GitHub 上的 issues、repositories、code、users 等资源。搜索 API 有独立限流：未认证请求 10 次 / 分钟，认证请求一般 30 次 / 分钟；code search 另有限制。Search API 每个搜索最多返回 1000 条结果，并有查询长度和布尔操作符限制。

判断：最适合作为第一个真实数据源。对我们的场景，可以优先搜索 issues / discussions / repositories 中包含 “AI coding”“SaaS”“first users”“traffic”等关键词的公开内容，然后转成统一 Signal。

官方来源：

- https://docs.github.com/en/rest/search/search

### Reddit Data API

Reddit 官方 API 文档中存在 `[/r/subreddit]/search`，支持 q 查询、limit 最多 100。Reddit 帮助中心说明 Data API 面向 approved developers；商业用途不能直接使用，需要 Reddit 许可，商业用途包括订阅服务、带广告/付费墙的移动应用、收费数据访问等。Reddit 也明确 Data API 有 rate limits，并且不能把 Reddit 内容用于训练大语言模型 / AI 模型，除非有明确授权。

判断：个人自用或非商业实验可以后置尝试，但如果未来做成公开产品或付费产品，Reddit 不能默认视为免费可用数据源。应设计为可选连接器，并在产品化前重新确认许可。

官方来源：

- https://www.reddit.com/dev/api/
- https://support.reddithelp.com/hc/en-us/articles/14945211791892-Developer-Platform-Accessing-Reddit-Data
- https://redditinc.com/policies/data-api-terms

### Google Custom Search JSON API

Google 官方文档显示，Custom Search JSON API 能返回 web / image 搜索结果，需要 Programmable Search Engine 和 API key。但文档也明确写到该 API 对新客户关闭，现有客户需要在 2027-01-01 前迁移。官方建议替代方案包括 Vertex AI Search，适合最多 50 个域名的搜索。

判断：不要把 Google Custom Search JSON API 写进主线实现。若需要“公开网页搜索”，应该做 provider 抽象，后续按成本选择 Vertex AI Search、Tavily、Exa、SerpAPI 或其他搜索服务。

官方来源：

- https://developers.google.com/custom-search/v1/overview


## GitHub 免费性与 Grok/X API 说明

GitHub Search API 对公开资源检索不按请求收费，适合先做真实 API 验证。限制主要是限流和查询限制：GitHub 官方文档写明未认证搜索请求 10 次 / 分钟，认证请求一般 30 次 / 分钟；每个搜索最多返回 1000 条结果，并且查询长度和布尔操作符数量有限制。因此它不是“无限免费”，但足够做个人 MVP 和低频信号发现。

X 蓝 V / X Premium 能使用 Grok，不等于可以免费调用 X API Recent Search。Grok 是 X/xAI 的聊天产品；程序化接入一般走 xAI API 或 X API，两者都需要单独的 API key / token。xAI 官方文档显示 API 入口需要 `XAI_API_KEY`，并提供 Purchase credits；X 官方文档显示 X API v2 是 pay-per-usage，Recent Search 读取到的 posts 会计入使用量。因此蓝 V 可以帮我们手动用 Grok 找话题、总结搜索结果，但不能替代后端稳定拉取 X 数据的 API 接入。

更新后的建议：如果只考虑真实 API 的工程验证，先做 GitHub；如果只考虑 Ray 的实际增长价值，可以并行做一个“Grok 辅助手动导入”流程，即让用户把 Grok 搜到的帖子/链接粘贴进系统，再由 Ray Growth OS 负责评分、排序和草稿生成。
## 推荐的 Phase 3 新拆法

### Phase 3A：统一 Signal 数据结构 + 导入层

优先做，无外部风险。

Signal 建议结构：

```ts
type Signal = {
  id: string;
  source: "manual" | "csv" | "github" | "x" | "reddit" | "search";
  sourceId?: string;
  platform: string;
  url?: string;
  author?: string;
  title?: string;
  text: string;
  publishedAt?: string;
  metrics?: {
    likes?: number;
    replies?: number;
    reposts?: number;
    comments?: number;
    stars?: number;
  };
  raw?: unknown;
  ingestedAt: string;
  status: "new" | "queued" | "replied" | "quoted" | "saved" | "skipped";
};
```

### Phase 3B：CSV / 文本导入

把当前 textarea 输入升级成导入器：

- 粘贴文本继续支持。
- 支持 CSV 上传。
- 解析后统一进入 Signal 列表。
- 做去重：优先按 url，其次按 source + sourceId，其次按 text hash。

### Phase 3C：GitHub Connector

第一个真实 API 连接器：

- 使用 GitHub Search Issues / Repositories。
- 支持 token 可选；无 token 时低频可用，有 token 时额度更高。
- 每次只拉少量结果，缓存到本地数据库。
- 先搜索公开 issues / discussions / repos，不碰私有仓库。

### Phase 3D：X Connector

第二个真实 API 连接器：

- 只做 Recent Search，不做全量历史搜索。
- 使用用户自己的 Bearer Token。
- 加每日预算和请求上限。
- 必须缓存和去重，避免重复计费。
- 页面明确显示“这会消耗 X API 配额 / 费用”。

### Phase 3E：Reddit Connector

后置可选：

- 个人自用时可以试非商业 Data API。
- 产品化或商业用途前必须重新确认 Reddit 许可。
- 只保存链接、标题、少量摘要和评分结果，不做大规模复制或训练数据积累。

## 关键架构建议

不要让业务逻辑直接依赖某个平台 API。应该做统一连接器接口：

```ts
type SignalConnector = {
  source: Signal["source"];
  search(input: {
    query: string;
    limit?: number;
    since?: string;
  }): Promise<Signal[]>;
};
```

所有来源先转成 `Signal[]`，再进入现有评分、排序、草稿生成流程。


## 2026-07-06 更新：优先做 xAI X Search Connector

新的优先级：先做方案 B，也就是基于官方 xAI API 的 `x_search` 工具做线索雷达，而不是先接 GitHub，也不是自动化打开 Grok 网页。

原因：xAI 官方文档显示 `X Search` 工具可以让 Grok 在 X 上做 keyword search、semantic search、user search 和 thread fetch，并且支持 OpenAI Responses API 兼容调用。调用方式是服务端请求 `https://api.x.ai/v1/responses`，携带 `XAI_API_KEY`，并在 tools 里传 `{ "type": "x_search" }`。

这条路线最贴近 Ray Growth OS 的真实目标：我们要找 X 上值得回复、引用和转粉的帖子，而不是先找 GitHub issue。GitHub Search API 仍然保留为备用低风险数据源，但不再是第一优先级。

安全和架构要求：

- API key 不放在前端页面源码里。
- 本地开发阶段可以使用 `.env.local` 的 `XAI_API_KEY`。
- 如果一定要在页面输入 token，只能作为本地/个人模式，不能明文持久化到前端 localStorage；产品化时必须放服务端加密存储。
- 不使用 X cookie、浏览器登录态或自动化控制 Grok 网页。
- 接口层必须做 provider 抽象，后续可以换成中转接口或其他 Grok API proxy。

推荐实现顺序：

1. 新建服务端 API：`POST /api/signals/search`。
2. 请求参数包括关键词、目标用户、内容支柱、时间范围、最大结果数。
3. 服务端调用 xAI Responses API + `x_search`。
4. 要求模型返回严格 JSON，结构统一成 `Signal[]`。
5. 前端新增“X 线索雷达”面板：输入关键词触发器，一键搜索，结果进入现有评分/草稿流程。
6. 后续把 xAI provider 替换为中转 provider 时，只换服务端 connector，不改页面和评分逻辑。

官方依据：

- xAI Overview: https://docs.x.ai/overview
- xAI X Search: https://docs.x.ai/developers/tools/x-search
- xAI Web Search: https://docs.x.ai/developers/tools/web-search
- xAI Pricing: https://docs.x.ai/developers/pricing
- xAI Rate Limits: https://docs.x.ai/developers/rate-limits
- xAI Cost Tracking: https://docs.x.ai/developers/cost-tracking

## 2026-07-06 更新：本地 Grok Bridge MVP

在只有 X 蓝 V / Grok 网页权益、暂时没有 `XAI_API_KEY` 的情况下，当前实现采用本地 Grok Bridge 作为过渡方案。

实现边界：

- 使用 `playwright-core` 启动本机 Edge/Chrome。
- 使用项目专用 persistent profile：`.local/grok-profile`。
- 首次由用户在可见浏览器里手动登录 Grok。
- 后续页面可调用 `POST /api/grok` 打开 Grok 或提交搜索 Prompt。
- 不读取主浏览器 profile，不收集 token/cookie，不绕过验证码。
- 自动提交流程失败时，保留手动复制 Prompt / 粘贴 Grok 结果的兜底路径。

这个方案只适合本机自用和流程验证，不适合直接产品化。产品化路线仍然应该切换到 xAI API、中转 API 或其他正式 provider。
2026-07-06 追加：实际测试中，x.ai / Grok 会拦截 Playwright 自动化浏览器并显示 Cloudflare blocked。因此默认 MVP 改为普通浏览器打开 + 自动复制 Prompt + 手动粘贴结果导入。Playwright 自动化只保留为实验代码，不作为默认产品路径。
## 风险结论

Phase 3 不会实现不了，但要避免三件事：

1. 不要依赖 Google Custom Search JSON API。
2. 不要把 Reddit 当成默认可商用数据源。
3. 不要用抓网页作为主路线。

可以安全推进的路线调整为：统一 Signal -> xAI X Search Connector -> 手动/CSV 导入兜底 -> GitHub API 备用 -> Reddit 后置验证。