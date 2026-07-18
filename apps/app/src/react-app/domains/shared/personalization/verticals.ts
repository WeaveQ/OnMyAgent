/**
 * L2 vertical workspaces for personalization.
 * Explicitly excluded (do not add): energy/energy-green, real-estate*,
 * healthcare, agri-food / food-as-primary-vertical.
 *
 * industries / roles use the collapsed profile taxonomy
 * (see profile-option-aliases.ts). Old fine-grained values are
 * canonicalized before scoring.
 */

export type PersonalizationVerticalId =
  | "solo-opc"
  | "ecommerce-retail"
  | "content-media"
  | "software-product"
  | "game-entertainment"
  | "logistics-supply"
  | "manufacturing-ops"
  | "enterprise-ops"
  | "finance-pro"
  | "education"
  | "travel-local"
  | "public-sector";

/** Vertical ids that must never appear in plan output. */
export const FORBIDDEN_VERTICAL_IDS = [
  "energy",
  "energy-green",
  "real-estate",
  "real-estate-build",
  "healthcare",
  "agri-food",
  "food-beverage",
] as const;

export type PersonalizationVertical = {
  id: PersonalizationVerticalId;
  /** Profile industry values that map here (highest weight). */
  industries: string[];
  /** Profile role values that boost this vertical. */
  roles: string[];
  /** Profile task values that boost this vertical. */
  tasks: string[];
  /** Profile tool values that boost this vertical. */
  tools: string[];
  defaultWorkbench: "office" | "code";
  featuredExperts: string[];
  /** Automation template ids ranked for this vertical (shipped ids only). */
  templateIds: string[];
};

export const PERSONALIZATION_VERTICALS: PersonalizationVertical[] = [
  {
    id: "solo-opc",
    industries: ["opc-general", "media", "student"],
    roles: ["opc", "operations", "management"],
    tasks: ["content-ops", "weekly-report", "customer-communication"],
    tools: ["xiaohongshu", "douyin", "wechat-oa"],
    defaultWorkbench: "office",
    featuredExperts: [
      "ask-liuxiaopai",
      "chuangye-manor",
      "xiaohongshu-operations-expert",
      "content-creator",
      "smb-finance",
      "frontend-developer",
    ],
    templateIds: [
      "weekly-work-report",
      "daily-ai-news",
      "meeting-prep",
      "daily-english-words",
    ],
  },
  {
    id: "ecommerce-retail",
    industries: ["ecommerce"],
    roles: ["operations", "sales", "supply-chain"],
    tasks: ["content-ops", "campaign", "customer-communication", "data-analysis"],
    tools: ["xiaohongshu", "douyin", "excel", "wps"],
    defaultWorkbench: "office",
    featuredExperts: [
      "china-ecommerce-operations-expert",
      "cross-border-ecommerce-expert",
      "private-domain-operations-expert",
      "private-domain-marketing-expert",
      "seo-expert",
      "supply-chain-strategist",
    ],
    templateIds: [
      "weekly-work-report",
      "meeting-prep",
      "daily-ai-news",
      "logistics-recon-reminder",
    ],
  },
  {
    id: "content-media",
    industries: ["media"],
    roles: ["operations", "product"],
    tasks: ["content-ops", "campaign", "weekly-report"],
    tools: ["xiaohongshu", "douyin", "bilibili", "canva"],
    defaultWorkbench: "office",
    featuredExperts: [
      "xiaohongshu-operations-expert",
      "tik-tok-strategist",
      "bilibili-content-strategist",
      "content-creator",
      "viral-topic-master",
      "wechat-official-account-expert",
    ],
    templateIds: ["weekly-work-report", "daily-ai-news", "meeting-prep"],
  },
  {
    id: "software-product",
    industries: ["internet", "hardware"],
    roles: ["technology", "product"],
    tasks: ["code", "data-analysis", "weekly-report", "meeting-notes"],
    tools: ["codex", "claude-code", "github", "vscode"],
    defaultWorkbench: "code",
    featuredExperts: [
      "software-architect",
      "senior-developer",
      "code-review-expert",
      "frontend-developer",
      "ai-engineer",
      "senior-project-manager",
    ],
    templateIds: [
      "code-daily-review",
      "weekly-work-report",
      "meeting-prep",
      "daily-ai-news",
    ],
  },
  {
    id: "game-entertainment",
    industries: ["gaming"],
    roles: ["technology", "product", "operations"],
    tasks: ["code", "content-ops", "weekly-report"],
    tools: ["github", "figma", "claude-code"],
    defaultWorkbench: "code",
    featuredExperts: [
      "game-designer",
      "level-designer",
      "narrative-designer",
      "technical-artist",
      "game-audio-engineer",
    ],
    templateIds: ["code-daily-review", "weekly-work-report", "meeting-prep"],
  },
  {
    id: "logistics-supply",
    industries: ["logistics"],
    roles: ["operations", "supply-chain", "management", "finance"],
    tasks: [
      "dispatch",
      "recon",
      "daily-brief",
      "customer-communication",
      "data-analysis",
      "weekly-report",
    ],
    tools: ["excel", "wps", "feishu", "wecom", "erp"],
    defaultWorkbench: "office",
    featuredExperts: [
      "logistics-ops-navigator",
      "supply-chain-strategist",
      "cross-border-ecommerce-expert",
      "legal-compliance-reviewer",
      "data-analytics-reporter",
    ],
    templateIds: [
      "logistics-dispatch-brief",
      "logistics-exception-followup",
      "logistics-in-transit-risk",
      "logistics-weekly-ops-report",
      "logistics-pod-chase",
      "logistics-recon-reminder",
      "weekly-work-report",
    ],
  },
  {
    id: "manufacturing-ops",
    industries: ["manufacturing"],
    roles: ["operations", "manufacturing-eng", "supply-chain", "management"],
    tasks: ["daily-brief", "quality-check", "inventory", "weekly-report", "data-analysis"],
    tools: ["excel", "erp", "feishu"],
    defaultWorkbench: "office",
    featuredExperts: [
      "supply-chain-strategist",
      "logistics-ops-navigator",
      "data-analytics-reporter",
      "senior-project-manager",
    ],
    // Content-thin: lean on logistics + generic until dedicated mfg templates exist.
    templateIds: [
      "logistics-dispatch-brief",
      "logistics-exception-followup",
      "weekly-work-report",
      "meeting-prep",
    ],
  },
  {
    id: "enterprise-ops",
    industries: ["consulting"],
    roles: ["sales", "hr", "finance", "management"],
    tasks: [
      "meeting-notes",
      "weekly-report",
      "contract-review",
      "email-drafting",
      "hiring",
      "sales-pipeline",
      "compliance",
    ],
    tools: ["feishu", "wecom", "dingtalk", "excel", "notion"],
    defaultWorkbench: "office",
    featuredExperts: [
      "sales-coach",
      "proposal-strategist",
      "legal-compliance-reviewer",
      "recruitment-expert",
      "fbsir-board-secretary-assistant",
      "corporate-training-designer",
    ],
    templateIds: [
      "meeting-prep",
      "weekly-work-report",
      "daily-ai-news",
    ],
  },
  {
    id: "finance-pro",
    industries: ["finance"],
    roles: ["finance", "technology", "management"],
    tasks: ["data-analysis", "weekly-report", "recon", "compliance", "contract-review"],
    tools: ["excel", "wps", "feishu"],
    defaultWorkbench: "office",
    featuredExperts: [
      "earnings-reviewer",
      "smb-finance",
      "fbsir-board-secretary-assistant",
      "data-analytics-reporter",
    ],
    templateIds: [
      "logistics-recon-reminder",
      "weekly-work-report",
      "meeting-prep",
      "daily-ai-news",
    ],
  },
  {
    id: "education",
    industries: ["education"],
    roles: ["teacher", "operations", "hr"],
    tasks: ["study-plan", "content-ops", "weekly-report", "meeting-notes"],
    tools: ["wps", "feishu", "notion"],
    defaultWorkbench: "office",
    featuredExperts: [
      "gaokao-advisor",
      "corporate-training-designer",
      "kdocs-ppt-creator",
    ],
    templateIds: [
      "daily-english-words",
      "weekly-work-report",
      "meeting-prep",
      "today-in-history",
    ],
  },
  {
    id: "travel-local",
    industries: ["travel"],
    roles: ["operations", "sales"],
    tasks: ["customer-communication", "daily-brief", "weekly-report"],
    tools: ["feishu", "wecom", "excel"],
    defaultWorkbench: "office",
    featuredExperts: ["tripstar-agent", "customer-support-expert"],
    templateIds: ["daily-ai-news", "weekly-work-report", "meeting-prep"],
  },
  {
    id: "public-sector",
    industries: ["government"],
    roles: ["hr", "management", "finance", "operations"],
    tasks: ["meeting-notes", "email-drafting", "weekly-report", "compliance"],
    tools: ["wps", "feishu", "excel"],
    defaultWorkbench: "office",
    featuredExperts: [
      "document-generation-expert",
      "legal-compliance-reviewer",
      "fbsir-board-secretary-assistant",
    ],
    templateIds: ["meeting-prep", "weekly-work-report", "daily-ai-news"],
  },
];

export function isForbiddenVerticalId(id: string): boolean {
  return (FORBIDDEN_VERTICAL_IDS as readonly string[]).includes(id);
}
