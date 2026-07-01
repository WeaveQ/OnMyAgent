export type ExpertMarketplaceCategory = {
  id: string;
  labelKey: string;
  searchLabel: string;
};

export const EXPERT_MARKETPLACE_CATEGORIES: ExpertMarketplaceCategory[] = [
  { id: "all", labelKey: "session.expert_marketplace_category_all", searchLabel: "全部 all" },
  { id: "01-OPC", labelKey: "session.expert_marketplace_category_opc", searchLabel: "OPC-一人公司 opc" },
  { id: "product-development", labelKey: "session.expert_marketplace_category_product_development", searchLabel: "产品研发 product development engineering quality" },
  { id: "08-FinanceInvestment", labelKey: "session.expert_marketplace_category_finance_investment", searchLabel: "金融投资 finance investment" },
  { id: "03-GameSpatial", labelKey: "session.expert_marketplace_category_game_spatial", searchLabel: "游戏空间 game spatial" },
  { id: "04-DataAI", labelKey: "session.expert_marketplace_category_data_ai", searchLabel: "数据智能 data ai" },
  { id: "product-operations", labelKey: "session.expert_marketplace_category_product_operations", searchLabel: "产品运营 content marketing growth operations" },
  { id: "07-SalesCommerce", labelKey: "session.expert_marketplace_category_sales_commerce", searchLabel: "销售商务 sales commerce" },
  { id: "hr-legal", labelKey: "session.expert_marketplace_category_hr_legal", searchLabel: "人力法务 hr legal security compliance" },
  { id: "12-IndustryConsultant", labelKey: "session.expert_marketplace_category_industry_consultant", searchLabel: "行业顾问 industry consultant" },
];

export function normalizeExpertMarketplaceCategoryId(
  categoryId: string | null | undefined,
): string {
  const id = categoryId?.trim();
  if (!id) return "all";
  if (
    id === "01-ProductDesign" ||
    id === "02-Engineering" ||
    id === "10-ProjectQuality"
  ) {
    return "product-development";
  }
  if (id === "05-MarketingGrowth" || id === "06-ContentCreative") {
    return "product-operations";
  }
  if (id === "09-OperationsHR" || id === "11-SecurityCompliance") {
    return "hr-legal";
  }
  if (id === "13-TencentZone") return "all";
  return id;
}

export function expertMarketplaceCategoryLabel(categoryId: string): string {
  const normalizedCategoryId = normalizeExpertMarketplaceCategoryId(categoryId);
  return (
    EXPERT_MARKETPLACE_CATEGORIES.find((category) => category.id === normalizedCategoryId)
      ?.searchLabel ?? EXPERT_MARKETPLACE_CATEGORIES[0].searchLabel
  );
}
