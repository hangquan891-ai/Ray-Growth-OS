import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);

const {
  generateGrowthDrafts,
  generateGrowthQueries,
  generateOutreachDraft,
  generateSearchQueries,
  parseLeadInput,
  runGrowthWorkflow,
  runOutboundWorkflow,
  scoreGrowthOpportunity,
  scoreLead,
} = require("../src/lib/outbound.js");

const product = {
  name: "LaunchRadar",
  description: "帮独立开发者用 Grok 在 X 上找到高意向线索，并生成个性化触达草稿",
  targetCustomer: "刚上线 SaaS 但没有流量的独立开发者",
  competitors: "Apollo, Clay, Taplio",
  painPoints: "0 流量, 找不到付费用户, SEO 太慢, 不知道去哪找客户",
};

const growthProfile = {
  accountName: "Ray｜AI Coding 出海日记",
  positioning: "6年 Java 后端，分享 AI Coding、独立开发、出海产品踩坑",
  targetReaders: "独立开发者, AI Coding 用户, 想出海的程序员",
  contentPillars: "AI Coding, 独立开发, 主动获客, 出海 SaaS",
  growthGoals: "提高高质量互动、获取关注、沉淀选题",
};

test("generateSearchQueries creates X/Grok intent queries", () => {
  const queries = generateSearchQueries(product);

  assert.equal(queries.length, 3);
  assert.ok(queries.some((query) => query.channel === "X"));
  assert.ok(queries.some((query) => query.query.includes("SaaS")));
  assert.ok(queries.some((query) => query.query.includes("SEO 太慢")));
  assert.ok(queries.every((query) => query.intent.length > 0));
});
test("generateSearchQueries stays empty before positioning is filled", () => {
  assert.deepEqual(generateSearchQueries({ name: "", description: "", targetCustomer: "", competitors: "", painPoints: "" }), []);
});

test("parseLeadInput accepts pasted lines with platform, url, and note", () => {
  const leads = parseLeadInput(`
X | indie maker | https://x.com/maker/status/1 | 刚上线产品但完全没有流量，问怎么找第一批用户
Reddit | r/SaaS founder | https://reddit.com/r/SaaS/comments/1 | looking for Apollo alternatives for early SaaS outreach
`);

  assert.deepEqual(leads[0], {
    platform: "X",
    name: "indie maker",
    url: "https://x.com/maker/status/1",
    note: "刚上线产品但完全没有流量，问怎么找第一批用户",
  });
  assert.equal(leads.length, 2);
});

test("scoreLead rewards pain, buying intent, and target-customer match", () => {
  const strongLead = {
    platform: "X",
    name: "indie maker",
    url: "https://x.com/maker/status/1",
    note: "刚上线 SaaS 没有流量，想找付费用户，SEO 太慢，求推荐获客工具",
  };
  const weakLead = {
    platform: "GitHub",
    name: "random repo",
    url: "https://github.com/example/repo",
    note: "收藏一些 UI 组件和主题",
  };

  const strongScore = scoreLead(strongLead, product);
  const weakScore = scoreLead(weakLead, product);

  assert.ok(strongScore.score > weakScore.score);
  assert.equal(strongScore.label, "High intent");
  assert.ok(strongScore.reasons.includes("痛点匹配"));
  assert.ok(strongScore.reasons.includes("购买/求助意图"));
});

test("generateOutreachDraft creates a concise personalized draft", () => {
  const lead = {
    platform: "X",
    name: "indie maker",
    url: "https://x.com/maker/status/1",
    note: "刚上线 SaaS 没有流量，想找第一批用户",
  };
  const scoredLead = { ...lead, score: 88, label: "High intent", reasons: ["痛点匹配"] };

  const draft = generateOutreachDraft(scoredLead, product);

  assert.ok(draft.includes("indie maker"));
  assert.ok(draft.includes("刚上线 SaaS 没有流量"));
  assert.ok(draft.includes("LaunchRadar"));
  assert.ok(draft.length <= 220);
});

test("runOutboundWorkflow sorts leads by score and attaches drafts", () => {
  const result = runOutboundWorkflow(
    product,
    `
GitHub | ui repo | https://github.com/example/ui | UI components
X | indie maker | https://x.com/maker/status/1 | 刚上线 SaaS 没有流量，想找付费用户，SEO 太慢
`
  );

  assert.equal(result.queries.length, 3);
  assert.equal(result.leads.length, 2);
  assert.equal(result.leads[0].name, "indie maker");
  assert.ok(result.leads[0].draft.length > 0);
});

test("generateGrowthQueries creates audience and content-pillar searches", () => {
  const queries = generateGrowthQueries(growthProfile);

  assert.equal(queries.length, 3);
  assert.ok(queries.some((query) => query.channel === "X"));
  assert.ok(queries.some((query) => query.query.includes("AI Coding")));
  assert.ok(queries.some((query) => query.query.includes("独立开发者")));
  assert.ok(queries.every((query) => query.intent.length > 0));
});
test("generateGrowthQueries stays empty before account positioning is filled", () => {
  assert.deepEqual(generateGrowthQueries({ accountName: "", positioning: "", targetReaders: "", contentPillars: "", growthGoals: "" }), []);
});

test("scoreGrowthOpportunity rewards target readers, content pillars, and replyable pain", () => {
  const strongCandidate = {
    platform: "X",
    name: "AI indie founder",
    url: "https://x.com/founder/status/1",
    note: "独立开发者刚用 AI Coding 做完产品，但上线后 0 流量，问怎么找到第一批用户",
  };
  const weakCandidate = {
    platform: "X",
    name: "general news",
    url: "https://x.com/news/status/1",
    note: "今天的娱乐新闻合集",
  };

  const strongScore = scoreGrowthOpportunity(strongCandidate, growthProfile);
  const weakScore = scoreGrowthOpportunity(weakCandidate, growthProfile);

  assert.ok(strongScore.score > weakScore.score);
  assert.equal(strongScore.label, "Engage now");
  assert.ok(strongScore.reasons.includes("读者匹配"));
  assert.ok(strongScore.reasons.includes("内容支柱匹配"));
  assert.ok(strongScore.reasons.includes("可回复痛点"));
});

test("generateGrowthDrafts creates reply, quote, and post idea", () => {
  const candidate = {
    platform: "X",
    name: "AI indie founder",
    url: "https://x.com/founder/status/1",
    note: "独立开发者刚用 AI Coding 做完产品，但上线后 0 流量，问怎么找到第一批用户",
    score: 92,
    label: "Engage now",
    reasons: ["读者匹配", "内容支柱匹配"],
  };

  const drafts = generateGrowthDrafts(candidate, growthProfile);

  assert.ok(drafts.reply.includes("第一批用户"));
  assert.ok(drafts.quote.includes("AI Coding"));
  assert.ok(drafts.postIdea.includes("0 流量"));
  assert.ok(drafts.reply.length <= 220);
});

test("runGrowthWorkflow sorts opportunities and attaches growth drafts", () => {
  const result = runGrowthWorkflow(
    growthProfile,
    `
X | general news | https://x.com/news/status/1 | 今天的娱乐新闻合集
X | AI indie founder | https://x.com/founder/status/1 | 独立开发者刚用 AI Coding 做完产品，但上线后 0 流量，问怎么找到第一批用户
`
  );

  assert.equal(result.queries.length, 3);
  assert.equal(result.opportunities.length, 2);
  assert.equal(result.opportunities[0].name, "AI indie founder");
  assert.ok(result.opportunities[0].replyDraft.length > 0);
  assert.ok(result.opportunities[0].quoteDraft.length > 0);
  assert.ok(result.opportunities[0].postIdea.length > 0);
});


