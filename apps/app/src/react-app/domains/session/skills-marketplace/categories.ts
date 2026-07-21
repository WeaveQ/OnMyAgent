export type SkillMarketplaceCategory = {
  id: string;
  labelKey: string;
  searchLabel: string;
  keywords: string[];
};

export const SKILL_MARKETPLACE_CATEGORIES: SkillMarketplaceCategory[] = [
  { id: "all", labelKey: "skills_marketplace.category_all", searchLabel: "全部 all", keywords: [] },
  { id: "opc", labelKey: "skills_marketplace.category_opc", searchLabel: "OPC-一人公司 opc", keywords: ["opc", "solo", "startup", "agent-team"] },
  { id: "life", labelKey: "skills_marketplace.category_life", searchLabel: "生活服务 life service", keywords: ["travel", "trip", "ticket", "food", "hotel", "health", "notes", "reminders", "生活", "出行", "旅行", "机票", "火车"] },
  // Merged former “开发工具” + “网站部署” so the filter strip fits without horizontal scroll.
  {
    id: "developer",
    labelKey: "skills_marketplace.category_developer",
    searchLabel: "开发部署 developer deploy",
    keywords: [
      "dev", "code", "github", "browser", "frontend", "backend", "fullstack", "ios", "android", "cli", "api", "mcp", "test", "开发", "代码",
      "deploy", "cloudflare", "vercel", "netlify", "cloudbase", "website", "wordpress", "dns", "部署", "网站",
    ],
  },
  { id: "education", labelKey: "skills_marketplace.category_education", searchLabel: "教育学习 education", keywords: ["education", "learning", "course", "exam", "teacher", "pbl", "school", "学习", "教育", "课程", "高考"] },
  { id: "finance", labelKey: "skills_marketplace.category_finance", searchLabel: "投资理财 finance investment", keywords: ["finance", "stock", "trading", "investment", "crypto", "bayes", "财", "投资", "股票", "理财"] },
  { id: "content", labelKey: "skills_marketplace.category_content", searchLabel: "内容创作 content creation", keywords: ["content", "writer", "writing", "video", "image", "canvas", "xiaohongshu", "bilibili", "公众号", "写作", "内容", "创作", "视频"] },
  { id: "news", labelKey: "skills_marketplace.category_news", searchLabel: "信息资讯 information news", keywords: ["news", "hot", "trends", "watcher", "arxiv", "research", "资讯", "热点", "日报", "趋势"] },
  { id: "productivity", labelKey: "skills_marketplace.category_productivity", searchLabel: "效率工具 productivity", keywords: ["productivity", "automation", "tmux", "obsidian", "notion", "reminder", "calendar", "效率", "自动化"] },
  { id: "office", labelKey: "skills_marketplace.category_office", searchLabel: "办公协同 office collaboration", keywords: ["office", "email", "gmail", "mail", "docs", "document", "ppt", "pdf", "sheet", "meeting", "协同", "办公", "邮件", "文档"] },
  { id: "business", labelKey: "skills_marketplace.category_business", searchLabel: "商业运营 business operations", keywords: ["business", "sales", "commerce", "customer", "crm", "marketing", "运营", "商业", "销售", "电商"] },
  { id: "data", labelKey: "skills_marketplace.category_data", searchLabel: "数据分析 data analysis", keywords: ["data", "analytics", "analysis", "database", "sql", "supabase", "report", "数据", "分析"] },
  { id: "knowledge", labelKey: "skills_marketplace.category_knowledge", searchLabel: "知识与学习 knowledge", keywords: ["knowledge", "research", "obsidian", "citation", "deep-research", "知识", "资料", "学习"] },
];

export function skillMarketplaceCategoryLabel(categoryId: string): string {
  const resolvedId = categoryId === "deploy" ? "developer" : categoryId;
  return (
    SKILL_MARKETPLACE_CATEGORIES.find((category) => category.id === resolvedId)
      ?.searchLabel ?? SKILL_MARKETPLACE_CATEGORIES[0].searchLabel
  );
}
