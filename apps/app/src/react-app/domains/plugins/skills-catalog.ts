export type SkillCategory = "sourcing" | "research";

export type SkillItem = {
  id: string;
  name: string;
  description: string;
  category: SkillCategory;
  enabled: boolean;
};

export const LEGACY_SKILLS: SkillItem[] = [
  {
    id: "1688-buying",
    name: "1688采购",
    description: "使用图像搜索在 1688 平台上查找匹配商品，并整理供货线索。",
    category: "sourcing",
    enabled: false,
  },
  {
    id: "supplier-sourcing",
    name: "产品供应商寻源",
    description: "在各大全球采购平台搜索产品与供应商，寻找最优货源候选。",
    category: "sourcing",
    enabled: false,
  },
  {
    id: "sales-negotiation",
    name: "销售谈判专家",
    description: "为 B2B 销售谈判做准备并提供指导，涵盖定价与议价策略。",
    category: "sourcing",
    enabled: false,
  },
  {
    id: "cj-api",
    name: "CJ代发货API集成",
    description: "集成 CJ Dropshipping API，用于商品管理、库存跟踪与订单联动。",
    category: "sourcing",
    enabled: false,
  },
  {
    id: "product-sourcing",
    name: "商品图搜货源",
    description: "根据图片或关键词快速查找相似商品、供应商与价格区间。",
    category: "sourcing",
    enabled: false,
  },
  {
    id: "listing-optimizer",
    name: "商品标题优化",
    description: "生成更适合平台搜索和转化的商品标题、卖点与关键词组合。",
    category: "sourcing",
    enabled: false,
  },
  {
    id: "supplier-shortlist",
    name: "供应商短名单",
    description: "比较供应商资质、价格、交期与风险，整理候选名单。",
    category: "sourcing",
    enabled: false,
  },
  {
    id: "product-trend-finder",
    name: "趋势商品发现",
    description: "结合公开市场信号和用户需求，识别潜在爆品方向。",
    category: "research",
    enabled: false,
  },
  {
    id: "review-summary",
    name: "评论洞察",
    description: "汇总用户评论，提炼痛点、好评原因和产品改进建议。",
    category: "research",
    enabled: false,
  },
  {
    id: "campaign-planner",
    name: "营销活动规划",
    description: "围绕目标用户、渠道和预算设计营销活动方案。",
    category: "research",
    enabled: false,
  },
  {
    id: "copy-variants",
    name: "文案变体",
    description: "为商品、活动或社媒内容生成多风格文案候选。",
    category: "research",
    enabled: false,
  },
  {
    id: "prd-outline",
    name: "PRD 大纲",
    description: "根据目标和约束生成产品需求文档结构与关键问题。",
    category: "research",
    enabled: false,
  },
  {
    id: "bug-triage",
    name: "Bug 分诊",
    description: "帮助分析问题严重性、复现路径和初步排查建议。",
    category: "research",
    enabled: false,
  },
  {
    id: "refactor-checklist",
    name: "重构检查清单",
    description: "梳理重构前后的风险点、验证路径和回归测试建议。",
    category: "research",
    enabled: false,
  },
  {
    id: "pr-brief",
    name: "PR 摘要",
    description: "根据变更内容整理合并请求摘要、风险和测试建议。",
    category: "research",
    enabled: false,
  },
  {
    id: "project-radar",
    name: "项目雷达",
    description: "持续追踪项目风险、阻塞项和关键里程碑状态。",
    category: "research",
    enabled: false,
  },
  {
    id: "ux-critique",
    name: "UX 走查",
    description: "从可用性、信息层级和交互细节检查产品体验。",
    category: "research",
    enabled: false,
  },
  {
    id: "meeting-followup",
    name: "会议跟进",
    description: "整理会议结论、待办负责人和后续推进计划。",
    category: "research",
    enabled: false,
  },
];

export const ALL_SKILLS: SkillItem[] = [...LEGACY_SKILLS];
