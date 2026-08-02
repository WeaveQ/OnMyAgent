import { t } from "@/i18n";

export type SkillMarketplaceCategory = {
  id: string;
  labelKey: string;
  searchLabel: string;
  keywords: string[];
};

export const SKILL_MARKETPLACE_CATEGORIES: SkillMarketplaceCategory[] = [
  { id: "all", labelKey: "skills_marketplace.category_all", searchLabel: "all", keywords: [] },
  { id: "opc", labelKey: "skills_marketplace.category_opc", searchLabel: "opc", keywords: ["opc", "solo", "startup", "agent-team"] },
  { id: "life", labelKey: "skills_marketplace.category_life", searchLabel: "life service", keywords: ["travel", "trip", "ticket", "food", "hotel", "health", "notes", "reminders"] },
  { id: "education", labelKey: "skills_marketplace.category_education", searchLabel: "education", keywords: ["education", "learning", "course", "exam", "teacher", "pbl", "school"] },
  { id: "finance", labelKey: "skills_marketplace.category_finance", searchLabel: "finance investment", keywords: ["finance", "stock", "trading", "investment", "crypto", "bayes"] },
  { id: "content", labelKey: "skills_marketplace.category_content", searchLabel: "content creation", keywords: ["content", "writer", "writing", "video", "image", "canvas", "xiaohongshu", "bilibili"] },
  { id: "news", labelKey: "skills_marketplace.category_news", searchLabel: "information news", keywords: ["news", "hot", "trends", "watcher", "arxiv", "research"] },
  { id: "productivity", labelKey: "skills_marketplace.category_productivity", searchLabel: "productivity", keywords: ["productivity", "automation", "tmux", "obsidian", "notion", "reminder", "calendar"] },
  { id: "office", labelKey: "skills_marketplace.category_office", searchLabel: "office collaboration", keywords: ["office", "email", "gmail", "mail", "docs", "document", "ppt", "pdf", "sheet", "meeting"] },
  { id: "business", labelKey: "skills_marketplace.category_business", searchLabel: "business operations", keywords: ["business", "sales", "commerce", "customer", "crm", "marketing"] },
  { id: "data", labelKey: "skills_marketplace.category_data", searchLabel: "data analysis", keywords: ["data", "analytics", "analysis", "database", "sql", "supabase", "report"] },
  { id: "knowledge", labelKey: "skills_marketplace.category_knowledge", searchLabel: "knowledge", keywords: ["knowledge", "research", "obsidian", "citation", "deep-research"] },
];

export function skillMarketplaceCategoryLabel(categoryId: string): string {
  if (categoryId === "developer" || categoryId === "deploy") {
    return t(SKILL_MARKETPLACE_CATEGORIES[0].labelKey);
  }
  const category = SKILL_MARKETPLACE_CATEGORIES.find((item) => item.id === categoryId);
  return category ? `${t(category.labelKey)} ${category.searchLabel}` : t(SKILL_MARKETPLACE_CATEGORIES[0].labelKey);
}
