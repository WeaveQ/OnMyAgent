export type SkillMarketplaceEntry = {
  id: string;
  packageName: string;
  skillName: string;
  displayName: string;
  description: string;
  categoryId: string;
  categoryIds: string[];
  categoryLabel: string;
  categoryLabels: string[];
  tags: string[];
  iconUrl: string | null;
  version: string | null;
};
